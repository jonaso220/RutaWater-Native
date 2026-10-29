import type { DocumentReference, Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import type { Client } from '../../src/types';
import { withDefaults } from '../../src/utils/clientDefaults';
import { billingInfoUpdates, isValidClientEmail, sanitizeClientBillingInfo } from '../../src/utils/clientBillingInfo';
import {
  buildClientIdentityIndex, getRelatedClientReference, getRelatedRecordStableClientId, getStableClientId,
} from '../../src/utils/clientIdentity';
import { dataScopeFields } from '../../src/utils/dataScope';
import {
  DELIVERIES_COLLECTION, DeliveryChange, deliveryChangeFor, deliveryDocument, mergeDeliveryChanges,
} from '../../src/utils/deliveryRecords';
import { getNextVisitDate, intervalWeeksForFreq, parseDate, toLocalDateString } from '../../src/utils/helpers';
import { belongsToProfileScope } from '../../src/utils/profileScope';
import { checkFullLoad, recordFullLoad } from './readBudget';
import { loadLabel, scopeQueries } from './store';
import {
  applyVisitCommand, createVisitCommand, newVisitId, undoForCompletedClient, VisitCommand, VisitResult,
} from '../../src/utils/visitCompletion';
import { getDirectoryDeliveryHistoryUpdate, getLastVisitDate } from '../../src/utils/recency';
import { getClientAddresses, locationFields } from '../../src/utils/clientAddresses';
import { getClientPhones } from '../../src/utils/clientPhones';
import { findExactClientMatch } from '../../src/utils/clientDuplicates';
import { toExistingClientUpdate } from '../../src/utils/clientWriteData';
import { sanitizeClientData } from '../../netlify/functions/_shared/clientCreationService';
import { Account, Route, routeForRecord } from './routes';
import {
  agendaFor, CatalogProduct, clientDays, dayList, FREQ_LABELS, isValidIsoDate, nextVisit, PositionSuggestion, quantity,
  suggestPosition, todayKey, weekdayOf,
} from './views';
import { moveItemToPosition, planPositionChange, readDayOrder } from '../../src/utils/clientOrder';
import { formatCoordinate, resolveMapsCoordinates } from '../../src/utils/geo';

export class WriteError extends Error {}

interface Loaded {
  ref: DocumentReference;
  client: Client;
  route: Route;
}

const loadForWrite = async (
  db: Firestore, transaction: Transaction, account: Account, clientId: string,
): Promise<Loaded> => {
  const ref = db.collection('clients').doc(clientId);
  const snap = await transaction.get(ref);
  if (!snap.exists) throw new WriteError(`No existe el cliente ${clientId}.`);
  const client = withDefaults(snap.id, snap.data());
  const route = routeForRecord(account, client);
  if (!route) throw new WriteError('Ese cliente no pertenece a ningún reparto de esta cuenta.');
  if (!route.writable) throw new WriteError(`El reparto «${route.name}» no admite cambios ahora (cuenta o grupo inactivo).`);
  return { ref, client, route };
};

const productMap = (client: Client): Record<string, number> => {
  const map: Record<string, number> = {};
  Object.entries(client.products || {}).forEach(([id, value]) => {
    const amount = quantity(value);
    if (amount > 0) map[id] = amount;
  });
  return map;
};

export interface ChangeResult {
  cliente_id: string;
  nombre: string;
  reparto: string;
  cambiado: boolean;
  antes: unknown;
  despues: unknown;
  [extra: string]: unknown;
}

const validateProducts = (catalog: CatalogProduct[], changes: Record<string, number>): void => {
  const unknown = Object.keys(changes).filter((id) => !catalog.some((product) => product.id === id));
  if (unknown.length) {
    throw new WriteError(`Productos desconocidos: ${unknown.join(', ')}. Usá ver_productos para los ids.`);
  }
  Object.entries(changes).forEach(([id, amount]) => {
    if (!Number.isInteger(amount) || amount < 0 || amount > 9999) {
      throw new WriteError(`Cantidad inválida para ${id}: ${amount}.`);
    }
  });
};

/**
 * Igual que «Guardar productos» (ClientProductsModal): guarda el mapa completo
 * con cantidades > 0. `changes` modifica solo esos productos (0 lo quita);
 * con `replaceAll` el resultado es exactamente `changes`.
 */
export const setProducts = (
  db: Firestore, account: Account, catalog: CatalogProduct[],
  clientId: string, changes: Record<string, number>, replaceAll: boolean,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  validateProducts(catalog, changes);
  const { ref, client, route } = await loadForWrite(db, transaction, account, clientId);
  const before = productMap(client);
  const after: Record<string, number> = replaceAll ? {} : { ...before };
  Object.entries(changes).forEach(([id, amount]) => {
    if (amount > 0) after[id] = amount;
    else delete after[id];
  });
  const changed = JSON.stringify(Object.entries(before).sort()) !== JSON.stringify(Object.entries(after).sort());
  if (changed) transaction.update(ref, { products: after });
  return { cliente_id: client.id, nombre: client.name, reparto: route.name, cambiado: changed, antes: before, despues: after };
});

/**
 * Reemplaza la nota de la ficha. Con `expected`, falla si la nota actual ya
 * no es esa (alguien la editó desde la app mientras tanto).
 */
export const setNote = (
  db: Firestore, account: Account, clientId: string, note: string, expected?: string,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (note.length > 2000) throw new WriteError('La nota supera los 2000 caracteres.');
  const { ref, client, route } = await loadForWrite(db, transaction, account, clientId);
  const before = client.notes || '';
  if (expected !== undefined && expected !== before) {
    throw new WriteError(`La nota cambió mientras tanto. Nota actual: ${JSON.stringify(before)}`);
  }
  const after = note.trim();
  const changed = after !== before;
  if (changed) transaction.update(ref, { notes: after });
  return { cliente_id: client.id, nombre: client.name, reparto: route.name, cambiado: changed, antes: before, despues: after };
});

/**
 * Datos de facturación de la ficha (RUT, razón social, email), como Editar
 * cliente → Facturación (Jonathan, 29/10/2026: para pasarle a la empresa los
 * datos de un comercio y que le hagan la boleta). Solo cambia lo que se pasa;
 * texto vacío lo borra. El RUT uruguayo tiene 12 dígitos: un número más corto
 * puede ser una cédula, que nunca se guarda.
 */
export const setBilling = (
  db: Firestore, account: Account, clientId: string,
  values: { rut?: string; businessName?: string; email?: string },
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const digits = (values.rut || '').replace(/\D/g, '');
  if (values.rut?.trim() && digits.length !== 12) {
    throw new WriteError(`El RUT tiene que tener 12 dígitos y «${values.rut.trim()}» tiene ${digits.length}. Si es una cédula, no se guarda.`);
  }
  if (values.email !== undefined && !isValidClientEmail(values.email)) throw new WriteError(`Email inválido: «${values.email}».`);
  const { ref, client, route } = await loadForWrite(db, transaction, account, clientId);
  const current = sanitizeClientBillingInfo(client);
  const provided = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  const updates = billingInfoUpdates(client, { ...current, ...provided });
  const changed = Object.keys(updates).length > 0;
  if (changed) transaction.update(ref, { ...updates, updatedAt: new Date() });
  const view = (billing: typeof current) => ({ rut: billing.rut, razon_social: billing.businessName, email: billing.email });
  return {
    cliente_id: client.id, nombre: client.name, reparto: route.name, cambiado: changed,
    antes: view(current), despues: view({ ...current, ...updates }),
  };
});

