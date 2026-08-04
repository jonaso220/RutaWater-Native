import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { recoverLegacyFamilyGroup } from '../familyGroupRecoveryService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('legacy family group recovery against Firestore emulator', () => {
  let app: App;
  let db: Firestore;
  const identity = {
    uid: 'legacy-owner',
    email: 'owner@example.com',
    displayName: 'Legacy Owner',
  };

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `group-recovery-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      'users',
      'groups',
      'profiles',
      'accountDeletionJobs',
      'clients',
      'debts',
      'transfers',
      'settings',
    ].map(clearCollection));
  });

  afterAll(async () => deleteApp(app));

  test('repairs exactly one active owned group without changing business data', async () => {
    const client = { userId: identity.uid, groupId: 'legacy-family', nested: { value: 7 } };
    const debt = { userId: identity.uid, groupId: 'legacy-family', amount: 123 };
    await Promise.all([
      db.doc('users/legacy-owner').set({ email: 'old@example.com', profileIds: ['route'] }),
      db.doc('groups/legacy-family').set({
        adminId: identity.uid,
        code: 'LEG234',
        lifecycleState: 'active',
      }),
      db.doc('clients/customer').set(client),
      db.doc('debts/customer-debt').set(debt),
      db.doc('settings/legacy-family').set({ catalog: ['water'] }),
    ]);

    await expect(recoverLegacyFamilyGroup(db, identity)).resolves.toEqual({
      status: 'recovered',
      groupId: 'legacy-family',
      code: 'LEG234',
    });
    expect((await db.doc('users/legacy-owner').get()).data()).toEqual({
      email: identity.email,
      displayName: identity.displayName,
      profileIds: ['route'],
      groupId: 'legacy-family',
      role: 'admin',
      familyGroupRecoveryVersion: 1,
    });
    expect((await db.doc('clients/customer').get()).data()).toEqual(client);
    expect((await db.doc('debts/customer-debt').get()).data()).toEqual(debt);
    expect((await db.doc('settings/legacy-family').get()).data()).toEqual({ catalog: ['water'] });

    await expect(recoverLegacyFamilyGroup(db, identity)).resolves.toEqual({
      status: 'already',
      groupId: 'legacy-family',
      code: 'LEG234',
    });
  });

  test('does not guess when more than one group claims the same legacy admin', async () => {
    await Promise.all([
      db.doc('users/legacy-owner').set({ email: identity.email }),
      db.doc('groups/family-a').set({ adminId: identity.uid, lifecycleState: 'active' }),
      db.doc('groups/family-b').set({ adminId: identity.uid, lifecycleState: 'active' }),
      db.doc('clients/untouched').set({ userId: identity.uid, name: 'Personal customer' }),
    ]);

    await expect(recoverLegacyFamilyGroup(db, identity)).resolves.toEqual({
      status: 'ambiguous',
    });
    expect((await db.doc('users/legacy-owner').get()).data()?.groupId).toBeUndefined();
    expect((await db.doc('clients/untouched').get()).data()?.name).toBe('Personal customer');
  });

  test('clears an orphaned join preflight at login without touching personal data', async () => {
    const personalClient = { userId: identity.uid, name: 'Still personal', nested: { keep: true } };
    const personalSettings = { catalog: ['private'], nested: { keep: true } };
    await Promise.all([
      db.doc('users/legacy-owner').set({
        email: identity.email,
        groupId: null,
        pendingGroupId: 'interrupted-target',
        groupMigrationState: 'join_preflight',
      }),
      db.doc('clients/personal-client').set(personalClient),
      db.doc('settings/legacy-owner').set(personalSettings),
    ]);

    await expect(recoverLegacyFamilyGroup(db, identity)).resolves.toEqual({ status: 'not_found' });
    const user = (await db.doc('users/legacy-owner').get()).data();
    expect(user?.groupId).toBeNull();
    expect(user?.familyGroupRecoveryVersion).toBe(1);
    expect(user).not.toHaveProperty('pendingGroupId');
    expect(user).not.toHaveProperty('groupMigrationState');
    expect((await db.doc('clients/personal-client').get()).data()).toEqual(personalClient);
    expect((await db.doc('settings/legacy-owner').get()).data()).toEqual(personalSettings);
  });

  test.each([
    ['closing lifecycle', { lifecycleState: 'dissolving' }, {}, false],
    ['pending creation', { lifecycleState: 'active' }, { pendingGroupId: 'pending' }, false],
    ['deleting account state', { lifecycleState: 'active' }, { accountState: 'deleting' }, false],
    ['durable deletion job', { lifecycleState: 'active' }, {}, true],
  ])('blocks recovery for %s', async (_label, groupPatch, userPatch, withJob) => {
    await Promise.all([
      db.doc('users/legacy-owner').set(userPatch),
      db.doc('groups/legacy-family').set({
        adminId: identity.uid,
        ...groupPatch,
      }),
      ...(withJob ? [db.doc('accountDeletionJobs/legacy-owner').set({
        state: 'planning',
        scopes: { profileIds: [] },
      })] : []),
    ]);

    await expect(recoverLegacyFamilyGroup(db, identity)).resolves.toEqual({
      status: 'blocked',
    });
    expect((await db.doc('users/legacy-owner').get()).data()?.groupId).toBeUndefined();
  });
});
