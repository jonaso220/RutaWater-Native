import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import {
  createGroupWithFirestore,
  createFirestoreGroupCreationOperations,
  GroupCreationError,
  GroupCreationIdentity,
  runResumableGroupCreation,
} from '../groupCreationService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('resumable group creation against Firestore emulator', () => {
  let app: App;
  let db: Firestore;
  const identity: GroupCreationIdentity = {
    uid: 'group-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  };

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  const seedClients = async (count: number) => {
    for (let offset = 0; offset < count; offset += 450) {
      const batch = db.batch();
      for (let index = offset; index < Math.min(offset + 450, count); index += 1) {
        batch.set(db.collection('clients').doc(`personal-${String(index).padStart(4, '0')}`), {
          userId: identity.uid,
          name: `Client ${index}`,
          untouched: { index },
        });
      }
      await batch.commit();
    }
  };

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `group-create-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      'users',
      'groups',
      'groupCodes',
      'profiles',
      'clients',
      'debts',
      'transfers',
      'settings',
      'accountDeletionJobs',
    ].map(clearCollection));
  });

  afterAll(async () => deleteApp(app));

  test('resumes a partial >500-document migration and activates membership only at the end', async () => {
    await seedClients(901);
    await Promise.all([
      db.collection('clients').doc('existing-profile-client').set({
        userId: identity.uid,
        groupId: 'existing-profile',
        name: 'Do not absorb',
      }),
      db.collection('settings').doc(identity.uid).set({
        catalog: ['water', 'soda'],
        nested: { template: 'hello' },
      }),
      db.collection('settings').doc('group_1234567890abcdef1234567890abcdef').set({
        backendOnly: true,
      }),
    ]);
    const operations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => 'group_1234567890abcdef1234567890abcdef',
      generateCode: () => 'ABC234',
      nowMillis: () => Date.parse('2026-08-04T12:00:00Z'),
    });

    const initialized = await operations.initialize(identity);
    expect(await operations.migrateNextBatch({
      collectionName: 'clients',
      uid: identity.uid,
      groupId: initialized.groupId,
    })).toEqual({ scanned: 450, migrated: 449, complete: false });

    const partialUser = (await db.collection('users').doc(identity.uid).get()).data();
    expect(partialUser).toEqual(expect.objectContaining({
      pendingGroupId: initialized.groupId,
      groupMigrationState: 'initializing',
    }));
    const partialGroup = (await db.collection('groups').doc(initialized.groupId).get()).data();
    expect(partialGroup?.migrationCursors?.clients).toBe('personal-0448');
    expect(partialGroup?.migrationCompleted?.clients).toBe(false);
    expect(partialUser?.groupId).toBeUndefined();
    expect((await db.collection('groups').doc(initialized.groupId).get()).data()?.lifecycleState)
      .toBe('initializing');

    const result = await runResumableGroupCreation(identity, operations);
    expect(result).toEqual({ groupId: initialized.groupId, code: 'ABC234' });
    const finalUser = (await db.collection('users').doc(identity.uid).get()).data();
    expect(finalUser).toEqual(expect.objectContaining({
      groupId: initialized.groupId,
      role: 'admin',
    }));
    expect(finalUser?.pendingGroupId).toBeUndefined();
    expect(finalUser?.groupMigrationState).toBeUndefined();
    expect((await db.collection('groups').doc(initialized.groupId).get()).data()?.lifecycleState)
      .toBe('active');

    const personalClients = await db.collection('clients')
      .where('userId', '==', identity.uid)
      .get();
    expect(personalClients.docs
      .filter((doc) => doc.id.startsWith('personal-'))
      .every((doc) => doc.data().groupId === initialized.groupId)).toBe(true);
    expect(personalClients.docs
      .filter((doc) => doc.id.startsWith('personal-'))
      .every((doc) => doc.data().scopeKey === `scope:${initialized.groupId}`)).toBe(true);
    expect((await db.collection('clients').doc('existing-profile-client').get()).data())
      .toEqual({ userId: identity.uid, groupId: 'existing-profile', name: 'Do not absorb' });
    expect((await db.collection('settings').doc(identity.uid).get()).data()).toEqual({
      catalog: ['water', 'soda'],
      nested: { template: 'hello' },
    });
    expect((await db.collection('settings').doc(initialized.groupId).get()).data()).toEqual({
      backendOnly: true,
      catalog: ['water', 'soda'],
      nested: { template: 'hello' },
    });

    // A lost HTTP response can safely retry without creating a second group.
    await expect(createGroupWithFirestore({ db, identity })).resolves.toEqual(result);
    expect((await db.collection('groups').get()).size).toBe(1);
  }, 30000);

  test('retries generated IDs/codes when a preserved profile or legacy group already uses them', async () => {
    await Promise.all([
      db.collection('profiles').doc('group_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').set({
        ownerId: 'legacy-owner',
      }),
      db.collection('groups').doc('legacy-group').set({
        adminId: 'legacy-owner',
        code: 'ABC234',
        lifecycleState: 'active',
      }),
    ]);
    const groupIds = [
      'group_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'group_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'group_cccccccccccccccccccccccccccccccc',
    ];
    const codes = ['DEF567', 'ABC234', 'GHJ789'];
    const operations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => groupIds.shift()!,
      generateCode: () => codes.shift()!,
    });

    const result = await runResumableGroupCreation(identity, operations);
    expect(result).toEqual({
      groupId: 'group_cccccccccccccccccccccccccccccccc',
      code: 'GHJ789',
    });
    expect((await db.collection('groupCodes').doc('GHJ789').get()).data())
      .toEqual(expect.objectContaining({ groupId: result.groupId, ownerId: identity.uid }));
    expect((await db.collection('groups').where('code', '==', 'GHJ789').get()).size).toBe(1);
  });

  test('never replaces another group membership or creates a pending reservation', async () => {
    await db.collection('users').doc(identity.uid).set({
      groupId: 'foreign-group',
      role: 'member',
    });
    const operations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => 'group_1234567890abcdef1234567890abcdef',
      generateCode: () => 'ABC234',
    });

    await expect(runResumableGroupCreation(identity, operations)).rejects.toBeInstanceOf(
      GroupCreationError,
    );
    expect((await db.collection('users').doc(identity.uid).get()).data()).toEqual({
      groupId: 'foreign-group',
      role: 'member',
    });
    expect((await db.collection('groups').get()).empty).toBe(true);
    expect((await db.collection('groupCodes').get()).empty).toBe(true);
  });

  test('rejects an over-free-budget migration before any group, fence or business write', async () => {
    await seedClients(3);
    await db.collection('users').doc(identity.uid).set({ email: identity.email });
    const before = (await db.collection('clients').orderBy('__name__').get()).docs
      .map((document) => ({ id: document.id, data: document.data() }));
    const operations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => 'group_1234567890abcdef1234567890abcdef',
      generateCode: () => 'ABC234',
      migrationDocumentLimit: 2,
    });

    await expect(runResumableGroupCreation(identity, operations)).rejects.toMatchObject({
      code: 'FREE_MIGRATION_LIMIT',
    });
    expect((await db.collection('groups').get()).empty).toBe(true);
    expect((await db.collection('groupCodes').get()).empty).toBe(true);
    expect((await db.collection('users').doc(identity.uid).get()).data()).toEqual({
      email: identity.email,
    });
    const after = (await db.collection('clients').orderBy('__name__').get()).docs
      .map((document) => ({ id: document.id, data: document.data() }));
    expect(after).toEqual(before);
  });

  test('does not create or resume a group after account deletion is locked', async () => {
    await db.collection('users').doc(identity.uid).set({
      accountState: 'deleting',
      email: identity.email,
    });
    const operations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => 'group_1234567890abcdef1234567890abcdef',
      generateCode: () => 'ABC234',
    });

    await expect(runResumableGroupCreation(identity, operations)).rejects.toMatchObject({
      code: 'GROUP_STATE_INVALID',
    });
    expect((await db.collection('groups').get()).empty).toBe(true);
    expect((await db.collection('groupCodes').get()).empty).toBe(true);
    expect((await db.collection('users').doc(identity.uid).get()).data()?.accountState)
      .toBe('deleting');
  });

  test('an existing deletion job blocks create-group even before any cached user read', async () => {
    await Promise.all([
      db.collection('users').doc(identity.uid).set({ email: identity.email }),
      db.collection('accountDeletionJobs').doc(identity.uid).set({
        uid: identity.uid,
        state: 'planning',
        scopes: { profileIds: [] },
      }),
    ]);
    const operations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => 'group_1234567890abcdef1234567890abcdef',
      generateCode: () => 'ABC234',
    });

    await expect(runResumableGroupCreation(identity, operations)).rejects.toMatchObject({
      code: 'GROUP_STATE_INVALID',
    });
    expect((await db.collection('groups').get()).empty).toBe(true);
    expect((await db.collection('groupCodes').get()).empty).toBe(true);
  });

  test('serializes two simultaneous create requests into one group and one code', async () => {
    await seedClients(3);
    const firstOperations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => 'group_11111111111111111111111111111111',
      generateCode: () => 'ABC234',
    });
    const secondOperations = createFirestoreGroupCreationOperations(db, {
      generateGroupId: () => 'group_22222222222222222222222222222222',
      generateCode: () => 'DEF567',
    });

    const [first, second] = await Promise.all([
      runResumableGroupCreation(identity, firstOperations),
      runResumableGroupCreation(identity, secondOperations),
    ]);

    expect(second).toEqual(first);
    expect((await db.collection('groups').get()).size).toBe(1);
    expect((await db.collection('groupCodes').get()).size).toBe(1);
    const user = (await db.collection('users').doc(identity.uid).get()).data();
    expect(user).toEqual(expect.objectContaining({ groupId: first.groupId, role: 'admin' }));
    expect(user?.pendingGroupId).toBeUndefined();
    const clients = await db.collection('clients').where('userId', '==', identity.uid).get();
    expect(clients.docs.every((doc) => doc.data().groupId === first.groupId)).toBe(true);
  });
});