/** Fija la estrella (no es un interruptor: repetir la llamada no la apaga). */
export const setStar = (
  db: Firestore, account: Account, clientId: string, value: boolean,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const { ref, client, route } = await loadForWrite(db, transaction, account, clientId);
  const before = !!client.isStarred;
  const changed = before !== value;
  if (changed) transaction.update(ref, { isStarred: value });
  return { cliente_id: client.id, nombre: client.name, reparto: route.name, cambiado: changed, antes: before, despues: value };
});

/**
 * Aplica los comandos pendientes de la ficha más el nuevo, en la misma
 * transacción y con el mismo reductor que la app (commitVisitCommands).
 * Así el resultado es idéntico a tocar el botón y se puede deshacer desde la app.
 */
const applyCommand = async (
  db: Firestore, transaction: Transaction, loaded: Loaded, command: VisitCommand, writerId: string,
): Promise<{ client: Client | null; outcome: VisitResult['outcome'] }> => {
  let client: Client | null = loaded.client;
  const pending = Array.isArray(client.visitCommands) ? client.visitCommands : [];
  const updates: Partial<Client> = {};
  const results: VisitResult[] = [...(client.visitResults || [])];
  const changes: Array<DeliveryChange | null> = [];
  let outcome: VisitResult['outcome'] = 'stale';
  for (const current of [...pending, command]) {
    if (!client) break;
    const result = applyVisitCommand(client, current);
    changes.push(deliveryChangeFor(client, current, result));
    Object.assign(updates, result.updates);
    if (current?.id && current?.actorId) results.push({ id: current.id, actorId: current.actorId, outcome: result.outcome });
    if (current === command) outcome = result.outcome;
    client = result.client;
  }
  // Same delivery record as the app (deliveryRecords); reads before writes.
  const deliveries = client ? await Promise.all(mergeDeliveryChanges(changes).map(async (change) => {
    const ref = db.collection(DELIVERIES_COLLECTION).doc(change.id);
    const stored = await transaction.get(ref);
    return { change, ref, existing: stored.exists ? stored.data() : undefined };
  })) : [];
  if (!client) {
    transaction.delete(loaded.ref);
  } else {
    transaction.update(loaded.ref, {
      ...updates, visitCommands: [], visitResults: results.slice(-20), updatedAt: new Date(),
    });
    const now = new Date();
    deliveries.forEach(({ change, ref, existing }) => {
      const data = deliveryDocument(change, loaded.client, writerId, existing, 'assistant', now);
      if (data) transaction.set(ref, data, { merge: true });
    });
  }
  return { client, outcome };
};

export const projectPending = (client: Client): Client | null => {
  let projected: Client | null = client;
  for (const command of Array.isArray(client.visitCommands) ? client.visitCommands : []) {
    if (!projected) break;
    projected = applyVisitCommand(projected, command).client;
  }
  return projected;
};

/** «Listo» sobre la visita de `date` (yyyy-mm-dd). Rechaza si esa no es la visita pendiente. */
export const markDone = (
  db: Firestore, account: Account, clientId: string, date: string, noDelivery = false,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (!isValidIsoDate(date)) throw new WriteError(`Fecha inválida: ${date}. Usá aaaa-mm-dd.`);
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const current = projectPending(loaded.client);
  if (!current) throw new WriteError('La ficha ya fue completada y eliminada (nota de una vez).');
  if (current.freq === 'on_demand') throw new WriteError('El cliente está en el directorio, sin visita agendada.');
  if (current.isCompleted) throw new WriteError('Ese pedido de una vez ya está marcado como Listo.');
  // Una visita atrasada figura en «Hoy» pero conserva su fecha original:
  // se acepta cualquiera de las dos, mientras identifique una sola visita.
  // getNextVisitDate calcula una fecha para cualquier día de semana que se le
  // pase: solo se prueban los días asignados a la ficha, nunca el de `date`.
  const candidates = (current.freq === 'once' ? [undefined] : clientDays(current))
    .map((day) => createVisitCommand(current, account.uid, day, Date.now(), noDelivery))
    .filter((candidate): candidate is VisitCommand => !!candidate);
  const exact = candidates.find((candidate) => candidate.occurrence === date);
  const overdue = date === todayKey()
    ? [...new Map(candidates.filter((candidate) => candidate.occurrence < date)
      .map((candidate) => [candidate.occurrence, candidate])).values()]
    : [];
  const command = exact || (overdue.length === 1 ? overdue[0] : undefined);
  if (!command) {
    const pending = [...new Set(candidates.map((candidate) => candidate.occurrence))].sort();
    throw new WriteError(`Esa fecha no coincide con una visita pendiente (${pending.join(', ') || 'ninguna'}). No se marcó Listo.`);
  }
  const { client, outcome } = await applyCommand(db, transaction, loaded, command, account.uid);
  // «confirmed» is the app's redo of a visit that was undone (the receipt is reactivated).
  if (outcome !== 'applied' && outcome !== 'confirmed') throw new WriteError(`La app no aplicó el Listo (resultado: ${outcome}).`);
  return {
    cliente_id: loaded.client.id, nombre: loaded.client.name, reparto: loaded.route.name, cambiado: true,
    antes: { visita: command.occurrence },
    despues: { proxima_visita: client ? nextVisit(client) : null, ficha_eliminada: !client, entrega: !noDelivery },
  };
});

/** Deshace el último Listo de esta cuenta sobre la ficha (como el botón Deshacer). */
export const undoDone = (
  db: Firestore, account: Account, clientId: string,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const current = projectPending(loaded.client);
  if (!current) throw new WriteError('La ficha ya no existe.');
  const command = undoForCompletedClient(current, account.uid);
  if (!command) throw new WriteError('No hay un Listo de esta cuenta para deshacer en esa ficha.');
  const before = nextVisit(current);
  const { client, outcome } = await applyCommand(db, transaction, loaded, command, account.uid);
  if (outcome !== 'undone') throw new WriteError(`No se pudo deshacer (resultado: ${outcome}).`);
  return {
    cliente_id: loaded.client.id, nombre: loaded.client.name, reparto: loaded.route.name, cambiado: true,
    antes: { proxima_visita: before }, despues: { proxima_visita: client ? nextVisit(client) : null },
  };
});

/**
 * Adelanta la próxima visita de un cliente con frecuencia a una fecha más
 * cercana del MISMO día de semana. Hace lo mismo que cambiar la «fecha de
 * inicio» en Editar cliente (EditClientModal): fija specificDate, reinicia
 * lastVisited/doneFor para que el ciclo arranque en esa fecha y conserva la
 * última entrega real en lastDeliveredAt. No cambia días, frecuencia ni orden.
 */
