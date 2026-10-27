process.env.TZ = 'America/Montevideo';
process.env.FIREBASE_PROJECT_ID = 'demo-rutawater';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { getDb } from '../src/config';
import { ReadBudget, ReadLimitError, setReadBudget } from '../src/readBudget';
import { loadAccount } from '../src/routes';
import { mergeClients, undoMerge } from '../src/merge';
import { Store } from '../src/store';
import {
  addDays, agendaFor, debtReport, debtTotalMessage, hasPendingTransfer, nextVisit, productCatalog, searchClients,
  suggestPosition, todayKey, weekdayOf,
} from '../src/views';
import {
  advanceVisit, changeFrequency, changePosition, createClient, markDone, markTransferForReview, registerPayment, removeFromList, rescheduleClient, scheduleOnce, setNote, setProducts, setStar,
  undoDone,
} from '../src/writes';

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
    expect(done.despues).toEqual({ proxima_visita: addDays(tomorrow, 7), ficha_eliminada: false, entrega: true });
    const after = (await db.doc('clients/rosa').get()).data()!;
    expect(after.doneFor).toBe(tomorrow);
    expect(after.isStarred).toBe(false); // igual que el botón Listo
    expect(Object.values(after.visitReceipt.confirmations)).toEqual([UID]);

    const record = (await db.doc(`deliveries/rosa_${tomorrow}`).get()).data()!;
    expect(record).toMatchObject({ clientId: 'rosa', occurrence: tomorrow, delivered: true, source: 'assistant', undone: false });

    const undone = await undoDone(db, account, 'rosa');
    expect(undone.despues).toEqual({ proxima_visita: tomorrow });
    const restored = (await db.doc('clients/rosa').get()).data()!;
    expect(restored.isStarred).toBe(true);
    expect(nextVisit({ ...restored, id: 'rosa' } as any)).toBe(tomorrow);
    expect((await db.doc(`deliveries/rosa_${tomorrow}`).get()).data()?.undone).toBe(true);

    // «No necesita»: la visita se completa igual, sin entrega.
    const skipped = await markDone(db, account, 'rosa', tomorrow, true);
    expect(skipped.despues).toMatchObject({ entrega: false });
    expect((await db.doc(`deliveries/rosa_${tomorrow}`).get()).data()).toMatchObject({ delivered: false, undone: false });
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

  test('adelantar una visita quincenal a la semana más cercana, mismo día', async () => {
    await db.doc('clients/quincenal').set(client({
      name: 'Quincenal', freq: 'biweekly', lastVisited: new Date(`${addDays(tomorrow, -7)}T10:00:00`),
      lastDeliveredAt: new Date(`${addDays(tomorrow, -7)}T10:00:00`), products: { b20: 1 },
    }));
    const account = await store.refreshAccount();
    const before = (await db.doc('clients/quincenal').get()).data()!;
    expect(nextVisit({ ...before, id: 'quincenal' } as any)).toBe(addDays(tomorrow, 7));

    await expect(advanceVisit(db, account, 'quincenal', addDays(tomorrow, 1))).rejects.toThrow('manteniendo el día');
    await expect(advanceVisit(db, account, 'quincenal', addDays(tomorrow, 7))).rejects.toThrow('no la adelanta');
    await expect(advanceVisit(db, account, 'unavez', tomorrow)).rejects.toThrow('Solo se adelantan');

    const moved = await advanceVisit(db, account, 'quincenal', tomorrow);
    expect(moved.despues).toEqual({ proxima_visita: tomorrow });
    const after = (await db.doc('clients/quincenal').get()).data()!;
    expect(after.specificDate).toBe(tomorrow);
    expect(after.lastVisited).toBeNull();
    expect(after.lastDeliveredAt.toDate().toISOString()).toBe(before.lastDeliveredAt.toDate().toISOString());
    expect(after.visitDay).toBe(tomorrowDay);

    // El ciclo sigue cada 15 días desde la fecha adelantada.
    const done = await markDone(db, account, 'quincenal', tomorrow);
    expect(done.despues).toEqual({ proxima_visita: addDays(tomorrow, 14), ficha_eliminada: false, entrega: true });
  });

  test('cambiar frecuencia: semanal a quincenal y mensual a semanal, manteniendo el día', async () => {
    const delivered = new Date(`${addDays(tomorrow, -7)}T10:00:00`);
    await db.doc('clients/mensual').set(client({
      name: 'Mensual', freq: 'monthly', lastVisited: delivered, lastDeliveredAt: delivered,
    }));
    const account = await store.refreshAccount();

    const toBiweekly = await changeFrequency(db, account, 'rosa', 'quincenal');
    expect(toBiweekly.antes).toEqual({ frecuencia: 'semanal', proxima_visita: tomorrow });
    expect(toBiweekly.despues).toEqual({ frecuencia: 'quincenal', proxima_visita: tomorrow });
    expect((await db.doc('clients/rosa').get()).data()?.freq).toBe('biweekly');
    expect((await changeFrequency(db, account, 'rosa', 'quincenal')).cambiado).toBe(false);

    const monthlyBefore = (await db.doc('clients/mensual').get()).data()!;
    expect(nextVisit({ ...monthlyBefore, id: 'mensual' } as any)).toBe(addDays(tomorrow, 21));
    const toWeekly = await changeFrequency(db, account, 'mensual', 'semanal');
    expect(toWeekly.despues).toEqual({ frecuencia: 'semanal', proxima_visita: tomorrow });
    const after = (await db.doc('clients/mensual').get()).data()!;
    expect(after.lastVisited).toBeNull();
    expect(after.lastDeliveredAt.toDate().toISOString()).toBe(delivered.toISOString());
    expect(after.visitDay).toBe(tomorrowDay);

    const started = await changeFrequency(db, account, 'mario', 'quincenal', addDays(tomorrow, 7));
    expect(started.despues).toEqual({ frecuencia: 'quincenal', proxima_visita: addDays(tomorrow, 7) });

    await expect(changeFrequency(db, account, 'mario', 'cada 2 meses')).rejects.toThrow('desconocida');
    await expect(changeFrequency(db, account, 'mario', 'semanal', addDays(tomorrow, 1))).rejects.toThrow('mantener el día');
    await expect(changeFrequency(db, account, 'unavez', 'semanal')).rejects.toThrow('agenda periódica');
  });

  test('cambiar fecha: posterga, cambia de día con la frecuencia y mueve un pedido de una vez', async () => {
    const dayAfter = addDays(tomorrow, 1);
    const otherDay = weekdayOf(dayAfter);
    await db.doc('clients/otrodia').set(client({ name: 'Otro Día', visitDay: otherDay, visitDays: [otherDay], listOrders: { [otherDay]: 5 } }));
    await db.doc('clients/dosdias').set(client({ name: 'Dos Días', visitDays: [tomorrowDay, weekdayOf(addDays(tomorrow, 2))] }));
    await db.doc('clients/nota').set(client({ name: 'Nota', isNote: true, freq: 'once', specificDate: tomorrow }));
    const account = await store.refreshAccount();
    const clients = await store.getClients(account.routes[0]);

    const later = await rescheduleClient(db, account, clients, 'rosa', addDays(tomorrow, 7));
    expect(later.antes).toEqual({ frecuencia: 'semanal', dias: [tomorrowDay], proxima_visita: tomorrow });
    expect(later.despues).toMatchObject({ frecuencia: 'semanal', dias: [tomorrowDay], proxima_visita: addDays(tomorrow, 7) });
    expect((await rescheduleClient(db, account, clients, 'rosa', addDays(tomorrow, 7))).cambiado).toBe(false);

    const moved = await rescheduleClient(db, account, clients, 'rosa', dayAfter, 'quincenal');
    expect(moved.despues).toMatchObject({ frecuencia: 'quincenal', dias: [otherDay], proxima_visita: dayAfter });
    const rosa = (await db.doc('clients/rosa').get()).data()!;
    expect(rosa).toMatchObject({ freq: 'biweekly', visitDay: otherDay, visitDays: [otherDay], specificDate: dayAfter, lastVisited: null });
    expect(rosa.listOrders).toEqual({ [otherDay]: 2 });

    const once = await rescheduleClient(db, account, clients, 'unavez', dayAfter);
    expect(once.despues).toMatchObject({ frecuencia: 'una vez', dias: [otherDay], proxima_visita: dayAfter, posicion: 1 });
    const unavez = (await db.doc('clients/unavez').get()).data()!;
    expect(unavez).toMatchObject({ freq: 'once', specificDate: dayAfter, visitDay: otherDay });
    expect(unavez.listOrders[otherDay]).toBe(4);

    await expect(rescheduleClient(db, account, clients, 'directorio', tomorrow)).rejects.toThrow('agendar_una_vez');
    await expect(rescheduleClient(db, account, clients, 'mario', addDays(todayKey(), -1))).rejects.toThrow('ya pasó');
    await expect(rescheduleClient(db, account, clients, 'mario', tomorrow, 'cada 2 meses')).rejects.toThrow('desconocida');
    await expect(rescheduleClient(db, account, clients, 'dosdias', dayAfter)).rejects.toThrow('varios días');
    await expect(rescheduleClient(db, account, clients, 'nota', dayAfter)).rejects.toThrow('notas');
  });

  test('cambiar fecha con ubicar: queda entre las dos paradas donde menos se desvía', async () => {
    const dayAfter = addDays(tomorrow, 1);
    const otherDay = weekdayOf(dayAfter);
    const stop = (id: string, order: number, lng: number) => db.doc(`clients/${id}`).set(client({
      name: id, visitDay: otherDay, visitDays: [otherDay], listOrders: { [otherDay]: order }, lat: '-34.8', lng: String(lng),
    }));
    await stop('a', 1, -56.00);
    await stop('b', 2, -55.98);
    await stop('c', 3, -55.96);
    await db.doc('clients/rosa').update({ lat: '-34.8', lng: '-55.97' });
    const account = await store.refreshAccount();
    const clients = await store.getClients(account.routes[0]);
    const placed = await rescheduleClient(db, account, clients, 'rosa', dayAfter, undefined, true);
    expect(placed.despues).toMatchObject({ dias: [otherDay], proxima_visita: dayAfter, posicion: 3 });
    expect((placed as any).ubicacion).toMatchObject({ aplicada: true, anterior: { id: 'b' }, siguiente: { id: 'c' } });
  });

  test('quitar de la lista: un día de varios, al directorio, y borra el pedido repetido', async () => {
    const secondDay = weekdayOf(addDays(tomorrow, 2));
    await db.doc('clients/dosdias').set(client({ name: 'Dos Días', visitDays: [tomorrowDay, secondDay] }));
    await db.doc('clients/extra').set(client({ name: 'Rosa Jerez', customerId: 'rosa', freq: 'once', specificDate: tomorrow }));
    await db.doc('clients/extra2').set(client({ name: 'Mario', customerId: 'mario', freq: 'once', specificDate: tomorrow }));
    await db.doc('debts/d3').set({ userId: UID, groupId: FAMILY, clientId: 'extra2', clientName: 'Mario', amount: 80, createdAt: new Date() });
    await db.doc('clients/mario').update({ lastVisited: new Date(`${addDays(tomorrow, -7)}T10:00:00`) });
    const account = await store.refreshAccount();
    const route = account.routes[0];
    const clients = await store.getClients(route);
    const related = async () => [...await store.getDebts(route), ...await store.getTransfers(route)];

    const oneDay = await removeFromList(db, account, clients, 'dosdias', tomorrow, related);
    expect(oneDay.despues).toMatchObject({ dias: [secondDay] });
    expect((await db.doc('clients/dosdias').get()).data()).toMatchObject({ visitDay: secondDay, visitDays: [secondDay] });

    const extra = await removeFromList(db, account, clients, 'extra', tomorrow, related);
    expect(extra.despues).toMatchObject({ ficha_eliminada: true, queda: { ficha_id: 'rosa' } });
    expect((await db.doc('clients/extra').get()).exists).toBe(false);
    await expect(removeFromList(db, account, clients, 'extra2', tomorrow, related)).rejects.toThrow('deudas');

    const toDirectory = await removeFromList(db, account, clients, 'mario', tomorrow, related);
    expect(toDirectory.despues).toEqual({ frecuencia: 'sin agenda (directorio)', dias: [], proxima_visita: null });
    const mario = (await db.doc('clients/mario').get()).data()!;
    expect(mario).toMatchObject({ freq: 'on_demand', visitDay: 'Sin Asignar', visitDays: [], specificDate: '', listOrders: {}, lastVisited: null });
    expect(mario.lastDeliveredAt.toDate().toISOString()).toBe(new Date(`${addDays(tomorrow, -7)}T10:00:00`).toISOString());

    expect((await removeFromList(db, account, clients, 'directorio', tomorrow, related)).cambiado).toBe(false);
    await expect(removeFromList(db, account, clients, 'rosa', addDays(tomorrow, 1), related)).rejects.toThrow('no está en la lista');
  });

  test('registrar pago: salda las deudas más viejas primero, deja el saldo y no paga dos veces', async () => {
    const account = await store.getAccount();
    const clients = await store.getClients(account.routes[0]);
    await expect(registerPayment(db, account, 'rosa', 100, 400, clients)).rejects.toThrow('cambió');

    const partial = await registerPayment(db, account, 'rosa', 350, 450, clients);
    expect(partial.antes).toEqual({
      deuda_total: 450, deudas: [{ monto: 300, fecha: '2026-09-01' }, { monto: 150, fecha: '2026-10-01' }],
    });
    expect(partial.despues).toEqual({ deuda_total: 100, deudas: [{ monto: 100, fecha: '2026-10-01' }] });
    expect(partial.aplicado_a_deuda).toBe(350);
    expect(partial.sobrante).toBe(0);
    expect((await db.doc('debts/d1').get()).exists).toBe(false);
    expect((await db.doc('debts/d2').get()).data()?.amount).toBe(100);

    // Un reintento con la deuda leída antes no vuelve a descontar.
    await expect(registerPayment(db, account, 'rosa', 350, 450, clients)).rejects.toThrow('cambió');

    const over = await registerPayment(db, account, 'rosa', 300, 100, clients);
    expect(over.despues).toEqual({ deuda_total: 0, deudas: [] });
    expect(over.aplicado_a_deuda).toBe(100);
    expect(over.sobrante).toBe(200);
    expect((await db.collection('debts').get()).size).toBe(0);

    await expect(registerPayment(db, account, 'rosa', 50, 0, clients)).rejects.toThrow('no tiene deudas');
    await expect(registerPayment(db, account, 'ajena', 50, 0, clients)).rejects.toThrow('no pertenece');
    await expect(registerPayment(db, account, 'mario', -5, 0, clients)).rejects.toThrow('Monto inválido');
  });

  test('transferencia para revisar: mismo registro que la app y sin duplicar', async () => {
    const account = await store.getAccount();
    const route = account.routes[0];
    const clients = await store.getClients(route);

    const first = await markTransferForReview(db, account, 'rosa', clients);
    expect(first.cambiado).toBe(true);
    const docs = (await db.collection('transfers').get()).docs.map((doc) => doc.data());
    expect(docs).toEqual([expect.objectContaining({
      userId: UID, groupId: FAMILY, scopeKey: `scope:${FAMILY}`, clientId: 'rosa', customerId: 'rosa',
      clientName: 'Rosa Jerez', clientAddress: 'Calle 26 y 28',
    })]);
    expect((await markTransferForReview(db, account, 'rosa', clients)).cambiado).toBe(false);
    expect((await db.collection('transfers').get()).size).toBe(1);

    const rosa = clients.find((candidate) => candidate.id === 'rosa')!;
    expect(hasPendingTransfer(clients, await store.getTransfers(route), rosa)).toBe(true);

    // Un registro viejo, sin customerId, también cuenta como pendiente.
    await db.doc('transfers/vieja').set({ userId: UID, groupId: FAMILY, clientId: 'mario', clientName: 'Mario', createdAt: new Date() });
    expect((await markTransferForReview(db, account, 'mario', clients)).cambiado).toBe(false);
    await expect(markTransferForReview(db, account, 'ajena', clients)).rejects.toThrow('no pertenece');
  });

  test('agendar una vez: una ficha de directorio pasa a ser la visita (mismo id)', async () => {
    const account = await store.getAccount();
    const catalog = productCatalog(await store.getSettings());
    await db.doc('clients/directorio').update({ notes: 'Timbre 2', isStarred: true });
    const before = (await db.collection('clients').get()).size;

    const result = await scheduleOnce(db, account, catalog, 'directorio', tomorrow, { b12: 1, b20: 0 });
    expect(result.cambiado).toBe(true);
    // Igual que la app: la nota y la estrella de la ficha se pierden, y se informan.
    expect(result.antes).toEqual({ frecuencia: 'sin agenda (directorio)', proxima_visita: null, nota: 'Timbre 2', favorito: true });
    expect(result.despues).toEqual({
      ficha_id: 'directorio', ficha: 'misma', fecha: tomorrow, dia: tomorrowDay, productos: { b12: 1 }, nota: '', favorito: false,
    });
    expect((await db.collection('clients').get()).size).toBe(before);
    const after = (await db.doc('clients/directorio').get()).data()!;
    expect(after).toEqual(expect.objectContaining({
      customerId: 'directorio', freq: 'once', specificDate: tomorrow, visitDay: tomorrowDay, visitDays: [tomorrowDay],
      products: { b12: 1 }, isCompleted: false, isInactive: false, notes: '', isStarred: false, userId: UID, groupId: FAMILY,
      // Primera del día: mario (1), rosa (2) y unavez (sin orden → 0).
      listOrder: -1, listOrders: { [tomorrowDay]: -1 },
    }));
    const agenda = agendaFor(await store.getClients(account.routes[0]), tomorrow).map((entry) => entry.client.id);
    expect(agenda[0]).toBe('directorio');
  });

  test('agendar una vez: a un cliente en agenda le agrega otra ficha sin tocar la suya', async () => {
    const account = await store.getAccount();
    const catalog = productCatalog(await store.getSettings());
    const dayAfter = addDays(tomorrow, 1);
    const marioBefore = (await db.doc('clients/mario').get()).data();

    const result = await scheduleOnce(db, account, catalog, 'mario', dayAfter, { b12: 2 });
    expect(result.cambiado).toBe(true);
    expect(result.antes).toEqual({ frecuencia: 'semanal', proxima_visita: tomorrow, nota: '', favorito: false });
    const { ficha_id: newId, ficha } = result.despues as Record<string, string>;
    expect(ficha).toBe('nueva');
    expect(newId).not.toBe('mario');
    expect((await db.doc('clients/mario').get()).data()).toEqual(marioBefore);
    const created = (await db.doc(`clients/${newId}`).get()).data()!;
    expect(created).toEqual(expect.objectContaining({
      customerId: 'mario', name: 'Mario', address: 'Rambla', freq: 'once', specificDate: dayAfter,
      visitDay: weekdayOf(dayAfter), visitDays: [weekdayOf(dayAfter)], products: { b12: 2 }, listOrders: { [weekdayOf(dayAfter)]: -1 },
      userId: UID, groupId: FAMILY, scopeKey: `scope:${FAMILY}`, isNote: false, creationVersion: 1,
    }));
    expect(created.createdAt).toBeTruthy();
    expect((await db.doc(`users/${UID}`).get()).data()?.clientCreateVersion).toBe(1);

    // Con una ficha de directorio duplicada (mismo nombre y teléfono), la reutiliza como la app.
    await db.doc('clients/rosa-dup').set(client({ name: 'Rosa Jerez', phone: '099 123 456', freq: 'on_demand', customerId: 'rosa-dup' }));
    const reused = await scheduleOnce(db, account, catalog, 'rosa', dayAfter, { b20: 1 });
    expect(reused.despues).toEqual(expect.objectContaining({ ficha_id: 'rosa-dup', ficha: 'reutilizada' }));
    expect((await db.doc('clients/rosa-dup').get()).data()).toEqual(expect.objectContaining({
      freq: 'once', specificDate: dayAfter, customerId: 'rosa', products: { b20: 1 },
    }));
    expect((await db.doc('clients/rosa').get()).data()?.freq).toBe('weekly');
  });

  test('agendar una vez: no duplica una visita del mismo día', async () => {
    const account = await store.getAccount();
    const catalog = productCatalog(await store.getSettings());
    const dayAfter = addDays(tomorrow, 1);
    const first = await scheduleOnce(db, account, catalog, 'mario', dayAfter, { b12: 2 });
    const count = (await db.collection('clients').get()).size;

    const again = await scheduleOnce(db, account, catalog, 'mario', dayAfter, { b12: 3 });
    expect(again.cambiado).toBe(false);
    expect(again.despues).toEqual({ ficha_id: (first.despues as any).ficha_id, fecha: dayAfter, dia: weekdayOf(dayAfter), productos: { b12: 2 } });
    // Su visita semanal de mañana y la de dentro de una semana ya existen.
    expect((await scheduleOnce(db, account, catalog, 'mario', tomorrow, { b12: 1 })).despues)
      .toEqual(expect.objectContaining({ ficha_id: 'mario' }));
    expect((await scheduleOnce(db, account, catalog, 'mario', addDays(tomorrow, 7), { b12: 1 })).cambiado).toBe(false);
    // La ficha de una vez de Ana ya tiene esa fecha.
    expect((await scheduleOnce(db, account, catalog, 'unavez', tomorrow, { b12: 1 })).cambiado).toBe(false);

    await scheduleOnce(db, account, catalog, 'directorio', tomorrow, { b12: 1 });
    expect((await scheduleOnce(db, account, catalog, 'directorio', tomorrow, { b12: 1 })).cambiado).toBe(false);
    expect((await db.collection('clients').get()).size).toBe(count);
  });

  test('agendar una vez: rechaza fechas pasadas, productos desconocidos y fichas ajenas', async () => {
    const account = await store.getAccount();
    const catalog = productCatalog(await store.getSettings());
    await expect(scheduleOnce(db, account, catalog, 'directorio', addDays(todayKey(), -1), { b12: 1 })).rejects.toThrow('ya pasó');
    await expect(scheduleOnce(db, account, catalog, 'directorio', '2026-02-30', { b12: 1 })).rejects.toThrow('inválida');
    await expect(scheduleOnce(db, account, catalog, 'directorio', tomorrow, { inventado: 1 })).rejects.toThrow('desconocidos');
    await expect(scheduleOnce(db, account, catalog, 'ajena', tomorrow, { b12: 1 })).rejects.toThrow('no pertenece');
    expect((await db.doc('clients/directorio').get()).data()?.freq).toBe('on_demand');
    // Hoy sí se puede.
    expect((await scheduleOnce(db, account, catalog, 'directorio', todayKey(), { b12: 1 })).cambiado).toBe(true);
  });

  test('crear cliente: ficha de directorio con coordenadas del link, y sin duplicar por teléfono', async () => {
    const account = await loadAccount(db, UID);
    const primary = account.routes.find((route) => route.isPrimary)!;
    const created = await createClient(db, account, primary, {
      name: 'Irma', address: 'Sarandí y Baltasar Brum', phone: '099 309 717',
      mapsLink: 'https://www.google.com/maps/place/x/@-34.7701234,-55.8301234,17z', notes: 'Pasar a levantar todo',
    });
    expect(created.cambiado).toBe(true);
    const saved = (await db.doc(`clients/${created.cliente_id}`).get()).data()!;
    expect(saved).toMatchObject({
      userId: UID, groupId: FAMILY, name: 'Irma', freq: 'on_demand', visitDays: [], products: {},
      notes: 'Pasar a levantar todo', lat: '-34.770123', lng: '-55.830123', isNote: false,
    });
    expect(saved.phones).toEqual([{ id: 'primary', number: '099 309 717', isPrimary: true }]);

    // Mismo teléfono (con otro formato): no crea otra y devuelve la que hay.
    const again = await createClient(db, account, primary, { name: 'Otra', address: '', phone: '099309717', mapsLink: '', notes: '' });
    expect(again.cambiado).toBe(false);
    expect(again.cliente_id).toBe(created.cliente_id);
    const rosa = await createClient(db, account, primary, { name: 'Rosa', address: '', phone: '099123456', mapsLink: '', notes: '' });
    expect(rosa).toMatchObject({ cambiado: false, cliente_id: 'rosa' });

    // Después se agenda como cualquier ficha de directorio: pasa a ser la visita.
    const visit = await scheduleOnce(db, account, productCatalog(await store.getSettings()), created.cliente_id, tomorrow, {});
    expect(visit.despues).toMatchObject({ ficha: 'misma', fecha: tomorrow });
  });

  test('fusionar duplicados: queda la de agenda con los datos de la copia, mueve deuda y Parentesco, y se deshace', async () => {
    const batch = db.batch();
    // Copia de directorio = la ficha original del cliente (su id es el customerId de la de agenda).
    batch.set(db.doc('clients/raiz'), client({
      name: 'Laura Copia', freq: 'on_demand', visitDay: 'Sin Asignar', visitDays: [], address: 'Calle 1 esq.',
      phones: [{ id: 'primary', number: '099 111 111', isPrimary: true }, { id: 'p2', number: '098 222 222', isPrimary: false }],
      phone: '099 111 111', mapsLink: 'https://maps.app.goo.gl/x', lat: '-34.8', lng: '-55.9',
      notes: 'Timbre roto', rut: '123456', relationships: { hija: 'Hija' }, sameHousehold: { hija: true },
      lastDeliveredAt: new Date('2026-10-10T12:00:00'),
    }));
    batch.set(db.doc('clients/agenda'), client({
      name: 'Laura', customerId: 'raiz', address: 'Calle 1 esq. Pinos', phone: '099111111',
      phones: [{ id: 'primary', number: '099111111', isPrimary: true }], notes: '', products: { b20: 1 },
      lastDeliveredAt: new Date('2026-10-01T12:00:00'),
    }));
    batch.set(db.doc('clients/hija'), client({ name: 'Hija', freq: 'on_demand', visitDays: [], relationships: { raiz: 'Madre' }, sameHousehold: { raiz: true } }));
    batch.set(db.doc('debts/dl'), { userId: UID, groupId: FAMILY, clientId: 'raiz', clientName: 'Laura', amount: 200, createdAt: new Date('2026-10-02T12:00:00') });
    await batch.commit();
    const account = await loadAccount(db, UID);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fusiones-'));
    const cache = async () => ({
      clients: (await db.collection('clients').get()).docs.map((doc) => ({ ...doc.data(), id: doc.id }) as any),
      debts: (await db.collection('debts').get()).docs.map((doc) => ({ ...doc.data(), id: doc.id })),
      transfers: (await db.collection('transfers').get()).docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    });

    const preview = await mergeClients(db, account, 'raiz', 'agenda', false, dir, await cache());
    expect(preview.cambiado).toBe(false);
    expect((preview as any).plan).toMatchObject({
      deudas_movidas: 1, familiares_actualizados: ['Hija'], nota_de_la_copia_sin_sumar: 'Timbre roto',
    });
    // «Calle 1 esq.» no agrega nada a «Calle 1 esq. Pinos»: no se suma como otra dirección.
    expect((preview as any).plan.se_suma.join()).not.toContain('dirección');
    expect((await db.doc('clients/raiz').get()).exists).toBe(true);

    const merged = await mergeClients(db, account, 'raiz', 'agenda', true, dir, await cache(), true);
    expect(merged).toMatchObject({ cambiado: true, cliente_id: 'agenda' });
    expect((await db.doc('clients/raiz').get()).exists).toBe(false);
    const kept = (await db.doc('clients/agenda').get()).data()!;
    expect(kept.phones.map((p: any) => p.number)).toEqual(['099111111', '098 222 222']);
    expect(kept).toMatchObject({
      name: 'Laura', notes: 'Timbre roto', rut: '123456', mapsLink: 'https://maps.app.goo.gl/x', lat: '-34.8', lng: '-55.9',
      relationships: { hija: 'Hija' }, sameHousehold: { hija: true }, products: { b20: 1 }, customerId: 'raiz', freq: 'weekly',
    });
    expect(kept.lastDeliveredAt.toDate().getTime()).toBe(new Date('2026-10-10T12:00:00').getTime());
    const hija = (await db.doc('clients/hija').get()).data()!;
    expect(hija.relationships).toEqual({ agenda: 'Madre' });
    expect(hija.sameHousehold).toEqual({ agenda: true });
    expect((await db.doc('debts/dl').get()).data()).toMatchObject({ clientId: 'agenda', customerId: 'raiz' });

    // Dos de directorio del mismo lugar: queda el nombre y la dirección más completos.
    await db.doc('clients/romi').set(client({ name: 'Romi', freq: 'on_demand', visitDays: [], address: 'Centro Bambú',
      mapsLink: 'https://maps.app.goo.gl/b', phone: '099385608', products: { b20: 1 } }));
    await db.doc('clients/romina').set(client({ name: 'Romina Ferrari', freq: 'on_demand', visitDays: [],
      address: 'Juan Caruso esq. Diagonal Honduras (Centro Bambú)', mapsLink: 'https://maps.app.goo.gl/b', phone: '099385608' }));
    const romi = await mergeClients(db, account, 'romina', 'romi', true, dir, await cache());
    expect(romi.cliente_id).toBe('romi');
    expect((await db.doc('clients/romi').get()).data()).toMatchObject({
      name: 'Romina Ferrari', address: 'Juan Caruso esq. Diagonal Honduras (Centro Bambú)',
    });

    // Dos fichas con visitas no se fusionan.
    await expect(mergeClients(db, account, 'agenda', 'rosa', true, dir, await cache())).rejects.toThrow('tienen visitas');

    await undoMerge(db, account, (merged as any).copia);
    expect((await db.doc('clients/raiz').get()).data()).toMatchObject({ name: 'Laura Copia', notes: 'Timbre roto' });
    expect((await db.doc('clients/agenda').get()).data()).toMatchObject({ notes: '', phones: [{ id: 'primary', number: '099111111', isPrimary: true }] });
    expect((await db.doc('clients/hija').get()).data()!.relationships).toEqual({ raiz: 'Madre' });
    expect((await db.doc('debts/dl').get()).data()!.clientId).toBe('raiz');
  });

  test('tope diario de cargas completas: corta antes de leer, también en escrituras', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rutawater-cargas-'));
    setReadBudget(new ReadBudget(dir, 2));
    try {
      const account = await store.getAccount();
      const [primary, costa] = account.routes;
      await store.getClients(primary);
      await store.getDebts(primary);
      // Lo ya cargado sigue en vivo sin gastar otra carga.
      expect(await store.getClients(primary)).toHaveLength(4);
      await expect(store.getClients(costa)).rejects.toThrow('límite diario de 2 cargas');
      const catalog = productCatalog(await store.getSettings());
      await expect(scheduleOnce(db, account, catalog, 'directorio', tomorrow, { b20: 1 })).rejects.toThrow(ReadLimitError);
      expect((await db.doc('clients/directorio').get()).data()?.freq).toBe('on_demand');
      const [file] = fs.readdirSync(dir);
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(lines.map((line) => [line.carga, line.docs])).toEqual([
        ['clients de «Reparto 1»', 4], ['debts de «Reparto 1»', 2],
      ]);
    } finally {
      setReadBudget(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('mensaje de Enviar total como el botón de Deudas', () => {
    expect(debtTotalMessage('', 1500)).toBe('La deuda es de $1.500. Saludos');
    expect(debtTotalMessage('Hola, te quedan ${total} pendientes', 380)).toBe('Hola, te quedan $380 pendientes');
  });

  test('Listo de un pedido de una vez lo completa', async () => {
    const account = await store.getAccount();
    await markDone(db, account, 'unavez', tomorrow);
    expect((await db.doc('clients/unavez').get()).data()?.isCompleted).toBe(true);
    await expect(markDone(db, account, 'unavez', tomorrow)).rejects.toThrow('ya está marcado');
  });

  describe('ubicación en el recorrido', () => {
    // Una calle de oeste a este: Mario (km 0), Rosa (km 2), Ana (km 4).
    const at = (km: number) => ({ lat: String(-34.8), lng: String(Number((-56 + km * 0.011).toFixed(6))) });
    const route = async () => {
      const account = await store.getAccount();
      return { account, route: account.routes[0], clients: await store.getClients(account.routes[0]) };
    };

    beforeEach(async () => {
      const batch = db.batch();
      batch.update(db.doc('clients/mario'), at(0));
      batch.update(db.doc('clients/rosa'), at(2));
      batch.update(db.doc('clients/unavez'), { ...at(4), listOrders: { [tomorrowDay]: 3 } });
      // Directorio queda entre Mario y Rosa, con coordenadas solo en su dirección.
      batch.update(db.doc('clients/directorio'), {
        addresses: [{ id: 'a1', type: 'home', address: 'Km 1', mapsLink: 'https://maps.app.goo.gl/km1', ...at(1) }],
      });
      // Quincenal que esa semana no va: está en la lista del día pero no es parada.
      batch.set(db.doc('clients/libre'), client({
        name: 'Quincenal libre', freq: 'biweekly', listOrders: { [tomorrowDay]: 1.5 },
        lastVisited: new Date(`${addDays(tomorrow, -7)}T10:00:00`),
      }));
      await batch.commit();
    });

    test('sugerir: entre las dos paradas donde menos desvío agrega, contando toda la lista del día', async () => {
      const { clients } = await route();
      const target = clients.find((c) => c.id === 'directorio')!;
      const suggestion = suggestPosition(clients, target, tomorrow);
      expect(suggestion).toEqual(expect.objectContaining({
        posicion: 2, completa: true, sin_coordenadas: [], paradas: 3,
        anterior: { id: 'mario', nombre: 'Mario', posicion: 1 },
        siguiente: { id: 'rosa', nombre: 'Rosa Jerez', posicion: 3 },
      }));
      expect(suggestion.desvio_metros).toBeLessThan(5);
      // Más allá de Ana: después de la última.
      const far = { ...target, lat: '-34.8', lng: String(-56 + 6 * 0.011), addresses: [] };
      expect(suggestPosition(clients, far, tomorrow)).toEqual(expect.objectContaining({ posicion: 5, siguiente: null }));
    });

    test('sugerir: sin coordenadas no adivina', async () => {
      await db.doc('clients/rosa').update({ lat: '', lng: '' });
      const { clients } = await route();
      const target = clients.find((c) => c.id === 'directorio')!;
      const strict = suggestPosition(clients, target, tomorrow);
      expect(strict).toEqual(expect.objectContaining({
        posicion: null, completa: false, sin_coordenadas: [{ id: 'rosa', nombre: 'Rosa Jerez', posicion: 3 }],
      }));
      expect(strict.motivo).toContain('1 de las 3 paradas');
      expect(suggestPosition(clients, target, tomorrow, true)).toEqual(expect.objectContaining({ posicion: 2, completa: false }));
      const noPoint = suggestPosition(clients, clients.find((c) => c.id === 'rosa')!, tomorrow);
      expect(noPoint.posicion).toBeNull();
      expect(noPoint.motivo).toContain('no tiene coordenadas');
    });

    test('cambiar posición: el punto medio entre los vecinos nuevos, una sola escritura', async () => {
      const { account, clients } = await route();
      const result = await changePosition(db, account, clients, 'unavez', tomorrow, 2);
      expect(result).toEqual(expect.objectContaining({
        cambiado: true, antes: { dia: tomorrowDay, posicion: 4 },
        despues: { dia: tomorrowDay, posicion: 2, anterior: 'Mario', siguiente: 'Quincenal libre' },
      }));
      expect((await db.doc('clients/unavez').get()).data()?.listOrders).toEqual({ [tomorrowDay]: 1.25 });
      expect((await db.doc('clients/rosa').get()).data()?.listOrders).toEqual({ [tomorrowDay]: 2 });
      // La copia en vivo recibe el cambio por el listener.
      const live = async () => {
        for (let i = 0; i < 50; i += 1) {
          const list = await store.getClients(account.routes[0]);
          if (list.find((c) => c.id === 'unavez')?.listOrders?.[tomorrowDay] === 1.25) return list;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('el listener no se actualizó');
      };
      // Una posición mayor que la lista la deja última; la misma no escribe.
      await changePosition(db, account, await live(), 'mario', tomorrow, 99);
      expect((await db.doc('clients/mario').get()).data()?.listOrders).toEqual({ [tomorrowDay]: 3 });
      const fresh = (await db.collection('clients').get()).docs.map((doc) => ({ ...doc.data(), id: doc.id }) as any);
      const same = await changePosition(db, account, fresh.filter((c: any) => c.groupId === FAMILY), 'mario', tomorrow, 4);
      expect(same.cambiado).toBe(false);
    });

    test('cambiar posición: rechaza si el orden cambió mientras tanto o la ficha no es de ese día', async () => {
      const { account, clients } = await route();
      await db.doc('clients/libre').update({ [`listOrders.${tomorrowDay}`]: 7 });
      const stale = clients.map((c) => (c.id === 'libre' ? { ...c, listOrders: { [tomorrowDay]: 1.5 } } : c));
      await expect(changePosition(db, account, stale, 'unavez', tomorrow, 2)).rejects.toThrow('cambió mientras tanto');
      expect((await db.doc('clients/unavez').get()).data()?.listOrders).toEqual({ [tomorrowDay]: 3 });
      await expect(changePosition(db, account, clients, 'directorio', tomorrow, 1)).rejects.toThrow('no está en la lista');
      await expect(changePosition(db, account, clients, 'mario', addDays(tomorrow, 1), 1)).rejects.toThrow('no está en la lista');
    });

    test('agendar una vez con ubicar: queda entre Mario y la siguiente ficha, no primera', async () => {
      const account = await store.refreshAccount();
      const catalog = productCatalog(await store.getSettings());
      const result = await scheduleOnce(db, account, catalog, 'directorio', tomorrow, { b20: 1 }, true);
      expect(result.despues).toEqual(expect.objectContaining({ ficha_id: 'directorio', ficha: 'misma', posicion: 2 }));
      expect(result.ubicacion).toEqual(expect.objectContaining({ aplicada: true, posicion: 2, completa: true }));
      const saved = (await db.doc('clients/directorio').get()).data()!;
      expect(saved.listOrders).toEqual({ [tomorrowDay]: 1.25 });
      expect(saved.lat).toBe('-34.8');
      const agenda = agendaFor(await store.getClients(account.routes[0]), tomorrow).map((entry) => entry.client.id);
      expect(agenda).toEqual(['mario', 'directorio', 'rosa', 'unavez']);
    });

    test('agendar una vez con ubicar y coordenadas faltantes: queda primera y dice por qué', async () => {
      await db.doc('clients/unavez').update({ lat: '', lng: '' });
      const account = await store.refreshAccount();
      const catalog = productCatalog(await store.getSettings());
      const result = await scheduleOnce(db, account, catalog, 'mario', addDays(tomorrow, 7), { b12: 1 }, true);
      expect(result.cambiado).toBe(false); // ya va esa semana
      const placed = await scheduleOnce(db, account, catalog, 'directorio', tomorrow, { b20: 1 }, true);
      expect(placed.despues).toEqual(expect.objectContaining({ posicion: 1 }));
      expect(placed.ubicacion).toEqual(expect.objectContaining({
        aplicada: false, posicion: null, sin_coordenadas: [{ id: 'unavez', nombre: 'Ana Una Vez', posicion: 4 }],
      }));
      expect((await db.doc('clients/directorio').get()).data()?.listOrders).toEqual({ [tomorrowDay]: 0 });
      // Sin ubicar se comporta como antes.
      const plain = await scheduleOnce(db, account, catalog, 'rosa', addDays(tomorrow, 1), { b20: 1 });
      expect(plain.ubicacion).toBeUndefined();
      expect(plain.despues).not.toHaveProperty('posicion');
    });
  });
});
