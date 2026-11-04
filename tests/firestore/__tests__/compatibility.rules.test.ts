import fs from 'fs';
import path from 'path';
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import 'firebase/compat/firestore';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;

describeWithEmulator('1.48 to 1.49 compatibility Firestore rules', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, rawPort] = (emulator || '127.0.0.1:8080').split(':');
    testEnvironment = await initializeTestEnvironment({
      projectId: 'demo-rutawater-compat',
      firestore: {
        host,
        port: Number(rawPort),
        rules: fs.readFileSync(
          path.resolve(process.cwd(), 'firestore.compat.rules'),
          'utf8',
        ),
      },
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        db.doc('users/owner').set({ groupId: 'family', role: 'member', profileIds: [] }),
        db.doc('users/member').set({ groupId: 'family', role: 'admin', profileIds: [] }),
        db.doc('users/legacy').set({ groupId: null, role: null, profileIds: ['route'] }),
        db.doc('users/outsider').set({ groupId: null, role: null, profileIds: ['route'] }),
        db.doc('users/former-member').set({ groupId: null, role: null, profileIds: ['route'] }),
        db.doc('users/converter').set({ groupId: 'convert', role: 'admin', profileIds: [] }),
        db.doc('groups/family').set({ adminId: 'owner', code: 'FAMILY' }),
        db.doc('groups/convert').set({
          adminId: 'converter',
          code: 'CONVERT',
          lifecycleState: 'dissolving',
          dissolveRequestedBy: 'converter',
          createdAt: 'original-created-at',
          creationVersion: 'server_resumable_v1',
        }),
        db.doc('groupCodes/CONVERT').set({
          groupId: 'convert',
          ownerId: 'converter',
        }),
        db.doc('profiles/route').set({
          name: 'Legacy route',
          ownerId: 'owner',
          memberUids: ['owner', 'legacy'],
          members: { owner: { role: 'admin' }, legacy: { role: 'member' } },
        }),
        db.doc('clients/family-client').set({
          userId: 'member',
          groupId: 'family',
          name: 'Customer',
        }),
        db.doc('clients/route-client').set({
          userId: 'owner',
          groupId: 'route',
          name: 'Private route customer',
        }),
        db.doc('debts/route-debt').set({
          userId: 'owner',
          groupId: 'route',
          clientId: 'route-client',
          amount: 10,
        }),
        db.doc('transfers/route-transfer').set({
          userId: 'owner',
          groupId: 'route',
          clientId: 'route-client',
          amount: 5,
        }),
        db.doc('premiumOverrides/owner').set({
          active: true,
          type: 'lifetime',
          userId: 'owner',
          legacy: 'preserve',
        }),
        db.doc('premiumOverrides/legacy').set({
          active: false,
          type: 'lifetime',
          userId: 'legacy',
        }),
        db.doc('aiUsage/legacy').set({ count: 2, period: '2026-08' }),
      ]);
    });
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  test('an account cannot name a group or profile to reach its data (4/11/2026)', async () => {
    const outsider = testEnvironment.authenticatedContext('outsider').firestore();

    await assertFails(outsider.collection('groups').get());
    await assertFails(outsider.collection('groups').where('code', '==', 'FAMILY').limit(1).get());
    await assertFails(outsider.doc('groups/family').get());
    await assertFails(outsider.collection('profiles').get());
    await assertFails(outsider.doc('profiles/route').get());

    await assertFails(outsider.doc('users/outsider').update({ groupId: 'family' }));
    await assertFails(outsider.doc('users/outsider').update({ groupId: 'family', role: 'admin' }));
    await assertFails(outsider.doc('clients/family-client').get());
    await assertFails(outsider.doc('settings/family').get());

    await assertFails(outsider.doc('profiles/route').update({
      memberUids: ['owner', 'legacy', 'outsider'],
      members: { owner: { role: 'admin' }, legacy: { role: 'member' }, outsider: { role: 'member' } },
    }));
    await assertFails(outsider.doc('clients/route-client').get());
    await assertFails(outsider.doc('debts/route-debt').get());

    const brandNew = testEnvironment.authenticatedContext('brand-new').firestore();
    await assertFails(brandNew.doc('users/brand-new').set({ groupId: 'family' }));
    await assertSucceeds(brandNew.doc('users/brand-new').set({ email: 'a@b.c', displayName: 'A' }, { merge: true }));
    await assertFails(brandNew.doc('users/brand-new').set({ groupId: 'family' }, { merge: true }));
  });

  test('an account cannot drop documents into another scope or another user', async () => {
    const outsider = testEnvironment.authenticatedContext('outsider').firestore();

    for (const collection of ['clients', 'debts', 'transfers', 'deliveries']) {
      await assertFails(outsider.doc(`${collection}/into-group`).set({ userId: 'outsider', groupId: 'family', name: 'x' }));
      await assertFails(outsider.doc(`${collection}/into-route`).set({ userId: 'outsider', groupId: 'route', name: 'x' }));
      await assertFails(outsider.doc(`${collection}/as-victim`).set({ userId: 'owner', groupId: null, name: 'x' }));
    }
    await assertSucceeds(outsider.doc('clients/mine').set({ userId: 'outsider', groupId: null, name: 'Mine' }));
    await assertFails(outsider.doc('clients/mine').update({ groupId: 'family' }));
    await assertFails(outsider.doc('clients/mine').update({ userId: 'owner' }));
  });

  test('keeps what the published app does with its own group and profiles', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const member = testEnvironment.authenticatedContext('member').firestore();
    const legacy = testEnvironment.authenticatedContext('legacy').firestore();

    // Grupo propio: leerlo, reparar el rol, cargar y editar datos.
    await assertSucceeds(member.doc('groups/family').get());
    await assertSucceeds(owner.doc('groups/family').get());
    await assertSucceeds(member.doc('users/member').update({ role: 'member' }));
    await assertSucceeds(member.doc('users/member').set({ email: 'a@b.c' }, { merge: true }));
    await assertSucceeds(member.doc('clients/family-client').get());
    await assertSucceeds(owner.doc('clients/family-client').update({ name: 'Cambiado' }));
    for (const collection of ['clients', 'debts', 'transfers', 'deliveries']) {
      await assertSucceeds(member.doc(`${collection}/new-family`).set({ userId: 'member', groupId: 'family', name: 'x' }));
      await assertSucceeds(owner.doc(`${collection}/new-family`).update({ name: 'y' }));
      await assertSucceeds(owner.doc(`${collection}/new-personal`).set({ userId: 'owner', groupId: 'family', name: 'x' }));
    }
    await assertSucceeds(member.collection('clients').where('groupId', '==', 'family').get());
    await assertSucceeds(owner.collection('users').where('groupId', '==', 'family').get());
    await assertSucceeds(owner.doc('settings/family').set({ a: 1 }, { merge: true }));

    // Perfil propio: leerlo, listar los míos, cargar datos, salir, y el dueño saca a un miembro.
    await assertSucceeds(legacy.doc('profiles/route').get());
    await assertSucceeds(legacy.collection('profiles').where('memberUids', 'array-contains', 'legacy').get());
    await assertSucceeds(legacy.doc('clients/route-client').get());
    await assertSucceeds(legacy.doc('clients/route-new').set({ userId: 'legacy', groupId: 'route', name: 'x' }));
    await assertSucceeds(legacy.doc('profiles/route').update({ memberUids: ['owner'], members: { owner: { role: 'admin' } } }));
    await assertFails(legacy.doc('profiles/route').get());
    await assertSucceeds(owner.doc('profiles/route').update({ memberUids: ['owner'], members: { owner: { role: 'admin' } } }));

    // Salir del grupo y el admin que saca a un miembro.
    await assertSucceeds(owner.doc('users/member').update({ groupId: null, role: null }));
    const leaver = testEnvironment.authenticatedContext('converter').firestore();
    await assertSucceeds(leaver.doc('users/converter').update({ groupId: null, role: null }));
    await assertFails(leaver.doc('users/converter').update({ groupId: 'convert' }));
  });

  test('uses the canonical group admin for deletion despite stale roles', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await assertSucceeds(ownerDb.doc('clients/family-client').delete());
  });

  test('does not trust a stale admin role for deletion', async () => {
    const memberDb = testEnvironment.authenticatedContext('member').firestore();
    await assertFails(memberDb.doc('clients/family-client').delete());
  });

  test('does not trust forged or stale profileIds for business data access', async () => {
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();
    const formerDb = testEnvironment.authenticatedContext('former-member').firestore();

    for (const db of [outsiderDb, formerDb]) {
      await assertFails(db.doc('clients/route-client').get());
      await assertFails(db.collection('clients').where('groupId', '==', 'route').get());
      await assertFails(db.doc('clients/route-client').update({ name: 'Stolen' }));
      await assertFails(db.doc('debts/route-debt').delete());
      await assertFails(db.doc('transfers/route-transfer').delete());
    }
  });

  test('allows the 1.49 atomic family-group conversion', async () => {
    const converterDb = testEnvironment.authenticatedContext('converter').firestore();
    const batch = converterDb.batch();
    batch.set(converterDb.doc('profiles/convert'), {
      name: 'Converted route',
      ownerId: 'converter',
      memberUids: ['converter'],
      members: { converter: { role: 'admin' } },
      createdAt: 'original-created-at',
      lifecycleState: 'active',
      convertedFromFamilyGroup: true,
    });
    batch.update(converterDb.doc('users/converter'), {
      groupId: null,
      role: null,
      profileIds: ['convert'],
      activeProfileId: 'convert',
    });
    batch.delete(converterDb.doc('groupCodes/CONVERT'));
    batch.delete(converterDb.doc('groups/convert'));

    await assertSucceeds(batch.commit());
  });

  test('allows the 1.49 non-destructive profile archive', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await assertSucceeds(ownerDb.doc('profiles/route').update({
      lifecycleState: 'archived',
      archivedAt: new Date(),
      memberUids: ['owner'],
      members: { owner: { role: 'admin' } },
    }));

    expect((await ownerDb.doc('clients/route-client').get()).exists).toBe(true);
    expect((await ownerDb.doc('debts/route-debt').get()).exists).toBe(true);
    expect((await ownerDb.doc('transfers/route-transfer').get()).exists).toBe(true);
  });

  test('preserves existing Premium but blocks client grants and reactivation', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const legacyDb = testEnvironment.authenticatedContext('legacy').firestore();
    const newOwnerDb = testEnvironment.authenticatedContext('new-owner').firestore();

    await assertSucceeds(ownerDb.doc('premiumOverrides/owner').get());
    await assertFails(newOwnerDb.doc('premiumOverrides/new-owner').set({
      active: true,
      type: 'lifetime',
      code: 'RUTAVIP2026',
    }));
    await assertFails(legacyDb.doc('premiumOverrides/legacy').update({ active: true }));
    await assertSucceeds(ownerDb.doc('premiumOverrides/owner').update({ active: false }));
  });

  test('keeps AI quota server-owned after the backend rollout', async () => {
    const legacyDb = testEnvironment.authenticatedContext('legacy').firestore();

    await assertSucceeds(legacyDb.doc('aiUsage/legacy').get());
    await assertFails(legacyDb.doc('aiUsage/new-legacy').set({
      count: 1,
      period: '2026-08',
    }));
    await assertFails(legacyDb.doc('aiUsage/legacy').update({ count: 3 }));
    await assertFails(legacyDb.doc('aiUsage/legacy').update({ count: 0 }));
    await assertFails(legacyDb.doc('aiUsage/legacy').delete());
  });

  test('allows the 1.49 client to read the public rollout flag only', async () => {
    const legacyDb = testEnvironment.authenticatedContext('legacy').firestore();

    await assertSucceeds(legacyDb.doc('appConfig/dataScope').get());
    await assertFails(legacyDb.doc('appConfig/dataScope').set({ readVersion: 1 }));
  });

  test('keeps per-installation compatibility evidence Admin-only', async () => {
    const legacyDb = testEnvironment.authenticatedContext('legacy').firestore();

    await assertFails(legacyDb.doc('appCompatibility/legacy').get());
    await assertFails(legacyDb.doc('appCompatibility/legacy').set({
      status: 'compatible',
      installations: { forged: { buildNumber: 9999 } },
    }));
  });
});