export const advanceVisit = (
  db: Firestore, account: Account, clientId: string, date: string,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (!isValidIsoDate(date)) throw new WriteError(`Fecha inválida: ${date}. Usá aaaa-mm-dd.`);
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const current = projectPending(loaded.client);
  if (!current) throw new WriteError('La ficha ya no existe.');
  if (current.freq === 'once' || current.freq === 'on_demand') {
    throw new WriteError('Solo se adelantan clientes con frecuencia; un pedido de una vez o de directorio se agenda aparte.');
  }
  if (current.isNote) throw new WriteError('Las notas no se reagendan.');
  if (!clientDays(current).includes(weekdayOf(date))) {
    throw new WriteError(`${date} es ${weekdayOf(date)} y el cliente va ${clientDays(current).join(', ')}: solo se adelanta manteniendo el día.`);
  }
  if (date < todayKey()) throw new WriteError('La fecha ya pasó.');
  const before = nextVisit(current);
  if (!before) throw new WriteError('El cliente no tiene una próxima visita calculada.');
  if (date >= before) throw new WriteError(`La próxima visita ya es ${before}; ${date} no la adelanta.`);
  if (Array.isArray(loaded.client.visitCommands) && loaded.client.visitCommands.length) {
    throw new WriteError('La ficha tiene un Listo pendiente de aplicar desde la app; reintentar en unos segundos.');
  }
  const lastDelivery = getLastVisitDate(current);
  const updates: Record<string, unknown> = {
    specificDate: date,
    lastVisited: null,
    doneFor: '',
    scheduleRevision: newVisitId(),
    isCompleted: false,
    completedAt: null,
  };
  if (lastDelivery) updates.lastDeliveredAt = lastDelivery;
  const after = nextVisit({ ...current, ...updates } as Client);
  if (after !== date) throw new WriteError(`La app calcularía ${after} en lugar de ${date}; no se cambió nada.`);
  transaction.update(loaded.ref, updates);
  return {
    cliente_id: current.id, nombre: current.name, reparto: loaded.route.name, cambiado: true,
    antes: { proxima_visita: before }, despues: { proxima_visita: after },
  };
});

export const FREQUENCIES: Record<string, Client['freq']> = {
  semanal: 'weekly', weekly: 'weekly',
  quincenal: 'biweekly', biweekly: 'biweekly', 'cada 15 dias': 'biweekly', 'cada 15 días': 'biweekly',
  'cada 3 semanas': 'triweekly', triweekly: 'triweekly', 'cada 20 dias': 'triweekly', 'cada 20 días': 'triweekly',
  mensual: 'monthly', monthly: 'monthly',
};

/**
 * Cambia la frecuencia de un cliente con agenda periódica, igual que Editar
 * cliente (EditClientModal): al cambiar la frecuencia se reinicia
 * lastVisited/doneFor para que la próxima visita se recalcule, se conserva la
 * última entrega real y se renueva scheduleRevision. Con `startDate` (mismo día
 * de semana) fija además desde cuándo corre el ciclo. No cambia días ni orden.
 */
export const changeFrequency = (
  db: Firestore, account: Account, clientId: string, frequency: string, startDate?: string,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const freq = FREQUENCIES[frequency.trim().toLowerCase()];
  if (!freq) throw new WriteError(`Frecuencia desconocida: ${frequency}. Usá semanal, quincenal, cada 3 semanas o mensual.`);
  if (startDate !== undefined && !isValidIsoDate(startDate)) throw new WriteError(`Fecha inválida: ${startDate}. Usá aaaa-mm-dd.`);
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const current = projectPending(loaded.client);
  if (!current) throw new WriteError('La ficha ya no existe.');
  if (current.isNote) throw new WriteError('Las notas no tienen frecuencia.');
  if (current.freq === 'once' || current.freq === 'on_demand') {
    throw new WriteError('Solo se cambia la frecuencia de clientes que ya tienen agenda periódica; un pedido de una vez o de directorio se agenda desde la app.');
  }
  if (Array.isArray(loaded.client.visitCommands) && loaded.client.visitCommands.length) {
    throw new WriteError('La ficha tiene un Listo pendiente de aplicar desde la app; reintentar en unos segundos.');
  }
  if (startDate !== undefined) {
    if (!clientDays(current).includes(weekdayOf(startDate))) {
      throw new WriteError(`${startDate} es ${weekdayOf(startDate)} y el cliente va ${clientDays(current).join(', ')}: la fecha de inicio tiene que mantener el día.`);
    }
    if (startDate < todayKey()) throw new WriteError('La fecha de inicio ya pasó.');
  }
  const before = { frecuencia: FREQ_LABELS[current.freq] || current.freq, proxima_visita: nextVisit(current) };
  const freqChanged = freq !== current.freq;
  const dateChanged = startDate !== undefined && startDate !== (current.specificDate || '');
  if (!freqChanged && !dateChanged) {
    return { cliente_id: current.id, nombre: current.name, reparto: loaded.route.name, cambiado: false, antes: before, despues: before };
  }
  const updates: Record<string, unknown> = {
    freq, lastVisited: null, doneFor: '', scheduleRevision: newVisitId(), isCompleted: false, completedAt: null,
  };
  if (dateChanged) updates.specificDate = startDate;
  const lastDelivery = getLastVisitDate(current);
  if (lastDelivery) updates.lastDeliveredAt = lastDelivery;
  const after = { frecuencia: FREQ_LABELS[freq] || freq, proxima_visita: nextVisit({ ...current, ...updates } as Client) };
  transaction.update(loaded.ref, updates);
  return { cliente_id: current.id, nombre: current.name, reparto: loaded.route.name, cambiado: true, antes: before, despues: after };
});

/** Una colección entera del reparto dentro de la transacción; cuenta para el tope diario (cada reintento también). */
export const fullScopeRead = (
  db: Firestore, transaction: Transaction, account: Account, route: Route, collection: string,
) => Promise.all(scopeQueries(db, collection, account.uid, route).map(async (query) => {
  const label = loadLabel(collection, route);
  checkFullLoad(label);
  const snap = await transaction.get(query);
  recordFullLoad(label, snap.size);
  return snap;
}));

/** Todas las fichas del reparto leídas dentro de la transacción (las mismas que clientsRef en la app). */
export const routeClients = async (
  db: Firestore, transaction: Transaction, account: Account, route: Route,
): Promise<Array<{ ref: DocumentReference; client: Client }>> => {
  const snaps = await fullScopeRead(db, transaction, account, route, 'clients');
  return snaps.flatMap((snap) => snap.docs)
    .filter((doc) => belongsToProfileScope(doc.data(), account.uid, route.groupId))
    .map((doc) => ({ ref: doc.ref, client: withDefaults(doc.id, doc.data()) }));
};

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Si una ficha periódica pasará ese día más adelante en su ciclo (p. ej. un
 * semanal cuya próxima visita es la semana anterior): agendaFor solo mira la
 * próxima visita pendiente.
 */
const cycleFallsOn = (client: Client, date: string): boolean => {
  if (client.freq === 'once' || client.freq === 'on_demand' || client.isCompleted) return false;
  const day = weekdayOf(date);
  if (!clientDays(client).includes(day)) return false;
  const next = getNextVisitDate(client, day);
  if (!next) return false;
  const from = new Date(`${toLocalDateString(next)}T12:00:00`).getTime();
  const days = Math.round((new Date(`${date}T12:00:00`).getTime() - from) / 86_400_000);
  return days >= 0 && days % (intervalWeeksForFreq(client.freq) * 7) === 0;
};

