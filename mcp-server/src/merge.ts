import fs from 'fs';
import path from 'path';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { Client, ClientAddress, ClientPhone } from '../../src/types';
import { withDefaults } from '../../src/utils/clientDefaults';
import { buildClientIdentityIndex, getRelatedRecordStableClientId, getStableClientId } from '../../src/utils/clientIdentity';
import { getClientAddresses, locationFields } from '../../src/utils/clientAddresses';
import { getClientPhones } from '../../src/utils/clientPhones';
import { belongsToProfileScope } from '../../src/utils/profileScope';
import { Account, routeForRecord } from './routes';
import { FREQ_LABELS } from './views';
import { ChangeResult, WriteError } from './writes';

// Fusionar dos fichas de la misma persona (Jonathan, 22/10/2026). La app no
// tiene esta acción: queda la ficha más completa (la de agenda si una la
// tiene), se le suman los datos que solo tenía la otra y la otra se borra.
// Deudas, transferencias, Parentesco y pedidos de una vez que apuntaban a la
// borrada pasan a la que queda. Antes de escribir se guarda una copia de
// todo lo que se toca, y deshacer_fusion lo vuelve a dejar como estaba.

const digits = (value: string): string => (value || '').replace(/\D/g, '').slice(-8);
const normal = (value: string): string => (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const millis = (value: any): number | null => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
};
const BILLING = ['rut', 'businessName', 'email'] as const;
// Palabras que no distinguen una dirección de otra («Restingas esq. Gaviotas» es la
// misma que «Restingas esq. Stella Maris y Gaviotas»).
const FILLER = new Set(['y', 'e', 'esq', 'esquina', 'av', 'avda', 'avenida', 'calle', 'c', 'de', 'del', 'la', 'las', 'los',
  'el', 'entre', 'm', 'mz', 'manz', 'manzana', 's', 'sol', 'solar', 'casa', 'n', 'nro', 'detalle']);
const words = (value: string): string[] => normal(value).split(' ').filter((word) => word && !FILLER.has(word));
/** La otra dirección no agrega nada: sus palabras ya están todas en esta, o es solo el nombre del cliente. */
const coveredBy = (place: string, existing: string, clientName: string): boolean => {
  const other = words(place);
  if (!other.length) return true;
  if (normal(place) === normal(clientName)) return true;
  const have = new Set(words(existing));
  return other.every((word) => have.has(word));
};
const DELIVERY = ['lastDeliveredAt', 'lastVisited'] as const;

const isScheduled = (client: Client): boolean => client.freq !== 'on_demand';

/** Cuántos datos tiene la ficha: teléfonos, dirección, mapa, nota, facturación, Parentesco… */
export const completeness = (client: Client): number => {
  const location = getClientAddresses(client);
  return getClientPhones(client).filter((phone) => digits(phone.number)).length
    + location.filter((place) => text(place.address)).length
    + location.filter((place) => text(place.mapsLink)).length
    + location.filter((place) => text(place.lat) && text(place.lng)).length
    + (text(client.notes) ? 1 : 0)
    + BILLING.filter((field) => text((client as any)[field])).length
    + Object.keys(client.relationships || {}).length
    + (Object.values(client.products || {}).some((amount: any) => Number(amount) > 0) ? 1 : 0)
    + (DELIVERY.some((field) => millis((client as any)[field])) ? 1 : 0);
};

/** Cuál queda: la que tiene visitas en la agenda; si no, la activa; si no, la que tiene más datos. */
const pickKept = (a: Client, b: Client): [Client, Client] => {
  const score = (client: Client) => (isScheduled(client) ? 1_000_000 : 0) + (client.isInactive ? 0 : 1000) + completeness(client);
  const [sa, sb] = [score(a), score(b)];
  if (sa !== sb) return sa > sb ? [a, b] : [b, a];
  // Empate: la ficha original del cliente (su id es el customerId de las demás).
  return getStableClientId(b) === b.id && getStableClientId(a) !== a.id ? [b, a] : [a, b];
};

