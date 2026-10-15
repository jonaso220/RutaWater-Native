import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import type { Client } from '../../src/types';
import { withDefaults } from '../../src/utils/clientDefaults';
import {
  applyVisitCommand, createVisitCommand, undoForCompletedClient, VisitCommand, VisitResult,
} from '../../src/utils/visitCompletion';
import { Account, Route, routeForRecord } from './routes';
import {
  CatalogProduct, clientDays, isValidIsoDate, nextVisit, quantity, todayKey,
} from './views';

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

/**
 * Igual que «Guardar productos» (ClientProductsModal): guarda el mapa completo
 * con cantidades > 0. `changes` modifica solo esos productos (0 lo quita);
 * con `replaceAll` el resultado es exactamente `changes`.
 */
export const setProducts = (
  db: Firestore, account: Account, catalog: CatalogProduct[],
  clientId: string, changes: Record<string, number>, replaceAll: boolean,
): Promise<ChangeResult> => db.runTransaction(async (transaction) => {
  const unknown = Object.keys(changes).filter((id) => !catalog.some((product) => product.id === id));
  if (unknown.length) {
    throw new WriteError(`Productos desconocidos: ${unknown.join(', ')}. Usá ver_productos para los ids.`);
  }
  Object.entries(changes).forEach(([id, amount]) => {
    if (!Number.isInteger(amount) || amount < 0 || amount > 9999) {
      throw new WriteError(`Cantidad inválida para ${id}: ${amount}.`);
    }
  });
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
  transaction: Transaction, loaded: Loaded, command: VisitCommand,
): Promise<{ client: Client | null; outcome: VisitResult['outcome'] }> => {
  let client: Client | null = loaded.client;
  const pending = Array.isArray(client.visitCommands) ? client.visitCommands : [];
  const updates: Partial<Client> = {};
  const results: VisitResult[] = [...(client.visitResults || [])];
  let outcome: VisitResult['outcome'] = 'stale';
  for (const current of [...pending, command]) {
    if (!client) break;
    const result = applyVisitCommand(client, current);
    Object.assign(updates, result.updates);
    if (current?.id && current?.actorId) results.push({ id: current.id, actorId: current.actorId, outcome: result.outcome });
    if (current === command) outcome = result.outcome;
    client = result.client;
  }
  if (!client) {
    transaction.delete(loaded.ref);
  } else {
    transaction.update(loaded.ref, {
      ...updates, visitCommands: [], visitResults: results.slice(-20), updatedAt: new Date(),
    });
  }
  return { client, outcome };
};

const projectPending = (client: Client): Client | null => {
  let projected: Client | null = client;
  for (const command of Array.isArray(client.visitCommands) ? client.visitCommands : []) {
    if (!projected) break;
    projected = applyVisitCommand(projected, command).client;
  }
  return projected;
};

/** «Listo» sobre la visita de `date` (yyyy-mm-dd). Rechaza si esa no es la visita pendiente. */
export const markDone = (
  db: Firestore, account: Account, clientId: string, date: string,
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
    .map((day) => createVisitCommand(current, account.uid, day))
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
  const { client, outcome } = await applyCommand(transaction, loaded, command);
  if (outcome !== 'applied') throw new WriteError(`La app no aplicó el Listo (resultado: ${outcome}).`);
  return {
    cliente_id: loaded.client.id, nombre: loaded.client.name, reparto: loaded.route.name, cambiado: true,
    antes: { visita: command.occurrence }, despues: { proxima_visita: client ? nextVisit(client) : null, ficha_eliminada: !client },
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
  const { client, outcome } = await applyCommand(transaction, loaded, command);
  if (outcome !== 'undone') throw new WriteError(`No se pudo deshacer (resultado: ${outcome}).`);
  return {
    cliente_id: loaded.client.id, nombre: loaded.client.name, reparto: loaded.route.name, cambiado: true,
    antes: { proxima_visita: before }, despues: { proxima_visita: client ? nextVisit(client) : null },
  };
});