/**
 * «Directorio → Agendar / + Visita → Una vez» (ScheduleModal +
 * scheduleFromDirectory en modo 'add'), con los mismos datos y las mismas tres
 * salidas que la app:
 * - ficha de directorio (on_demand o «Sin Asignar»): esa misma ficha pasa a
 *   ser la visita de una vez;
 * - cliente que ya está en agenda: reutiliza una ficha on_demand duplicada
 *   (mismo nombre y teléfono) o crea otra con el mismo customerId, sin tocar
 *   la original. La ficha nueva se arma como la función create-client.
 * La visita queda primera en la lista de ese día. Si el cliente (misma
 * identidad estable) ya tiene una visita esa fecha, no agrega otra.
 */
export const scheduleOnce = (
  db: Firestore, account: Account, catalog: CatalogProduct[],
  clientId: string, date: string, products: Record<string, number>, place = false,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (!isValidIsoDate(date)) throw new WriteError(`Fecha inválida: ${date}. Usá aaaa-mm-dd.`);
  if (date < todayKey()) throw new WriteError('La fecha ya pasó.');
  validateProducts(catalog, products);
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const { route } = loaded;
  const clientData = loaded.client;
  if (clientData.isNote) throw new WriteError('Las notas no se agendan.');
  if (Array.isArray(clientData.visitCommands) && clientData.visitCommands.length) {
    throw new WriteError('La ficha tiene un Listo pendiente de aplicar desde la app; reintentar en unos segundos.');
  }
  const all = await routeClients(db, transaction, account, route);
  const cleanProducts: Record<string, number> = {};
  Object.entries(products).forEach(([id, amount]) => { if (amount > 0) cleanProducts[id] = amount; });
  const dayName = DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
  const base = { cliente_id: clientData.id, nombre: clientData.name, reparto: route.name };

  const stableId = getStableClientId(clientData);
  const sameClient = all
    .filter((entry) => getStableClientId(entry.client) === stableId)
    .map((entry) => projectPending(entry.client))
    .filter((client): client is Client => !!client && !client.isNote);
  const existing = agendaFor(sameClient, date)[0]?.client || sameClient.find((client) => cycleFallsOn(client, date));
  if (existing) {
    const visit = { ficha_id: existing.id, fecha: date, dia: dayName, productos: productMap(existing) };
    return {
      ...base, cambiado: false, antes: visit, despues: visit,
      aviso: 'Ya tiene una visita ese día; no se agregó otra. Para cambiar lo que lleva, usá fijar_productos con ficha_id.',
    };
  }

  const savedAddresses = getClientAddresses(clientData);
  const newData: Record<string, any> = {
    customerId: clientData.customerId || clientData.id,
    name: clientData.name,
    phone: clientData.phone,
    phones: getClientPhones(clientData),
    addresses: savedAddresses,
    ...locationFields(savedAddresses[0]),
    ...dataScopeFields(account.uid, route.groupId),
    userId: account.uid,
    freq: 'once',
    scheduleRevision: newVisitId(),
    updatedAt: new Date(),
    notes: '',
    isPinned: false,
    isCompleted: false,
    isStarred: false,
    isNote: false,
    isInactive: false,
    alarm: '',
    alarmDay: '',
    alarmScheduledFor: null,
    products: cleanProducts,
    completedAt: null,
    previousDeliveredAt: null,
  };
  const sourceLastDelivery = getLastVisitDate(clientData);
  if (sourceLastDelivery) newData.lastDeliveredAt = sourceLastDelivery;

  // Primera del día: una posición antes de la menor de las fichas activas ese día.
  const existingInDay = all.map((entry) => entry.client).filter((c) =>
    c.freq !== 'on_demand' && !c.isCompleted
    && ((c.visitDays && c.visitDays.includes(dayName)) || c.visitDay === dayName));
  const minOrder = existingInDay.length
    ? Math.min(...existingInDay.map((c) => {
      const order = c.listOrders?.[dayName] ?? c.listOrder ?? 0;
      return order > 100000 ? 0 : order;
    }))
    : 0;
  const newOrder = minOrder - 1;
  newData.visitDay = dayName;
  newData.visitDays = [dayName];
  newData.specificDate = date;
  newData.listOrder = newOrder;
  newData.listOrders = { [dayName]: newOrder };

  // Como el modal de la app, la ficha de la visita queda con nota vacía y sin
  // estrella: en una ficha de directorio eso pisa su nota y su estrella.
  const before = {
    frecuencia: FREQ_LABELS[clientData.freq] || clientData.freq, proxima_visita: nextVisit(clientData),
    nota: clientData.notes || '', favorito: !!clientData.isStarred,
  };
  const wasInDirectory = clientData.freq === 'on_demand' || clientData.visitDay === 'Sin Asignar';
  const reusable = wasInDirectory ? undefined : findExactClientMatch(
    all.map((entry) => entry.client).filter((candidate) => candidate.id !== clientData.id && candidate.freq === 'on_demand'),
    clientData.name,
    clientData.phone,
  );
  const fichaKind: 'misma' | 'reutilizada' | 'nueva' = wasInDirectory ? 'misma' : (reusable ? 'reutilizada' : 'nueva');
  let ref = loaded.ref;
  if (reusable) ref = db.collection('clients').doc(reusable.id);
  else if (!wasInDirectory) ref = db.collection('clients').doc();
  if (reusable) {
    const existingDelivery = getLastVisitDate(reusable);
    if (existingDelivery && (!newData.lastDeliveredAt || existingDelivery.getTime() > newData.lastDeliveredAt.getTime())) {
      newData.lastDeliveredAt = existingDelivery;
    }
  }

  // ubicar: en vez de primera, entre las dos paradas donde menos desvío agrega.
  let placement: (PositionSuggestion & { aplicada: boolean }) | undefined;
  let reorder: Array<{ id: string; position: number }> = [];
  if (place) {
    const routeAll = all.map((entry) => projectPending(entry.client)).filter((client): client is Client => !!client);
    const visit = { ...withDefaults(ref.id, newData), id: ref.id } as Client;
    const suggestion = suggestPosition(routeAll, visit, date);
    placement = { ...suggestion, aplicada: false };
    if (suggestion.posicion !== null) {
      const list = dayList([...routeAll.filter((client) => client.id !== ref.id), visit], dayName);
      const plan = planPositionChange(list, ref.id, suggestion.posicion, dayName);
      const own = plan.updates.find((update) => update.id === ref.id);
      if (own) {
        newData.listOrder = own.position;
        newData.listOrders = { [dayName]: own.position };
      }
      reorder = plan.updates.filter((update) => update.id !== ref.id);
      placement.aplicada = true;
    }
  }
  const after = {
    ficha_id: ref.id, ficha: fichaKind, fecha: date, dia: dayName, productos: cleanProducts, nota: '', favorito: false,
    ...(placement ? { posicion: placement.aplicada ? placement.posicion : 1 } : {}),
  };
  const result = {
    ...base, cambiado: true, antes: before, despues: after, ...(placement ? { ubicacion: placement } : {}),
  };

  if (fichaKind === 'nueva') {
    newData.lastDeliveredAt = getLastVisitDate(clientData);
    newData.createdAt = new Date();
    // La app manda newData por HTTP (JSON) a create-client, que lo sanea y lo crea.
    const { data } = sanitizeClientData({ id: ref.id, data: JSON.parse(JSON.stringify(newData)) }, account.uid);
    // create-client controla además el límite del plan gratis, que sale de
    // RevenueCat; este servidor corre como el dueño de la cuenta y no lo consulta.
    transaction.create(ref, data);
    transaction.set(db.collection('users').doc(account.uid), { clientCreateVersion: 1 }, { merge: true });
  } else {
    transaction.update(ref, toExistingClientUpdate(newData));
  }
  // Solo si el día hubo que renumerarse (igual que Cambiar posición en la app).
  reorder.forEach(({ id, position }) => {
    transaction.update(db.collection('clients').doc(id), { [`listOrders.${dayName}`]: position });
  });
  return result;
});

