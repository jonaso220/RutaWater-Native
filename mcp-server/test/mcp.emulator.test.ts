process.env.TZ = 'America/Montevideo';
process.env.FIREBASE_PROJECT_ID = 'demo-rutawater';

import type { Firestore } from 'firebase-admin/firestore';
import { getDb } from '../src/config';
import { loadAccount } from '../src/routes';
import { Store } from '../src/store';
import {
  addDays, agendaFor, debtReport, nextVisit, productCatalog, searchClients, todayKey, weekdayOf,
} from '../src/views';
import { markDone, setNote, setProducts, setStar, undoDone } from '../src/writes';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;

const UID = 'owner';
const FAMILY = 'family';
const PROFILE = 'route2';

describeWithEmulator('RutaWater MCP contra el emulador', () => {
  let db: Firestore;
  let store: Store;
  const tomorrow = addDays(todayKey(), 1);
  const tomorrowDay = weekdayOf(tomorrow);

  const client = (data: Record<string, unknown>) => ({
    userId: UID, groupId: FAMILY, scopeKey: `scope:${FAMILY}`, name: '', phone: '', address: '',
    notes: '', freq: 'weekly', visitDay: tomorrowDay, visitDays: [tomorrowDay], specificDate: '',
    products: {}, isStarred: false, isCompleted: false, isNote: false, lastVisited: null, ...data,
  });

  beforeAll(() => { db = getDb(); });

  beforeEach(async () => {
    await fetch(`http://${emulator}/emulator/v1/projects/demo-rutawater/databases/(default)/documents`, { method: 'DELETE' });
    const batch = db.batch();
    batch.set(db.doc(`users/${UID}`), { groupId: FAMILY, primaryProfileName: 'Reparto 1', accountState: 'active' });
    batch.set(db.doc(`groups/${FAMILY}`), { adminId: UID, lifecycleState: 'active' });
    batch.set(db.doc(`profiles/${PROFILE}`), { name: 'Costa', ownerId: UID, memberUids: [UID] });
    batch.set(db.doc('profiles/ajeno'), { name: 'Ajeno', ownerId: 'otro', memberUids: ['otro'] });
    batch.set(db.doc(`settings/${FAMILY}`), {
      productNames: { b20: 'Bidón grande' },
      customProducts: [{ id: 'guarana', label: 'Guaraná 2L' }],
      whatsappTomorrowVisit: 'Mañana pasamos 🚚',
    });
    batch.set(db.doc('clients/rosa'), client({
      name: 'Rosa Jerez', phone: '099 123 456', address: 'Calle 26 y 28', products: { b20: 2 }, notes: 'Deja el dinero',
      listOrders: { [tomorrowDay]: 2 },
    }));
    batch.set(db.doc('clients/mario'), client({ name: 'Mario', address: 'Rambla', listOrders: { [tomorrowDay]: 1 } }));
    batch.set(db.doc('clients/unavez'), client({ name: 'Ana Una Vez', freq: 'once', specificDate: tomorrow, visitDays: [] }));
    batch.set(db.doc('clients/directorio'), client({ name: 'Rosa Directorio', freq: 'on_demand' }));
    batch.set(db.doc('clients/personal'), client({ name: 'Rosa Personal', groupId: null, scopeKey: `user:${UID}` }));
    batch.set(db.doc('clients/costa'), client({ name: 'Rosa Costa', groupId: PROFILE, scopeKey: `scope:${PROFILE}` }));
    batch.set(db.doc('clients/ajena'), client({ name: 'Rosa Ajena', userId: 'otro', groupId: 'ajeno', scopeKey: 'scope:ajeno' }));
    batch.set(db.doc('debts/d1'), { userId: UID, groupId: FAMILY, clientId: 'rosa', customerId: 'rosa', clientName: 'Rosa Jerez', amount: 300, createdAt: new Date('2026-09-01T12:00:00') });
    batch.set(db.doc('debts/d2'), { userId: UID, groupId: FAMILY, clientId: 'rosa', clientName: 'Rosa Jerez', amount: 150, createdAt: new Date('2026-10-01T12:00:00') });
    await batch.commit();
    store = new Store(db, UID);
  });

  afterEach(() => store.close());

  test('solo ve los repartos propios y sus fichas', async () => {
    const account = await loadAccount(db, UID);
    expect(account.routes.map((route) => [route.id, route.name])).toEqual([['principal', 'Reparto 1'], [PROFILE, 'Costa']]);
    const primary = await store.getClients(account.routes[0]);
    expect(primary.map((c) => c.id).sort()).toEqual(['directorio', 'mario', 'rosa', 'unavez']);
    const found = searchClients(primary, 'rosa', false).map((c) => c.id);
    expect(found).toEqual(['directorio', 'rosa']);
    expect(searchClients(primary, '099123456', false).map((c) => c.id)).toEqual(['rosa']);
  });

  test('agenda de mañana en el orden del reparto, sin directorio', async () => {
    const account = await store.getAccount();
    const agenda = agendaFor(await store.getClients(account.routes[0]), tomorrow).map((entry) => entry.client.id);
    expect(agenda).toEqual(['mario', 'rosa', 'unavez']);
  });

  test('deudas agrupadas por cliente', async () => {
    const account = await store.getAccount();
    const route = account.routes[0];
    const report = debtReport(await store.getClients(route), await store.getDebts(route), route.name, 0);
    expect(report).toEqual([{ cliente_id: 'rosa', nombre: 'Rosa Jerez', reparto: 'Reparto 1', total: 450, cantidad: 2, desde: '2026-09-01' }]);
  });

  test('productos: cambia solo lo indicado, 0 quita, rechaza ids desconocidos', async () => {
    const account = await store.getAccount();
    const catalog = productCatalog(await store.getSettings());
    expect(catalog.find((p) => p.id === 'b20')?.nombre).toBe('Bidón grande');

    const first = await setProducts(db, account, catalog, 'rosa', { b12: 3, guarana: 1 }, false);
    expect(first.despues).toEqual({ b20: 2, b12: 3, guarana: 1 });
    const second = await setProducts(db, account, catalog, 'rosa', { b20: 0 }, false);
    expect(second.despues).toEqual({ b12: 3, guarana: 1 });
    const same = await setProducts(db, account, catalog, 'rosa', { b12: 3 }, false);
    expect(same.cambiado).toBe(false);
    const replaced = await setProducts(db, account, catalog, 'rosa', { b20: 8 }, true);
    expect((await db.doc('clients/rosa').get()).data()?.products).toEqual({ b20: 8 });
    expect(replaced.cambiado).toBe(true);
    await expect(setProducts(db, account, catalog, 'rosa', { inventado: 1 }, false)).rejects.toThrow('desconocidos');
  });

  test('nota con control de cambios concurrentes', async () => {
    const account = await store.getAccount();
    await expect(setNote(db, account, 'rosa', 'Nueva', 'otra cosa')).rejects.toThrow('cambió');
    const result = await setNote(db, account, 'rosa', 'Pueden ser 7 u 8', 'Deja el dinero');
    expect(result.despues).toBe('Pueden ser 7 u 8');
    expect((await db.doc('clients/rosa').get()).data()?.notes).toBe('Pueden ser 7 u 8');
  });

  test('favorito se fija, no se alterna', async () => {
    const account = await store.getAccount();
    expect((await setStar(db, account, 'rosa', true)).cambiado).toBe(true);
    expect((await setStar(db, account, 'rosa', true)).cambiado).toBe(false);
    expect((await db.doc('clients/rosa').get()).data()?.isStarred).toBe(true);
  });

  test('no escribe fichas de otra cuenta', async () => {
    const account = await store.getAccount();
    await expect(setStar(db, account, 'ajena', true)).rejects.toThrow('no pertenece');
    await expect(setStar(db, account, 'personal', true)).rejects.toThrow('no pertenece');
    expect((await db.doc('clients/ajena').get()).data()?.isStarred).toBe(false);
  });

  test('Listo con la lógica de la app, y deshacer', async () => {
    const account = await store.getAccount();
    await setStar(db, account, 'rosa', true);
    await expect(markDone(db, account, 'rosa', addDays(tomorrow, 1))).rejects.toThrow(tomorrow);

    const done = await markDone(db, account, 'rosa', tomorrow);
    expect(done.despues).toEqual({ proxima_visita: addDays(tomorrow, 7), ficha_eliminada: false });
    const after = (await db.doc('clients/rosa').get()).data()!;
    expect(after.doneFor).toBe(tomorrow);
    expect(after.isStarred).toBe(false); // igual que el botón Listo
    expect(Object.values(after.visitReceipt.confirmations)).toEqual([UID]);

    const undone = await undoDone(db, account, 'rosa');
    expect(undone.despues).toEqual({ proxima_visita: tomorrow });
    const restored = (await db.doc('clients/rosa').get()).data()!;
    expect(restored.isStarred).toBe(true);
    expect(nextVisit({ ...restored, id: 'rosa' } as any)).toBe(tomorrow);
  });

  test('visita atrasada: figura en hoy y Listo acepta la fecha de hoy', async () => {
    const yesterday = addDays(todayKey(), -1);
    await db.doc('clients/atrasado').set(client({
      name: 'Atrasado', visitDay: weekdayOf(yesterday), visitDays: [weekdayOf(yesterday)],
      lastVisited: new Date(`${addDays(yesterday, -7)}T10:00:00`),
    }));
    const account = await store.refreshAccount();
    const today = agendaFor(await store.getClients(account.routes[0]), todayKey());
    expect(today.find((entry) => entry.client.id === 'atrasado')).toEqual(expect.objectContaining({ occurrence: yesterday, overdue: true }));
    const done = await markDone(db, account, 'atrasado', todayKey());
    expect(done.antes).toEqual({ visita: yesterday });
    expect((await db.doc('clients/atrasado').get()).data()?.doneFor).toBe(yesterday);
  });

  test('Listo de un pedido de una vez lo completa', async () => {
    const account = await store.getAccount();
    await markDone(db, account, 'unavez', tomorrow);
    expect((await db.doc('clients/unavez').get()).data()?.isCompleted).toBe(true);
    await expect(markDone(db, account, 'unavez', tomorrow)).rejects.toThrow('ya está marcado');
  });
});