interface Merged {
  updates: Record<string, any>;
  added: string[];
  pendingNote: string;
}

const mergeFields = (keep: Client, drop: Client, includeNote: boolean): Merged => {
  const updates: Record<string, any> = {};
  const added: string[] = [];

  // El nombre más completo («Romi» → «Romina Ferrari») entre dos de directorio, si el de la que queda es
  // el comienzo del otro. Una ficha de agenda conserva el suyo.
  if (text(drop.name) && (!text(keep.name) || (!isScheduled(keep)
    && normal(drop.name).length > normal(keep.name).length && normal(drop.name).startsWith(normal(keep.name))))) {
    updates.name = drop.name;
    added.push(`nombre «${drop.name}»`);
  }

  // Teléfonos: los de la que queda y, a continuación, los que solo tenía la otra.
  const phones: ClientPhone[] = getClientPhones(keep).map((phone) => ({ ...phone }));
  const known = new Set(phones.map((phone) => digits(phone.number)));
  for (const phone of getClientPhones(drop)) {
    const key = digits(phone.number);
    if (!key || known.has(key)) continue;
    known.add(key);
    phones.push({ id: `fusion-${phones.length + 1}`, number: phone.number, isPrimary: false });
    added.push(`teléfono ${phone.number}`);
  }
  if (phones.length && !phones.some((phone) => phone.isPrimary)) phones[0].isPrimary = true;
  if (phones.length !== getClientPhones(keep).length || (!text(keep.phone) && phones.length)) {
    updates.phones = phones;
    updates.phone = text(keep.phone) || phones.find((phone) => phone.isPrimary)?.number || '';
  }

  // Direcciones: se suman las que no estaban; a una igual le completa mapa y coordenadas.
  const keepPlaces = getClientAddresses(keep).filter((place) => text(place.address) || text(place.mapsLink));
  const places: ClientAddress[] = keepPlaces.map((place) => ({ ...place }));
  let placesChanged = false;
  const keyOf = (place: ClientAddress) => normal(place.address) || text(place.mapsLink);
  for (const place of getClientAddresses(drop).filter((candidate) => text(candidate.address) || text(candidate.mapsLink))) {
    const same = places.find((current) => keyOf(current) === keyOf(place)
      || (text(place.mapsLink) && text(current.mapsLink) === text(place.mapsLink))
      || coveredBy(place.address, current.address, keep.name || drop.name));
    if (same) {
      // Mismo lugar escrito con más detalle en la copia: queda el texto más completo.
      if (coveredBy(same.address, place.address, '') && words(place.address).length > words(same.address).length) {
        same.address = place.address;
        placesChanged = true;
        added.push(`dirección más completa «${place.address}»`);
      }
      if (!text(same.mapsLink) && text(place.mapsLink)) { same.mapsLink = place.mapsLink; placesChanged = true; added.push('link de Maps'); }
      if (!(text(same.lat) && text(same.lng)) && text(place.lat) && text(place.lng)) {
        same.lat = place.lat; same.lng = place.lng; placesChanged = true; added.push('coordenadas');
      }
      continue;
    }
    places.push({ ...place, id: `fusion-${places.length + 1}` });
    placesChanged = true;
    added.push(`dirección «${place.address || place.mapsLink}»`);
  }
  if (placesChanged) {
    updates.addresses = places;
    // La principal sigue siendo la primera; los campos sueltos la reflejan como en la app.
    Object.assign(updates, locationFields(places[0]));
  }

  // La nota de una copia de directorio suele ser de un pedido viejo («dejó la plata»…): a una
  // ficha de agenda no se le suma sola, queda en la vista previa para decidirla a mano.
  const keepNotes = text(keep.notes);
  const dropNotes = text(drop.notes);
  let pendingNote = '';
  if (dropNotes && !normal(keepNotes).includes(normal(dropNotes))) {
    if (isScheduled(keep) && !isScheduled(drop) && !includeNote) {
      pendingNote = dropNotes;
    } else {
      updates.notes = keepNotes ? `${keepNotes}\n${dropNotes}` : dropNotes;
      added.push('nota');
    }
  }

  for (const field of BILLING) {
    if (!text((keep as any)[field]) && text((drop as any)[field])) {
      updates[field] = (drop as any)[field];
      added.push(field === 'rut' ? 'RUT' : field === 'businessName' ? 'razón social' : 'email');
    }
  }

  // Parentesco: el de las dos, sin vínculos entre ellas mismas.
  const ownIds = new Set([keep.id, drop.id]);
  const relationships = { ...(keep.relationships || {}) };
  const household = { ...((keep as any).sameHousehold || {}) };
  let relationshipsChanged = false;
  Object.entries(drop.relationships || {}).forEach(([id, kind]) => {
    if (ownIds.has(id) || relationships[id]) return;
    relationships[id] = kind;
    relationshipsChanged = true;
    added.push('familiar en Parentesco');
  });
  Object.entries((drop as any).sameHousehold || {}).forEach(([id, value]) => {
    if (ownIds.has(id) || id in household) return;
    household[id] = value;
    relationshipsChanged = true;
  });
  for (const id of ownIds) {
    if (id in relationships) { delete relationships[id]; relationshipsChanged = true; }
    if (id in household) { delete household[id]; relationshipsChanged = true; }
  }
  if (relationshipsChanged) {
    updates.relationships = relationships;
    updates.sameHousehold = household;
  }

  // Productos solo si la que queda es de directorio y no tiene ninguno: la agenda manda.
  const keepHasProducts = Object.values(keep.products || {}).some((amount: any) => Number(amount) > 0);
  if (!isScheduled(keep) && !keepHasProducts && Object.values(drop.products || {}).some((amount: any) => Number(amount) > 0)) {
    updates.products = drop.products;
    added.push('productos');
  }

  // Última entrega: la más reciente de las dos (el filtro «Hace más que no compran» la usa).
  for (const field of DELIVERY) {
    const kept = millis((keep as any)[field]);
    const other = millis((drop as any)[field]);
    if (other && (!kept || other > kept)) {
      updates[field] = (drop as any)[field];
      if (field === 'lastDeliveredAt') added.push('última entrega');
    }
  }

  if (Object.keys(updates).length) updates.updatedAt = new Date();
  return { updates, added, pendingNote };
};