/**
 * «Cambiar posición» de Inicio (useClients.changePosition): mueve la ficha al
 * número `position` de la lista de ese día de semana con planPositionChange,
 * así que en general es una sola escritura (el punto medio entre sus nuevos
 * vecinos). `clients` es la copia en vivo del reparto: no se relee la
 * colección; dentro de la transacción solo se leen la ficha y los vecinos de
 * los que depende el orden nuevo, y si cambiaron no se escribe nada.
 */
export const changePosition = (
  db: Firestore, account: Account, clients: Client[], clientId: string, date: string, position: number,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (!isValidIsoDate(date)) throw new WriteError(`Fecha inválida: ${date}. Usá aaaa-mm-dd.`);
  if (!Number.isInteger(position) || position < 1) throw new WriteError(`Posición inválida: ${position}.`);
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const day = weekdayOf(date);
  const fresh = projectPending(loaded.client);
  if (!fresh) throw new WriteError('La ficha ya no existe.');
  const list = dayList([...clients.filter((client) => client.id !== clientId), fresh], day);
  const currentIndex = list.findIndex((client) => client.id === clientId);
  if (currentIndex === -1) {
    throw new WriteError(`${fresh.name} no está en la lista del ${day} (solo se ordenan fichas activas de ese día).`);
  }
  // Como Inicio, una posición mayor que la lista la deja última.
  const bounded = Math.min(position, list.length);
  const base = { cliente_id: fresh.id, nombre: fresh.name, reparto: loaded.route.name };
  const plan = planPositionChange(list, clientId, bounded, day);
  const before = { dia: day, posicion: currentIndex + 1 };
  if (!plan.updates.length) return { ...base, cambiado: false, antes: before, despues: before };

  const moved = moveItemToPosition(list, clientId, bounded).items;
  const dependsOn = plan.updates.length > 1
    ? moved.filter((client) => client.id !== clientId)
    : [moved[plan.newIndex - 1], moved[plan.newIndex + 1]].filter((client): client is Client => !!client);
  const snaps = dependsOn.length ? await transaction.getAll(...dependsOn.map((client) => db.collection('clients').doc(client.id))) : [];
  snaps.forEach((snap, index) => {
    const live = dependsOn[index];
    if (!snap.exists || readDayOrder(withDefaults(snap.id, snap.data()), day) !== readDayOrder(live, day)) {
      throw new WriteError('El orden de ese día cambió mientras tanto (alguien lo movió desde la app); volvé a intentar.');
    }
  });
  plan.updates.forEach(({ id, position: order }) => {
    transaction.update(db.collection('clients').doc(id), { [`listOrders.${day}`]: order });
  });
  const neighbor = (client: Client | undefined) => (client ? client.name : null);
  return {
    ...base, cambiado: true, antes: before,
    despues: {
      dia: day, posicion: plan.newIndex + 1,
      anterior: neighbor(moved[plan.newIndex - 1]), siguiente: neighbor(moved[plan.newIndex + 1]),
    },
  };
});


/** Lee y controla los vecinos de los que depende un orden nuevo, como changePosition. */
const checkNeighbors = async (
  db: Firestore, transaction: Transaction, live: Client[], day: string,
): Promise<void> => {
  if (!live.length) return;
  const snaps = await transaction.getAll(...live.map((client) => db.collection('clients').doc(client.id)));
  snaps.forEach((snap, index) => {
    if (!snap.exists || readDayOrder(withDefaults(snap.id, snap.data()), day) !== readDayOrder(live[index], day)) {
      throw new WriteError('El orden de ese día cambió mientras tanto (alguien lo movió desde la app); volvé a intentar.');
    }
  });
};

/**
 * Cambia la fecha de la próxima visita (y opcionalmente la frecuencia), igual
 * que la fecha de inicio de Editar cliente (EditClientModal.handleSave): fija
 * specificDate, reinicia lastVisited/doneFor en las periódicas y conserva la
 * última entrega. Si la fecha cae otro día de semana, un cliente de un solo
 * día (o un pedido de una vez) pasa a ese día: la periódica conserva su número
 * de orden y la de una vez queda primera, como en la app; con `place`, donde
 * indica sugerir_posicion. `clients` es la copia en vivo del reparto: no se
 * relee la colección.
 */
