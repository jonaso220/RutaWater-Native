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
        db.doc('groups/family').set({ adminId: 'owner', code: 'FAMILY' }),
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

  test('keeps the distributed group and profile queries available', async () => {
    const legacyDb = testEnvironment.authenticatedContext('legacy').firestore();

    await assertSucceeds(
      legacyDb.collection('groups').where('code', '==', 'FAMILY').limit(1).get(),
    );
    await assertSucceeds(
      legacyDb.collection('profiles').where('memberUids', 'array-contains', 'legacy').get(),
    );
    await assertSucceeds(legacyDb.doc('profiles/route').update({
      memberUids: ['owner'],
      members: { owner: { role: 'admin' } },
    }));
  });

  test('keeps legacy group creation and self-membership updates available', async () => {
    const legacyDb = testEnvironment.authenticatedContext('legacy').firestore();

    await assertSucceeds(legacyDb.doc('groups/new-family').set({
      adminId: 'legacy',
      code: 'NEWFAMILY',
    }));
    await assertSucceeds(legacyDb.doc('users/legacy').update({
      groupId: 'new-family',
      role: 'admin',
    }));
  });

  test('uses the canonical group admin for deletion despite stale roles', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await assertSucceeds(ownerDb.doc('clients/family-client').delete());
  });

  test('does not trust a stale admin role for deletion', async () => {
    const memberDb = testEnvironment.authenticatedContext('member').firestore();
    await assertFails(memberDb.doc('clients/family-client').delete());
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
});