const summary = (client: Client) => ({
  id: client.id,
  nombre: client.name,
  direccion: client.address,
  telefonos: getClientPhones(client).map((phone) => phone.number),
  frecuencia: FREQ_LABELS[client.freq] || client.freq,
  dias: client.visitDays || [],
  nota: client.notes || '',
  datos: completeness(client),
});

// Copia de seguridad: Timestamps como { __ts: milisegundos } para poder volver a escribirlos.
const encode = (value: any): any => {
  if (value instanceof Timestamp) return { __ts: value.toMillis() };
  if (value instanceof Date) return { __ts: value.getTime() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
};
const decode = (value: any): any => {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.__ts === 'number') {
    return Timestamp.fromMillis(value.__ts);
  }
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  return value;
};

export interface MergeResult extends ChangeResult {
  copia?: string;
}

/** Lo que el servidor ya tiene cargado en vivo: así la fusión no relee colecciones enteras. */
export interface MergeCache { clients: Client[]; debts: Array<{ id: string }>; transfers: Array<{ id: string }> }

export const mergeClients = async (
  db: Firestore, account: Account, idA: string, idB: string, apply: boolean, backupDir: string, cache: MergeCache,
  includeNote = false,
): Promise<MergeResult> => {
  if (idA === idB) throw new WriteError('Son la misma ficha.');
  type Backup = { fecha: string; documentos: Record<string, DocumentData | null> };
  let backup = null as Backup | null;

  const result = await db.runTransaction(async (transaction) => {
    const refs = [idA, idB].map((id) => db.collection('clients').doc(id));
    const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
    snaps.forEach((snap, index) => { if (!snap.exists) throw new WriteError(`No existe el cliente ${[idA, idB][index]}.`); });
    const [a, b] = snaps.map((snap) => withDefaults(snap.id, snap.data()));
    const route = routeForRecord(account, a);
    if (!route || route !== routeForRecord(account, b)) throw new WriteError('Las dos fichas tienen que ser del mismo reparto de esta cuenta.');
    if (!route.writable) throw new WriteError(`El reparto «${route.name}» no admite cambios ahora (cuenta o grupo inactivo).`);
    for (const client of [a, b]) {
      if (client.isNote) throw new WriteError('Las notas no se fusionan.');
      if (Array.isArray(client.visitCommands) && client.visitCommands.length) {
        throw new WriteError(`«${client.name}» tiene un Listo pendiente de aplicar desde la app; reintentar en unos segundos.`);
      }
    }
    if (isScheduled(a) && isScheduled(b)) {
      throw new WriteError('Las dos fichas tienen visitas (agenda o pedido de una vez): no se fusionan, se perdería una. Solo se fusiona una ficha con una copia de directorio, o dos de directorio.');
    }
    const [keep, drop] = pickKept(a, b);
    const keepStable = getStableClientId(keep);
    const dropStable = getStableClientId(drop);
    const { updates, added, pendingNote } = mergeFields(keep, drop, includeNote);

    // Lo que apuntaba a la ficha que se borra (deudas, transferencias, Parentesco y otras fichas del
    // cliente): se busca en la copia en vivo y cada documento se vuelve a leer acá antes de tocarlo.
    const identity = buildClientIdentityIndex(cache.clients);
    const pointsToDrop = (data: DocumentData) => data.clientId === drop.id
      || (dropStable !== keepStable && getRelatedRecordStableClientId(data as any, identity) === dropStable);
    const records: Array<{ ref: DocumentReference; data: DocumentData; kind: string }> = [];
    for (const [collection, items, kind] of [['debts', cache.debts, 'deuda'], ['transfers', cache.transfers, 'transferencia']] as const) {
      for (const item of items) {
        if (!pointsToDrop(item as any)) continue;
        const snap = await transaction.get(db.collection(collection).doc(item.id));
        const data = snap.data();
        if (data && belongsToProfileScope(data, account.uid, route.groupId) && pointsToDrop(data)) records.push({ ref: snap.ref, data, kind });
      }
    }
    const fresh = async (client: Client): Promise<Client | null> => {
      const snap = await transaction.get(db.collection('clients').doc(client.id));
      return snap.exists ? withDefaults(snap.id, snap.data()) : null;
    };
    const relatives: Client[] = [];
    const siblings: Client[] = [];
    for (const candidate of cache.clients) {
      if (candidate.id === keep.id || candidate.id === drop.id) continue;
      const linked = drop.id in (candidate.relationships || {}) || drop.id in ((candidate as any).sameHousehold || {});
      const sibling = dropStable !== keepStable && getStableClientId(candidate) === dropStable;
      if (!linked && !sibling) continue;
      const current = await fresh(candidate);
      if (!current) continue;
      if (drop.id in (current.relationships || {}) || drop.id in ((current as any).sameHousehold || {})) relatives.push(current);
      if (dropStable !== keepStable && getStableClientId(current) === dropStable) siblings.push(current);
    }

    const base = { cliente_id: keep.id, nombre: keep.name, reparto: route.name };
    const plan = {
      queda: summary(keep),
      se_borra: summary(drop),
      se_suma: added.length ? added : ['nada: la que queda ya tiene todos los datos'],
      deudas_movidas: records.filter((record) => record.kind === 'deuda').length,
      transferencias_movidas: records.filter((record) => record.kind === 'transferencia').length,
      familiares_actualizados: relatives.map((client) => client.name),
      otras_fichas_del_cliente: siblings.map((client) => client.name),
      ...(pendingNote ? { nota_de_la_copia_sin_sumar: pendingNote } : {}),
    };
    if (!apply) {
      return {
        ...base, cambiado: false, antes: plan.se_borra, despues: plan.queda, plan,
        aviso: 'Vista previa: no se escribió nada. Para fusionar, volver a llamar con aplicar: true.',
      };
    }

    const touched = [
      ...snaps.map((snap) => ({ path: snap.ref.path, data: snap.data() || null })),
      ...records.map((record) => ({ path: record.ref.path, data: record.data })),
      ...[...relatives, ...siblings].map((client) => ({ path: `clients/${client.id}`, data: null as DocumentData | null })),
    ];
    // Familiares y otras fichas: leerlas crudas para la copia de seguridad.
    for (const entry of touched) {
      if (entry.data === null) entry.data = (await transaction.get(db.doc(entry.path))).data() || null;
    }

    if (Object.keys(updates).length) transaction.update(db.doc(`clients/${keep.id}`), updates);
    transaction.delete(db.doc(`clients/${drop.id}`));
    for (const record of records) {
      transaction.update(record.ref, { clientId: keep.id, customerId: keepStable });
    }
    for (const relative of relatives) {
      const update: Record<string, any> = {
        [`relationships.${drop.id}`]: FieldValue.delete(),
        [`sameHousehold.${drop.id}`]: FieldValue.delete(),
        updatedAt: new Date(),
      };
      const kind = relative.relationships?.[drop.id];
      if (kind && !relative.relationships?.[keep.id]) update[`relationships.${keep.id}`] = kind;
      const household = (relative as any).sameHousehold?.[drop.id];
      if (household !== undefined && (relative as any).sameHousehold?.[keep.id] === undefined) update[`sameHousehold.${keep.id}`] = household;
      transaction.update(db.doc(`clients/${relative.id}`), update);
    }
    for (const sibling of siblings) {
      transaction.update(db.doc(`clients/${sibling.id}`), { customerId: keepStable, updatedAt: new Date() });
    }
    backup = { fecha: new Date().toISOString(), documentos: Object.fromEntries(touched.map((entry) => [entry.path, entry.data])) };
    return { ...base, cambiado: true, antes: plan.se_borra, despues: { ...plan.queda, ...updates.notes !== undefined ? { nota: updates.notes } : {} }, plan };
  });

  if (backup) {
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${result.cliente_id}.json`);
    fs.writeFileSync(file, JSON.stringify(encode(backup), null, 1));
    return { ...result, copia: file };
  }
  return result;
};

/** Vuelve a dejar todo como estaba antes de una fusión (la ficha borrada incluida). */
export const undoMerge = async (db: Firestore, account: Account, file: string): Promise<ChangeResult> => {
  if (!fs.existsSync(file)) throw new WriteError(`No existe la copia ${file}.`);
  const backup = decode(JSON.parse(fs.readFileSync(file, 'utf8'))) as { documentos: Record<string, DocumentData | null> };
  const entries = Object.entries(backup.documentos);
  for (const [, data] of entries) {
    if (data && !routeForRecord(account, data as any)) throw new WriteError('La copia tiene fichas que no son de esta cuenta.');
  }
  await db.runTransaction(async (transaction) => {
    entries.forEach(([docPath, data]) => {
      if (data) transaction.set(db.doc(docPath), data);
    });
  });
  const clients = entries.filter(([docPath, data]) => docPath.startsWith('clients/') && data).map(([docPath, data]) => withDefaults(docPath.split('/')[1], data));
  return {
    cliente_id: clients[0]?.id || '', nombre: clients.map((client) => client.name).join(' + '), reparto: '',
    cambiado: true, antes: null, despues: { restauradas: entries.map(([docPath]) => docPath) },
  };
};