export const rescheduleClient = (
  db: Firestore, account: Account, clients: Client[], clientId: string, date: string,
  frequency?: string, place = false,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (!isValidIsoDate(date)) throw new WriteError(`Fecha inválida: ${date}. Usá aaaa-mm-dd.`);
  if (date < todayKey()) throw new WriteError('La fecha ya pasó.');
  const freq = frequency === undefined ? undefined : FREQUENCIES[frequency.trim().toLowerCase()];
  if (frequency !== undefined && !freq) {
    throw new WriteError(`Frecuencia desconocida: ${frequency}. Usá semanal, quincenal, cada 3 semanas o mensual.`);
  }
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const current = projectPending(loaded.client);
  if (!current) throw new WriteError('La ficha ya no existe.');
  if (current.isNote) throw new WriteError('Las notas no se reagendan.');
  if (current.freq === 'on_demand') throw new WriteError('Está en el directorio, sin visita: para agendarlo usá agendar_una_vez.');
  if (current.isCompleted) throw new WriteError('Ese pedido de una vez ya está Listo; para otra visita usá agendar_una_vez.');
  if (current.alarm) throw new WriteError('La ficha tiene una alarma: cambiale la fecha desde la app.');
  if (Array.isArray(loaded.client.visitCommands) && loaded.client.visitCommands.length) {
    throw new WriteError('La ficha tiene un Listo pendiente de aplicar desde la app; reintentar en unos segundos.');
  }
  const newFreq = freq || current.freq;
  const newDay = weekdayOf(date);
  const days = clientDays(current);
  const oldDay = current.visitDay && current.visitDay !== 'Sin Asignar' ? current.visitDay : days[0];
  const moves = !days.includes(newDay);
  if (moves && days.length > 1) {
    throw new WriteError(`El cliente va ${days.join(', ')} y ${date} es ${newDay}: con varios días, el día se cambia desde la app.`);
  }
  const stableId = getStableClientId(current);
  const siblings = clients
    .filter((client) => client.id !== current.id && getStableClientId(client) === stableId)
    .map((client) => projectPending(client))
    .filter((client): client is Client => !!client && !client.isNote);
  if (agendaFor(siblings, date).length || siblings.some((client) => cycleFallsOn(client, date))) {
    throw new WriteError(`Ya tiene otra ficha con visita el ${date}; no se cambió nada.`);
  }
  const base = { cliente_id: current.id, nombre: current.name, reparto: loaded.route.name };
  const before = {
    frecuencia: FREQ_LABELS[current.freq] || current.freq, dias: days, proxima_visita: nextVisit(current),
  };
  if (newFreq === current.freq && before.proxima_visita === date) {
    return { ...base, cambiado: false, antes: before, despues: before };
  }

  const updates: Record<string, any> = {
    specificDate: date, scheduleRevision: newVisitId(), isCompleted: false, completedAt: null,
  };
  if (newFreq !== current.freq) updates.freq = newFreq;
  if (newFreq !== 'once') {
    updates.lastVisited = null;
    updates.doneFor = '';
  }
  const lastDelivery = getLastVisitDate(current);
  if (lastDelivery) updates.lastDeliveredAt = lastDelivery;
  if (current.isInactive) updates.isInactive = false;
  const others = clients.filter((client) => client.id !== current.id);
  let reorder: Array<{ id: string; position: number }> = [];
  let placement: (PositionSuggestion & { aplicada: boolean }) | undefined;
  if (moves) {
    updates.visitDay = newDay;
    updates.visitDays = [newDay];
    const orders: Record<string, number> = { ...(current.listOrders || {}) };
    if (oldDay) delete orders[oldDay];
    if (newFreq === 'once') {
      const inDay = dayList(others, newDay).map((client) => {
        const order = client.listOrders?.[newDay] ?? client.listOrder ?? 0;
        return typeof order === 'number' && isFinite(order) && order < 100000 ? order : 0;
      });
      orders[newDay] = (inDay.length ? Math.min(...inDay) : 0) - 1;
    } else {
      orders[newDay] = (oldDay ? current.listOrders?.[oldDay] : undefined) ?? current.listOrder ?? 0;
    }
    updates.listOrders = orders;
    if (place) {
      const moved = { ...current, ...updates } as Client;
      const suggestion = suggestPosition([...others, moved], moved, date);
      placement = { ...suggestion, aplicada: false };
      if (suggestion.posicion !== null) {
        const list = dayList([...others, moved], newDay);
        const plan = planPositionChange(list, current.id, suggestion.posicion, newDay);
        const own = plan.updates.find((update) => update.id === current.id);
        if (own) orders[newDay] = own.position;
        reorder = plan.updates.filter((update) => update.id !== current.id);
        await checkNeighbors(db, transaction, list.filter((client) => reorder.some((update) => update.id === client.id)), newDay);
        placement.aplicada = true;
      }
    }
  }
  const afterClient = { ...current, ...updates } as Client;
  const afterDate = nextVisit(afterClient);
  if (afterDate !== date) throw new WriteError(`La app calcularía ${afterDate} en lugar de ${date}; no se cambió nada.`);
  transaction.update(loaded.ref, updates);
  reorder.forEach(({ id, position }) => {
    transaction.update(db.collection('clients').doc(id), { [`listOrders.${newDay}`]: position });
  });
  const list = dayList([...others, afterClient], newDay);
  return {
    ...base, cambiado: true, antes: before,
    despues: {
      frecuencia: FREQ_LABELS[newFreq] || newFreq, dias: clientDays(afterClient), proxima_visita: afterDate,
      posicion: list.findIndex((client) => client.id === current.id) + 1,
    },
    ...(placement ? { ubicacion: placement } : {}),
  };
});

/**
 * «Quitar de la lista» de Inicio (useClients.deleteFromDay) sobre el día de
 * semana de `date`: con varios días le saca solo ese; si era el único, la ficha
 * vuelve al Directorio con su última entrega. Diferencia con la app: un pedido
 * de una vez de alguien que ya tiene otra ficha (agenda o directorio) se borra
 * en vez de volver al Directorio como copia, igual que Borrar completados.
 * `related` da las deudas y transferencias en caché, solo para ese caso.
 */
export const removeFromList = (
  db: Firestore, account: Account, clients: Client[], clientId: string, date: string,
  related: () => Promise<Array<{ clientId?: string; customerId?: string }>>,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (!isValidIsoDate(date)) throw new WriteError(`Fecha inválida: ${date}. Usá aaaa-mm-dd.`);
  const loaded = await loadForWrite(db, transaction, account, clientId);
  const current = projectPending(loaded.client);
  if (!current) throw new WriteError('La ficha ya no existe.');
  if (current.isNote) throw new WriteError('Las notas se borran desde la app.');
  if (current.alarm) throw new WriteError('La ficha tiene una alarma: quitala desde la app.');
  if (Array.isArray(loaded.client.visitCommands) && loaded.client.visitCommands.length) {
    throw new WriteError('La ficha tiene un Listo pendiente de aplicar desde la app; reintentar en unos segundos.');
  }
  const base = { cliente_id: current.id, nombre: current.name, reparto: loaded.route.name };
  const days = clientDays(current);
  const before = { frecuencia: FREQ_LABELS[current.freq] || current.freq, dias: days, proxima_visita: nextVisit(current) };
  if (current.freq === 'on_demand') return { ...base, cambiado: false, antes: before, despues: before, aviso: 'Ya está en el directorio.' };
  const day = weekdayOf(date);
  if (!days.includes(day)) throw new WriteError(`${current.name} no está en la lista del ${day} (va ${days.join(', ') || 'sin día'}).`);

  if (days.length > 1) {
    const remaining = days.filter((candidate) => candidate !== day);
    const updates = { scheduleRevision: newVisitId(), visitDays: remaining, visitDay: remaining[0] };
    transaction.update(loaded.ref, updates);
    const after = { ...current, ...updates } as Client;
    return { ...base, cambiado: true, antes: before, despues: { frecuencia: before.frecuencia, dias: remaining, proxima_visita: nextVisit(after) } };
  }

  const stableId = getStableClientId(current);
  const keeper = current.freq === 'once'
    ? clients.find((client) => client.id !== current.id && !client.isNote && getStableClientId(client) === stableId)
    : undefined;
  if (keeper) {
    const linked = Object.keys(current.relationships || {}).length
      || clients.some((client) => client.id !== current.id && client.relationships?.[current.id]);
    if (linked) throw new WriteError('Esa ficha tiene Parentesco; quitala desde la app.');
    const records = await related();
    if (records.some((record) => record.clientId === current.id && !record.customerId)) {
      throw new WriteError('Esa ficha tiene deudas o transferencias propias; quitala desde la app.');
    }
    transaction.delete(loaded.ref);
    return {
      ...base, cambiado: true, antes: before,
      despues: { ficha_eliminada: true, queda: { ficha_id: keeper.id, nombre: keeper.name, frecuencia: FREQ_LABELS[keeper.freq] || keeper.freq } },
    };
  }

  transaction.update(loaded.ref, {
    scheduleRevision: newVisitId(),
    freq: 'on_demand',
    visitDay: 'Sin Asignar',
    visitDays: [],
    specificDate: '',
    listOrders: {},
    listOrder: 0,
    isCompleted: false,
    completedAt: null,
    previousDeliveredAt: null,
    ...getDirectoryDeliveryHistoryUpdate(current),
    alarm: '',
    alarmDay: '',
    alarmScheduledFor: null,
  });
  return { ...base, cambiado: true, antes: before, despues: { frecuencia: FREQ_LABELS.on_demand, dias: [], proxima_visita: null } };
});

