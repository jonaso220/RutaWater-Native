import fs from 'fs';
import path from 'path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

// Seguimiento en vivo del camión (Realtime Database): cada «En camino» crea un
// link que la webapp lee sin cuenta hasta que vence (30 min); solo el
// repartidor dueño escribe.
const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;

const TOKEN = 'k3Jd9sLqP0xVb7Ma2NcR4t';
const MINUTE = 60 * 1000;
const now = firebase.database.ServerValue.TIMESTAMP;

describeWithEmulator('reglas de seguimiento en vivo', () => {
  let env: RulesTestEnvironment;
  let owner: firebase.database.Database;
  let other: firebase.database.Database;
  let visitor: firebase.database.Database;

  const base = (extra: Record<string, unknown> = {}) => ({
    ownerUid: 'owner', estado: 'preparado', dia: '2026-10-17', vence: Date.now() + 30 * MINUTE, actualizado: now, ...extra,
  });
  const onRoute = (extra: Record<string, unknown> = {}) => base({
    estado: 'en_camino', lat: -34.9, lng: -56.16, precision: 12, rumbo: 90, ...extra,
  });

  beforeAll(async () => {
    const [host, port] = emulator!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-seguimiento',
      database: { host, port: Number(port), rules: fs.readFileSync(path.resolve('database.rules.json'), 'utf8') },
    });
    owner = env.authenticatedContext('owner').database() as any;
    other = env.authenticatedContext('otro').database() as any;
    visitor = env.unauthenticatedContext().database() as any;
  });
  beforeEach(() => env.clearDatabase());
  afterAll(() => env.cleanup());

  test('el dueño crea, actualiza la posición y termina el reparto', async () => {
    const ref = owner.ref(`seguimiento/${TOKEN}`);
    await assertSucceeds(ref.set(base()));
    await assertSucceeds(ref.set(onRoute()));
    await assertSucceeds(ref.update({ lat: -34.91, lng: -56.17, rumbo: 180, actualizado: now }));
    await assertSucceeds(ref.set(base({ estado: 'terminado' })));
    await assertSucceeds(ref.remove());
  });

  test('cualquiera con el link lee, pero no se pueden listar los repartos', async () => {
    await env.withSecurityRulesDisabled((context) => context.database().ref(`seguimiento/${TOKEN}`).set(onRoute({ actualizado: Date.now() })));
    const snap = await assertSucceeds(visitor.ref(`seguimiento/${TOKEN}`).get());
    expect(snap.val()).toEqual(expect.objectContaining({ estado: 'en_camino', lat: -34.9 }));
    await assertFails(visitor.ref('seguimiento').get());
    await assertFails(owner.ref('seguimiento').get());
  });

  test('un link vencido o inexistente no se puede leer', async () => {
    await env.withSecurityRulesDisabled((context) => context.database().ref(`seguimiento/${TOKEN}`)
      .set(onRoute({ vence: Date.now() - 1000, actualizado: Date.now() })));
    await assertFails(visitor.ref(`seguimiento/${TOKEN}`).get());
    await assertFails(visitor.ref('seguimiento/NoExisteNoExisteNoExiste1').get());
  });

  test('un link vencido no recibe más ubicaciones', async () => {
    await env.withSecurityRulesDisabled((context) => context.database().ref(`seguimiento/${TOKEN}`)
      .set({ ...onRoute({ actualizado: Date.now() }), vence: Date.now() - 1000 }));
    await assertFails(owner.ref(`seguimiento/${TOKEN}`).update({ lat: -34.91, lng: -56.17, actualizado: now }));
    await assertSucceeds(owner.ref(`seguimiento/${TOKEN}`).remove());
  });

  test('nadie más escribe ni se adueña del reparto', async () => {
    await assertFails(visitor.ref(`seguimiento/${TOKEN}`).set(base()));
    await assertFails(other.ref(`seguimiento/${TOKEN}`).set(base()));
    await assertSucceeds(owner.ref(`seguimiento/${TOKEN}`).set(base()));
    await assertFails(other.ref(`seguimiento/${TOKEN}`).set(base({ ownerUid: 'otro' })));
    await assertFails(other.ref(`seguimiento/${TOKEN}/lat`).set(-34.9));
    await assertFails(owner.ref(`seguimiento/${TOKEN}`).set(base({ ownerUid: 'otro' })));
  });

  test('la ubicación solo existe mientras está en camino', async () => {
    const ref = owner.ref(`seguimiento/${TOKEN}`);
    await assertFails(ref.set(base({ lat: -34.9, lng: -56.16 })));
    await assertFails(ref.set(base({ estado: 'terminado', lat: -34.9, lng: -56.16 })));
    await assertFails(ref.set(base({ estado: 'en_camino' })));
    await assertSucceeds(ref.set(onRoute()));
    // Terminar sin borrar la posición deja la última ubicación expuesta: se rechaza.
    await assertFails(ref.update({ estado: 'terminado', actualizado: now }));
    await assertSucceeds(ref.update({ estado: 'terminado', lat: null, lng: null, precision: null, rumbo: null, actualizado: now }));
  });

  test('el recorrido se agrega punto a punto y se borra al terminar', async () => {
    const ref = owner.ref(`seguimiento/${TOKEN}`);
    await assertFails(ref.set(base({ rastro: { a: { lat: -34.9, lng: -56.16, t: Date.now() } } })));
    await assertSucceeds(ref.set(onRoute()));
    await assertSucceeds(ref.child('rastro').push({ lat: -34.9, lng: -56.16, t: now }));
    await assertSucceeds(ref.child('rastro').push({ lat: -34.91, lng: -56.17, t: now }));
    await assertFails(ref.child('rastro').push({ lat: -34.9, lng: -56.16 }));
    await assertFails(ref.child('rastro').push({ lat: -34.9, lng: -56.16, t: now, nota: 'x' }));
    await assertFails(other.ref(`seguimiento/${TOKEN}/rastro`).push({ lat: -34.9, lng: -56.16, t: now }));
    const snap = await visitor.ref(`seguimiento/${TOKEN}/rastro`).get();
    expect(Object.keys(snap.val())).toHaveLength(2);
    await assertFails(ref.update({ estado: 'terminado', lat: null, lng: null, precision: null, rumbo: null, actualizado: now }));
    await assertSucceeds(ref.update({
      estado: 'terminado', lat: null, lng: null, precision: null, rumbo: null, rastro: null, actualizado: now,
    }));
  });

  test('valida tipos, la hora del servidor, el vencimiento y campos extra', async () => {
    const ref = owner.ref(`seguimiento/${TOKEN}`);
    await assertFails(ref.set(onRoute({ lat: 91 })));
    await assertFails(ref.set(onRoute({ lng: 'x' })));
    await assertFails(ref.set(onRoute({ rumbo: 360 })));
    await assertFails(ref.set(base({ dia: 'mañana' })));
    await assertFails(ref.set(base({ actualizado: Date.now() - MINUTE })));
    await assertFails(ref.set(base({ vence: Date.now() + 3 * 60 * MINUTE })));
    await assertFails(ref.set(base({ vence: Date.now() - 1000 })));
    await assertFails(ref.set(base({ telefono: '099 123 456' })));
    await assertFails(ref.set(base({ titulo: 'x'.repeat(61) })));
    await assertFails(owner.ref('seguimiento/corto').set(base()));
    await assertSucceeds(ref.set(base({ titulo: 'Agua RutaWater' })));
  });
});