/**
 * Deudas o transferencias del cliente dentro de la transacción: mismas
 * consultas de alcance que la app y misma identidad estable (customerId, o el
 * id exacto de la ficha en registros viejos). `clients` son las fichas del
 * reparto, para resolver esa identidad.
 */
const relatedRecords = async (
  db: Firestore, transaction: Transaction, account: Account, route: Route,
  collection: 'debts' | 'transfers', client: Client, clients: Client[],
): Promise<QueryDocumentSnapshot[]> => {
  const identity = buildClientIdentityIndex(clients);
  const stableId = getStableClientId(client);
  const snaps = await fullScopeRead(db, transaction, account, route, collection);
  return snaps.flatMap((snap) => snap.docs)
    .filter((doc) => belongsToProfileScope(doc.data(), account.uid, route.groupId))
    .filter((doc) => getRelatedRecordStableClientId(doc.data() as any, identity) === stableId);
};

const round2 = (value: number): number => Math.round(value * 100) / 100;
const CENT = 0.005;

interface DebtLine { ref: DocumentReference; id: string; amount: number; date: Date | null }

const describeDebts = (lines: DebtLine[]) => ({
  deuda_total: round2(lines.reduce((sum, line) => sum + line.amount, 0)),
  deudas: lines.map((line) => ({ monto: line.amount, fecha: line.date ? toLocalDateString(line.date) : null })),
});

/**
 * Registra un pago de deuda igual que Deudas en la app: «Registrar pago»
 * (borra la deuda) y, si el pago no la cubre entera, «Editar deuda» con el
 * saldo que queda. Salda primero las deudas más viejas. Lo pagado por encima
 * de la deuda vuelve como `sobrante` (saldo a favor): RutaWater no lo guarda,
 * se anota en la nota. `expectedTotal` es la deuda que se leyó antes: si
 * cambió (otro pago, un reintento), no se toca nada.
 */
export const registerPayment = (
  db: Firestore, account: Account, clientId: string, amount: number, expectedTotal: number, clients: Client[],
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new WriteError(`Monto inválido: ${amount}.`);
  if (!Number.isFinite(expectedTotal) || expectedTotal < 0) throw new WriteError(`deuda_esperada inválida: ${expectedTotal}.`);
  const { client, route } = await loadForWrite(db, transaction, account, clientId);
  const docs = await relatedRecords(db, transaction, account, route, 'debts', client, clients);
  const lines: DebtLine[] = docs
    .map((doc) => ({ ref: doc.ref, id: doc.id, amount: Number(doc.data().amount) || 0, date: parseDate(doc.data().createdAt) }))
    .filter((line) => line.amount > 0)
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.id.localeCompare(b.id));
  const before = describeDebts(lines);
  if (!lines.length) throw new WriteError('El cliente no tiene deudas registradas: no se registró nada (un pago adelantado se anota en la nota).');
  if (Math.abs(before.deuda_total - expectedTotal) > CENT) {
    throw new WriteError(`La deuda cambió mientras tanto: ahora es ${before.deuda_total} y se esperaba ${expectedTotal}. No se registró nada.`);
  }
  let remaining = round2(amount);
  const left: DebtLine[] = [];
  for (const line of lines) {
    if (remaining >= line.amount - CENT) {
      transaction.delete(line.ref);
      remaining = round2(remaining - line.amount);
    } else if (remaining > CENT) {
      const rest = round2(line.amount - remaining);
      transaction.update(line.ref, { amount: rest });
      left.push({ ...line, amount: rest });
      remaining = 0;
    } else {
      left.push(line);
    }
  }
  const surplus = round2(Math.max(0, remaining));
  return {
    cliente_id: client.id, nombre: client.name, reparto: route.name, cambiado: true,
    antes: before, despues: describeDebts(left),
    monto_recibido: round2(amount), aplicado_a_deuda: round2(amount - surplus), sobrante: surplus,
  };
});

/**
 * «Revisar» en Deudas o «Gestionar transferencia → Agregar» en la tarjeta:
 * deja al cliente en la lista Transferencias para que se controle si el
 * dinero llegó. Mismo documento que crea la app (useTransfers.addTransfer).
 * Si ya tenía una pendiente no crea otra. Marcarla como revisada (borrarla)
 * queda solo para la app.
 */
export const markTransferForReview = (
  db: Firestore, account: Account, clientId: string, clients: Client[], amount?: number, accountName?: string,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const { client, route } = await loadForWrite(db, transaction, account, clientId);
  if (client.isNote) throw new WriteError('Las notas no tienen transferencias.');
  const existing = await relatedRecords(db, transaction, account, route, 'transfers', client, clients);
  if (existing.length) {
    return {
      cliente_id: client.id, nombre: client.name, reparto: route.name, cambiado: false,
      antes: { transferencia_pendiente: true }, despues: { transferencia_pendiente: true },
    };
  }
  const ref = db.collection('transfers').doc();
  transaction.set(ref, {
    ...dataScopeFields(account.uid, route.groupId),
    ...getRelatedClientReference(client),
    clientName: client.name,
    clientAddress: client.address || '',
    clientLat: client.lat || null,
    clientLng: client.lng || null,
    clientMapsLink: client.mapsLink || null,
    // Lo que se ve en Transferencias para controlar en el banco (24/10/2026).
    amount: amount && amount > 0 ? amount : null,
    account: accountName?.trim() || null,
    createdAt: new Date(),
  });
  return {
    cliente_id: client.id, nombre: client.name, reparto: route.name, cambiado: true,
    antes: { transferencia_pendiente: false }, despues: { transferencia_pendiente: true, monto: amount || null, cuenta: accountName || null },
  };
});

const phoneDigits = (value: string): string => (value || '').replace(/\D/g, '').slice(-8);

/**
 * Directorio → «+» (useClients.addClient sin día): una ficha nueva solo de
 * directorio, sin productos ni visitas. Antes de crearla busca en el reparto
 * la misma persona (nombre + teléfono, findExactClientMatch) y cualquier ficha
 * con el mismo teléfono: si hay, no crea nada y las devuelve. Las coordenadas
 * salen del link de Maps antes de escribir, como fillClientCoordinates en la app.
 */
export const createClient = async (
  db: Firestore, account: Account, route: Route,
  fields: { name: string; address: string; phone: string; mapsLink: string; notes: string },
): Promise<ChangeResult> => {
  if (!route.writable) throw new WriteError(`El reparto «${route.name}» no admite cambios ahora (cuenta o grupo inactivo).`);
  const name = fields.name.trim();
  const phone = fields.phone.trim();
  const mapsLink = fields.mapsLink.trim();
  if (!name) throw new WriteError('Falta el nombre.');
  if (phone && phoneDigits(phone).length < 8) throw new WriteError(`Teléfono inválido: «${phone}».`);
  // Fuera de la transacción: sigue la redirección del link corto (puede tardar unos segundos).
  const point = mapsLink ? await resolveMapsCoordinates(mapsLink).catch(() => null) : null;

  return db.runTransaction(async (transaction) => {
    const all = (await routeClients(db, transaction, account, route)).map((entry) => entry.client);
    const digits = phoneDigits(phone);
    const sameName = findExactClientMatch(all, name, phone);
    const samePhone = digits
      ? all.filter((client) => !client.isNote && getClientPhones(client).some((entry) => phoneDigits(entry.number) === digits))
      : [];
    const matches = [...new Map([...(sameName ? [sameName] : []), ...samePhone].map((client) => [client.id, client])).values()];
    const base = { cliente_id: matches[0]?.id || '', nombre: name, reparto: route.name };
    if (matches.length) {
      const found = matches.map((client) => ({
        id: client.id, nombre: client.name, direccion: client.address, frecuencia: FREQ_LABELS[client.freq] || client.freq,
      }));
      return {
        ...base, cambiado: false, antes: found, despues: found,
        aviso: 'Ya hay una ficha con ese nombre y teléfono, o con ese teléfono: no se creó otra. Usá su id (agendar_una_vez, etc.).',
      };
    }
    const ref = db.collection('clients').doc();
    const lat = point ? formatCoordinate(point.lat) : '';
    const lng = point ? formatCoordinate(point.lng) : '';
    const newData: Record<string, any> = {
      ...dataScopeFields(account.uid, route.groupId),
      userId: account.uid,
      name,
      address: fields.address.trim(),
      phone,
      phones: phone ? [{ id: 'primary', number: phone, isPrimary: true }] : [],
      lat,
      lng,
      mapsLink,
      notes: fields.notes.trim(),
      freq: 'on_demand',
      visitDay: 'Sin Asignar',
      visitDays: [],
      specificDate: '',
      products: {},
      listOrder: 0,
      listOrders: {},
      isCompleted: false,
      isStarred: false,
      isPinned: false,
      isNote: false,
      alarm: '',
      alarmDay: '',
      alarmScheduledFor: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Igual que create-client: se sanea como lo haría la función de Netlify.
    // El límite del plan gratis sale de RevenueCat y no se consulta (ver scheduleOnce).
    const { data } = sanitizeClientData({ id: ref.id, data: JSON.parse(JSON.stringify(newData)) }, account.uid);
    transaction.create(ref, data);
    transaction.set(db.collection('users').doc(account.uid), { clientCreateVersion: 1 }, { merge: true });
    return {
      ...base,
      cliente_id: ref.id,
      cambiado: true,
      antes: null,
      despues: {
        direccion: newData.address, telefono: phone, mapa: mapsLink, notas: newData.notes,
        frecuencia: 'sin agenda (directorio)',
        coordenadas: point ? { lat, lng } : null,
        ...(mapsLink && !point ? { aviso: 'No se pudieron sacar coordenadas del link: la ficha queda sin ubicación para ordenar el recorrido.' } : {}),
      },
    };
  });
};

// Notas sueltas de la agenda (tarjetas «NOTA»), como Inicio → «Nota» en la app
// (Jonathan, 29/10/2026: que el vigilante las cree para el día que le pida).
const noteResult = (note: Client, route: Route) => ({
  cliente_id: note.id, nombre: 'NOTA', reparto: route.name,
});

export const createDayNote = async (
  db: Firestore, account: Account, route: Route, date: string, text: string,
): Promise<ChangeResult> => {
  if (!route.writable) throw new WriteError(`El reparto «${route.name}» no admite cambios ahora (cuenta o grupo inactivo).`);
  if (!isValidIsoDate(date)) throw new WriteError('Fecha inválida: usá aaaa-mm-dd.');
  if (date < todayKey()) throw new WriteError(`La fecha ${date} ya pasó.`);
  const notes = text.trim();
  if (!notes) throw new WriteError('Falta el texto de la nota.');
  if (notes.length > 2000) throw new WriteError('La nota supera los 2000 caracteres.');
  const day = DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
  return db.runTransaction(async (transaction) => {
    const all = (await routeClients(db, transaction, account, route)).map((entry) => entry.client);
    // Igual que la app: primera del día, antes de todas las fichas de ese día.
    const minOrder = all
      .filter((client) => client.freq !== 'on_demand' && !client.isCompleted
        && ((client.visitDays && client.visitDays.includes(day)) || client.visitDay === day))
      .reduce((min, client) => {
        const order = client.listOrders?.[day] ?? client.listOrder ?? 0;
        return Math.min(min, order > 100000 ? 0 : order);
      }, 0);
    const duplicate = all.find((client) => client.isNote && client.specificDate === date && (client.notes || '').trim() === notes);
    if (duplicate) {
      return { ...noteResult(duplicate, route), cambiado: false, antes: null, despues: { fecha: date, texto: notes }, aviso: 'Ya había una nota igual ese día: no se creó otra.' };
    }
    const ref = db.collection('clients').doc();
    transaction.create(ref, {
      ...dataScopeFields(account.uid, route.groupId),
      userId: account.uid,
      isNote: true,
      name: 'NOTA',
      phone: '',
      address: '',
      notes,
      freq: 'once',
      specificDate: date,
      visitDays: [day],
      visitDay: day,
      listOrder: minOrder - 1,
      listOrders: { [day]: minOrder - 1 },
      products: {},
      isCompleted: false,
      isStarred: false,
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return {
      cliente_id: ref.id, nombre: 'NOTA', reparto: route.name, cambiado: true, antes: null,
      despues: { fecha: date, dia: day, texto: notes },
    };
  });
};

const loadNote = async (db: Firestore, transaction: Transaction, account: Account, noteId: string) => {
  const loaded = await loadForWrite(db, transaction, account, noteId);
  if (!loaded.client.isNote) throw new WriteError(`${noteId} no es una nota de la agenda sino la ficha de ${loaded.client.name}: para su nota usá actualizar_nota.`);
  return loaded;
};

export const updateDayNote = (
  db: Firestore, account: Account, noteId: string, text: string,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const notes = text.trim();
  if (!notes) throw new WriteError('Falta el texto de la nota (para sacarla, borrar_nota_del_dia).');
  if (notes.length > 2000) throw new WriteError('La nota supera los 2000 caracteres.');
  const { ref, client, route } = await loadNote(db, transaction, account, noteId);
  const before = client.notes || '';
  const changed = before !== notes;
  if (changed) transaction.update(ref, { notes, updatedAt: new Date() });
  return { ...noteResult(client, route), cambiado: changed, antes: before, despues: notes };
});

export const deleteDayNote = (
  db: Firestore, account: Account, noteId: string,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const { ref, client, route } = await loadNote(db, transaction, account, noteId);
  // La alarma es una notificación del teléfono: borrarla sin la app la dejaría sonando.
  if (client.alarm) throw new WriteError('La nota tiene una alarma: borrala desde la app para que se cancele la alarma.');
  transaction.delete(ref);
  return {
    ...noteResult(client, route), cambiado: true,
    antes: { fecha: client.specificDate || nextVisit(client), texto: client.notes || '' }, despues: null,
  };
});
