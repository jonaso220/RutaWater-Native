import type { Auth } from 'firebase-admin/auth';
import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import {
  beginAccountDeletionJob,
  cancelPlanningAccountDeletion,
  cleanupDeletedAccountDocuments,
  deleteAccountDeletionJob,
  loadAccountDeletionJob,
  markAccountDeletionAuthDeleted,
  planAccountDeletion,
  persistAccountDeletionPlan,
  SharedScopeChangedError,
} from '../accountCleanupService';
import { resumeDeletedAccountJobs } from '../accountDeletionWorkerService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('account cleanup service against Firestore emulator', () => {
  let app: App;
  let db: Firestore;

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `account-cleanup-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      'users',
      'groups',
      'groupCodes',
      'profiles',
      'profileCodes',
      'profileCreateRequests',
      'clients',
      'debts',
      'transfers',
      'settings',
      'aiUsage',
      'premiumOverrides',
      'promoCodes',
      'daily_loads',
      'accountDeletionJobs',
    ].map(clearCollection));
  });

  afterAll(async () => deleteApp(app));

  test('transfers to a real Auth member, never to a stale user document', async () => {
    await Promise.all([
      db.doc('users/owner').set({ groupId: 'family', email: 'owner@example.com' }),
      db.doc('users/real-successor').set({
        groupId: 'family',
        role: 'member',
        email: 'real@example.com',
        displayName: 'Real',
      }),
      db.doc('users/deleting-first').set({
        groupId: 'family',
        role: 'member',
        accountState: 'deleting',
      }),
      db.doc('accountDeletionJobs/deleting-first').set({
        uid: 'deleting-first',
        state: 'planning',
        scopes: { profileIds: [] },
      }),
      db.doc('users/stale-first').set({ groupId: 'family', role: 'member' }),
      db.doc('groups/family').set({
        adminId: 'owner',
        lifecycleState: 'active',
        code: 'ABC234',
      }),
      db.doc('groupCodes/ABC234').set({ groupId: 'family', ownerId: 'owner' }),
      db.doc('clients/shared').set({
        groupId: 'family',
        userId: 'owner',
        name: 'Preserved customer',
      }),
    ]);
    const missing = Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
    const adminAuth = {
      getUser: jest.fn(async (uid: string) => {
        if (uid === 'real-successor' || uid === 'deleting-first') {
          return { uid, disabled: false };
        }
        throw missing;
      }),
    } as unknown as Auth;
    const clientBefore = (await db.doc('clients/shared').get()).data();

    await expect(planAccountDeletion(db, adminAuth, 'owner')).resolves.toEqual({ profileIds: [] });

    expect((await db.doc('groups/family').get()).data()).toEqual(expect.objectContaining({
      adminId: 'real-successor',
      adminEmail: 'real@example.com',
      lifecycleState: 'active',
    }));
    expect((await db.doc('users/real-successor').get()).data()?.role).toBe('admin');
    expect((await db.doc('groupCodes/ABC234').get()).data()?.ownerId).toBe('real-successor');
    expect((await db.doc('users/owner').get()).data()?.groupId).toBeNull();
    expect((await db.doc('users/stale-first').get()).data()?.groupId).toBeNull();
    // Auth still exists, so a concurrent deletion remains a preserved member
    // until its own job finishes or cancels.
    expect((await db.doc('users/deleting-first').get()).data()?.groupId).toBe('family');
    expect(adminAuth.getUser).toHaveBeenCalledWith('deleting-first');
    expect((await db.doc('clients/shared').get()).data()).toEqual(clientBefore);
  });

  test('discovers a canonically owned legacy group when users.groupId is missing', async () => {
    await Promise.all([
      db.doc('users/legacy-owner').set({ email: 'owner@example.com' }),
      db.doc('users/legacy-member').set({
        groupId: 'orphan-risk-family',
        role: 'member',
        email: 'member@example.com',
      }),
      db.doc('groups/orphan-risk-family').set({
        adminId: 'legacy-owner',
        code: 'ORP234',
        lifecycleState: 'active',
      }),
      db.doc('clients/orphan-risk-client').set({
        groupId: 'orphan-risk-family',
        userId: 'legacy-owner',
        name: 'Must survive',
      }),
    ]);
    const adminAuth = {
      getUser: jest.fn(async (uid: string) => ({ uid, disabled: false })),
    } as unknown as Auth;

    await expect(planAccountDeletion(db, adminAuth, 'legacy-owner')).resolves.toEqual({
      profileIds: [],
    });
    expect((await db.doc('groups/orphan-risk-family').get()).data()).toEqual(
      expect.objectContaining({
        adminId: 'legacy-member',
        lifecycleState: 'active',
      }),
    );
    expect((await db.doc('clients/orphan-risk-client').get()).data()?.name).toBe('Must survive');
  });

  test('aborts deletion planning when legacy ownership is ambiguous', async () => {
    await Promise.all([
      db.doc('users/legacy-owner').set({}),
      db.doc('groups/legacy-a').set({ adminId: 'legacy-owner', lifecycleState: 'active' }),
      db.doc('groups/legacy-b').set({ adminId: 'legacy-owner', lifecycleState: 'active' }),
      db.doc('clients/ambiguous-customer').set({
        userId: 'legacy-owner',
        groupId: 'legacy-a',
      }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    await expect(planAccountDeletion(db, adminAuth, 'legacy-owner')).rejects.toMatchObject({
      code: 'SHARED_SCOPE_CHANGED',
    });
    expect((await db.doc('groups/legacy-a').get()).data()?.lifecycleState).toBe('active');
    expect((await db.doc('groups/legacy-b').get()).data()?.lifecycleState).toBe('active');
    expect((await db.doc('clients/ambiguous-customer').get()).exists).toBe(true);
  });

  test('profile ownership preserves but never promotes a member whose deletion started', async () => {
    await Promise.all([
      db.doc('users/route-owner').set({}),
      db.doc('users/route-active').set({
        displayName: 'Active',
        profileIds: [],
        profileIndexVersion: 1,
      }),
      db.doc('users/route-deleting').set({ accountState: 'deleting' }),
      db.doc('accountDeletionJobs/route-deleting').set({
        uid: 'route-deleting',
        state: 'planning',
        scopes: { profileIds: [] },
      }),
      db.doc('profiles/route').set({
        ownerId: 'route-owner',
        code: 'PRF234',
        creationVersion: 'profile_codes_v1',
        lifecycleState: 'active',
        memberUids: ['route-owner', 'route-deleting', 'route-active'],
        members: {
          'route-owner': { role: 'admin' },
          'route-deleting': { role: 'member' },
          'route-active': { role: 'member' },
        },
      }),
      db.doc('profileCodes/PRF234').set({
        profileId: 'route', ownerId: 'route-owner', reservationVersion: 'profile_codes_v1',
      }),
      db.doc('clients/route-client').set({
        groupId: 'route',
        userId: 'route-owner',
        name: 'Preserved route customer',
      }),
    ]);
    const adminAuth = {
      getUser: jest.fn(async (uid: string) => ({ uid })),
    } as unknown as Auth;

    await expect(planAccountDeletion(db, adminAuth, 'route-owner')).resolves.toEqual({
      profileIds: [],
    });
    expect((await db.doc('profiles/route').get()).data()).toEqual(expect.objectContaining({
      ownerId: 'route-active',
      lifecycleState: 'active',
      memberUids: ['route-active', 'route-deleting'],
    }));
    expect(adminAuth.getUser).toHaveBeenCalledWith('route-deleting');
    expect((await db.doc('users/route-active').get()).data()).toEqual(expect.objectContaining({
      profileIds: ['route'],
      profileIndexVersion: 1,
    }));
    expect((await db.doc('profileCodes/PRF234').get()).data()?.ownerId).toBe('route-active');
    expect((await db.doc('clients/route-client').get()).data()?.name)
      .toBe('Preserved route customer');
  });

  test('concurrent member deletion can cancel without owner deleting shared customers', async () => {
    await Promise.all([
      db.doc('users/concurrent-owner').set({
        groupId: 'concurrent-family', role: 'admin', accountState: 'active',
      }),
      db.doc('users/concurrent-member').set({
        groupId: 'concurrent-family', role: 'member', accountState: 'active',
      }),
      db.doc('groups/concurrent-family').set({
        adminId: 'concurrent-owner', lifecycleState: 'active', code: 'CON234',
      }),
      db.doc('clients/concurrent-shared-client').set({
        groupId: 'concurrent-family', userId: 'concurrent-owner', name: 'Never delete',
      }),
    ]);
    await beginAccountDeletionJob(db, 'concurrent-member');
    const adminAuth = {
      getUser: jest.fn(async (uid: string) => ({ uid, disabled: false })),
    } as unknown as Auth;

    await expect(planAccountDeletion(db, adminAuth, 'concurrent-owner')).resolves.toEqual({
      profileIds: [],
    });
    expect((await db.doc('groups/concurrent-family').get()).data()).toEqual(
      expect.objectContaining({
        lifecycleState: 'archived',
        archivedReason: 'owner_deleted_with_preserved_members',
      }),
    );
    expect((await db.doc('clients/concurrent-shared-client').get()).data()?.name)
      .toBe('Never delete');

    await expect(cancelPlanningAccountDeletion(db, 'concurrent-member')).resolves.toBe(true);
    expect((await db.doc('users/concurrent-member').get()).data()).toEqual(
      expect.objectContaining({ accountState: 'active', groupId: 'concurrent-family' }),
    );
    expect((await db.doc('clients/concurrent-shared-client').get()).data()?.name)
      .toBe('Never delete');
  });

  test('discovers an ownerId-only legacy profile and plans its private data safely', async () => {
    await Promise.all([
      db.doc('users/owner-only').set({ email: 'legacy@example.com' }),
      db.doc('profiles/owner-only-route').set({
        ownerId: 'owner-only',
        lifecycleState: 'active',
        memberUids: [],
        members: {},
      }),
      db.doc('clients/owner-only-client').set({
        userId: 'owner-only',
        groupId: 'owner-only-route',
        name: 'Must be discovered',
      }),
      db.doc('settings/owner-only-route').set({ catalog: ['legacy'] }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    await beginAccountDeletionJob(db, 'owner-only');
    const scopes = await planAccountDeletion(db, adminAuth, 'owner-only');
    expect(scopes).toEqual({ profileIds: ['owner-only-route'] });
    expect((await db.doc('profiles/owner-only-route').get()).data()).toEqual(
      expect.objectContaining({
        ownerId: 'owner-only',
        lifecycleState: 'deleting',
        memberUids: ['owner-only'],
      }),
    );
    expect((await db.doc('clients/owner-only-client').get()).exists).toBe(true);

    await cleanupDeletedAccountDocuments(db, 'owner-only', scopes);
    expect((await db.doc('profiles/owner-only-route').get()).exists).toBe(false);
    expect((await db.doc('clients/owner-only-client').get()).exists).toBe(false);
    expect((await db.doc('settings/owner-only-route').get()).exists).toBe(false);
  });

  test('repairs a live legacy Auth member without users doc and transfers ownership safely', async () => {
    await Promise.all([
      db.doc('users/legacy-owner').set({}),
      db.doc('profiles/legacy-route').set({
        ownerId: 'legacy-owner',
        lifecycleState: 'active',
        memberUids: ['legacy-owner', 'live-without-user-doc'],
        members: {
          'legacy-owner': { role: 'admin' },
          'live-without-user-doc': { role: 'member', name: 'Legacy member' },
        },
      }),
      db.doc('clients/legacy-route-client').set({
        groupId: 'legacy-route',
        userId: 'legacy-owner',
        name: 'Must survive ownership transfer',
      }),
    ]);
    const adminAuth = {
      getUser: jest.fn(async (uid: string) => ({
        uid,
        email: 'live@example.com',
        displayName: 'Live member',
        disabled: false,
      })),
    } as unknown as Auth;

    const scopes = await planAccountDeletion(db, adminAuth, 'legacy-owner');
    expect(scopes).toEqual({ profileIds: [] });
    expect((await db.doc('profiles/legacy-route').get()).data()).toEqual(expect.objectContaining({
      ownerId: 'live-without-user-doc',
      lifecycleState: 'active',
      memberUids: ['live-without-user-doc'],
    }));
    expect((await db.doc('users/live-without-user-doc').get()).data()).toEqual(
      expect.objectContaining({
        email: 'live@example.com',
        displayName: 'Live member',
        profileIds: ['legacy-route'],
      }),
    );
    await cleanupDeletedAccountDocuments(db, 'legacy-owner', scopes);
    expect((await db.doc('clients/legacy-route-client').get()).data()?.name)
      .toBe('Must survive ownership transfer');
    expect((await db.doc('profiles/legacy-route').get()).exists).toBe(true);
  });

  test('preserves group and profile data when the only remaining Auth member is disabled', async () => {
    await Promise.all([
      db.doc('users/owner').set({ groupId: 'disabled-family', role: 'admin' }),
      db.doc('users/disabled-member').set({
        groupId: 'disabled-family',
        role: 'member',
      }),
      db.doc('groups/disabled-family').set({
        adminId: 'owner',
        adminEmail: 'owner@example.com',
        adminName: 'Deleting Owner',
        code: 'DIS234',
        lifecycleState: 'active',
      }),
      db.doc('profiles/disabled-route').set({
        ownerId: 'owner',
        lifecycleState: 'active',
        memberUids: ['owner', 'disabled-member'],
        members: {
          owner: { role: 'admin' },
          'disabled-member': { role: 'member' },
        },
      }),
      db.doc('clients/disabled-family-client').set({
        groupId: 'disabled-family',
        userId: 'owner',
      }),
      db.doc('debts/disabled-route-debt').set({
        groupId: 'disabled-route',
        userId: 'owner',
      }),
    ]);
    const adminAuth = {
      getUser: jest.fn(async (uid: string) => ({ uid, disabled: true })),
    } as unknown as Auth;

    const scopes = await planAccountDeletion(db, adminAuth, 'owner');
    expect(scopes).toEqual({ profileIds: [] });
    expect((await db.doc('groups/disabled-family').get()).data()).toEqual(
      expect.objectContaining({
        adminId: 'owner',
        lifecycleState: 'archived',
        archivedReason: 'owner_deleted_with_preserved_members',
      }),
    );
    expect((await db.doc('groups/disabled-family').get()).data()).not.toHaveProperty('adminEmail');
    expect((await db.doc('groups/disabled-family').get()).data()).not.toHaveProperty('adminName');
    expect((await db.doc('profiles/disabled-route').get()).data()).toEqual(
      expect.objectContaining({
        ownerId: 'owner',
        lifecycleState: 'archived',
        memberUids: ['disabled-member'],
      }),
    );

    await cleanupDeletedAccountDocuments(db, 'owner', scopes);
    expect((await db.doc('clients/disabled-family-client').get()).exists).toBe(true);
    expect((await db.doc('debts/disabled-route-debt').get()).exists).toBe(true);
    expect((await db.doc('groups/disabled-family').get()).exists).toBe(true);
    expect((await db.doc('profiles/disabled-route').get()).exists).toBe(true);
  });

  test('a preserved archived member can later delete their account without shared data loss', async () => {
    await Promise.all([
      db.doc('users/returning-member').set({
        groupId: 'archived-family',
        role: 'member',
        profileIds: ['archived-profile'],
      }),
      db.doc('groups/archived-family').set({
        adminId: 'deleted-owner',
        lifecycleState: 'archived',
        archivedReason: 'owner_deleted_with_preserved_members',
      }),
      db.doc('profiles/archived-profile').set({
        ownerId: 'deleted-owner',
        lifecycleState: 'archived',
        archivedReason: 'owner_deleted_with_preserved_members',
        memberUids: ['returning-member'],
        members: { 'returning-member': { role: 'member' } },
      }),
      db.doc('clients/archived-family-client').set({
        groupId: 'archived-family', userId: 'deleted-owner', name: 'Preserve family',
      }),
      db.doc('debts/archived-profile-debt').set({
        groupId: 'archived-profile', userId: 'deleted-owner', amount: 50,
      }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    await expect(planAccountDeletion(db, adminAuth, 'returning-member')).resolves.toEqual({
      profileIds: [],
    });
    expect((await db.doc('users/returning-member').get()).data()?.groupId).toBeNull();
    expect((await db.doc('profiles/archived-profile').get()).data()?.memberUids).toEqual([]);

    await cleanupDeletedAccountDocuments(db, 'returning-member', { profileIds: [] });
    expect((await db.doc('clients/archived-family-client').get()).data()?.name)
      .toBe('Preserve family');
    expect((await db.doc('debts/archived-profile-debt').get()).data()?.amount).toBe(50);
    expect((await db.doc('groups/archived-family').get()).exists).toBe(true);
    expect((await db.doc('profiles/archived-profile').get()).exists).toBe(true);
  });

  test('aborts ownership transfer if the chosen Auth successor becomes disabled', async () => {
    await Promise.all([
      db.doc('users/flaky-owner').set({}),
      db.doc('users/flaky-successor').set({}),
      db.doc('profiles/flaky-route').set({
        ownerId: 'flaky-owner',
        lifecycleState: 'active',
        memberUids: ['flaky-owner', 'flaky-successor'],
        members: {
          'flaky-owner': { role: 'admin' },
          'flaky-successor': { role: 'member' },
        },
      }),
      db.doc('clients/flaky-client').set({
        groupId: 'flaky-route',
        userId: 'flaky-owner',
      }),
    ]);
    let authRead = 0;
    const adminAuth = {
      getUser: jest.fn(async (uid: string) => ({
        uid,
        disabled: authRead++ > 0,
      })),
    } as unknown as Auth;

    await expect(planAccountDeletion(db, adminAuth, 'flaky-owner')).rejects.toMatchObject({
      code: 'SHARED_SCOPE_CHANGED',
    });
    expect((await db.doc('profiles/flaky-route').get()).data()?.ownerId).toBe('flaky-owner');
    expect((await db.doc('clients/flaky-client').get()).exists).toBe(true);
  });

  test('deletes only private scopes after Auth deletion and leaves unrelated customers intact', async () => {
    await Promise.all([
      db.doc('users/owner').set({ groupId: 'solo-family', role: 'admin' }),
      db.doc('groups/solo-family').set({
        adminId: 'owner',
        lifecycleState: 'active',
        code: 'SOLO23',
      }),
      db.doc('groupCodes/SOLO23').set({ groupId: 'solo-family', ownerId: 'owner' }),
      db.doc('profiles/solo-profile').set({
        ownerId: 'owner',
        code: 'SOL234',
        creationVersion: 'profile_codes_v1',
        lifecycleState: 'active',
        memberUids: ['owner'],
        members: { owner: { role: 'admin' } },
      }),
      db.doc('profileCodes/SOL234').set({
        profileId: 'solo-profile', ownerId: 'owner', reservationVersion: 'profile_codes_v1',
      }),
      db.doc('profileCreateRequests/owner_request-123456').set({
        ownerId: 'owner', profileId: 'solo-profile', code: 'SOL234', name: 'Solo',
      }),
      db.doc('clients/family-private').set({ groupId: 'solo-family', userId: 'owner' }),
      db.doc('debts/profile-private').set({ groupId: 'solo-profile', userId: 'owner' }),
      db.doc('transfers/personal-private').set({ userId: 'owner', amount: 10 }),
      db.doc('clients/unrelated').set({ groupId: 'other-scope', userId: 'other' }),
      db.doc('settings/solo-family').set({ catalog: ['family'] }),
      db.doc('settings/solo-profile').set({ catalog: ['profile'] }),
      db.doc('settings/owner').set({ personal: true }),
      db.doc('aiUsage/owner').set({ count: 8 }),
      db.doc('premiumOverrides/owner').set({ active: true }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    const scopes = await planAccountDeletion(db, adminAuth, 'owner');
    expect(scopes).toEqual({
      familyGroupId: 'solo-family',
      familyGroupCode: 'SOLO23',
      profileIds: ['solo-profile'],
    });
    expect((await db.doc('clients/family-private').get()).exists).toBe(true);
    expect((await db.doc('debts/profile-private').get()).exists).toBe(true);

    await cleanupDeletedAccountDocuments(db, 'owner', scopes);

    for (const path of [
      'clients/family-private',
      'debts/profile-private',
      'transfers/personal-private',
      'groups/solo-family',
      'groupCodes/SOLO23',
      'profiles/solo-profile',
      'profileCodes/SOL234',
      'profileCreateRequests/owner_request-123456',
      'settings/owner',
      'aiUsage/owner',
      'premiumOverrides/owner',
    ]) {
      expect((await db.doc(path).get()).exists).toBe(false);
    }
    expect((await db.doc('users/owner').get()).data()).toEqual({ accountState: 'deleted' });
    expect((await db.doc('clients/unrelated').get()).exists).toBe(true);
  });

  test('persists deletion scopes monotonically until cleanup finishes', async () => {
    await expect(beginAccountDeletionJob(db, 'owner')).resolves.toEqual({
      state: 'planning',
      scopes: { profileIds: [] },
    });
    const scopes = { familyGroupId: 'solo-family', profileIds: ['route-b', 'route-a'] };
    await expect(persistAccountDeletionPlan(db, 'owner', scopes)).resolves.toEqual({
      familyGroupId: 'solo-family',
      profileIds: ['route-a', 'route-b'],
    });
    // A late concurrent retry with an empty observation must never erase the
    // private scope ids already proven and stored before Auth deletion.
    await expect(persistAccountDeletionPlan(db, 'owner', { profileIds: [] })).resolves.toEqual({
      familyGroupId: 'solo-family',
      profileIds: ['route-a', 'route-b'],
    });
    await markAccountDeletionAuthDeleted(db, 'owner');
    await expect(loadAccountDeletionJob(db, 'owner')).resolves.toEqual({
      state: 'auth_deleted',
      scopes: { familyGroupId: 'solo-family', profileIds: ['route-a', 'route-b'] },
    });
    await deleteAccountDeletionJob(db, 'owner');
    await expect(loadAccountDeletionJob(db, 'owner')).resolves.toBeNull();
  });

  test('a late auth-deleted marker cannot recreate a job another retry completed', async () => {
    await beginAccountDeletionJob(db, 'owner');
    await persistAccountDeletionPlan(db, 'owner', { profileIds: ['route-a'] });

    // Simulate the winning concurrent execution completing first. The losing
    // execution reaches its late marker afterwards and must leave no partial,
    // scope-less job for the recovery worker.
    await deleteAccountDeletionJob(db, 'owner');
    await markAccountDeletionAuthDeleted(db, 'owner');

    await expect(loadAccountDeletionJob(db, 'owner')).resolves.toBeNull();
  });

  test('planning cannot recreate a durable job concurrently cancelled or completed', async () => {
    await beginAccountDeletionJob(db, 'owner');
    await deleteAccountDeletionJob(db, 'owner');

    await expect(persistAccountDeletionPlan(db, 'owner', {
      profileIds: ['route-a'],
    })).rejects.toMatchObject({ code: 'SHARED_SCOPE_CHANGED' });
    await expect(loadAccountDeletionJob(db, 'owner')).resolves.toBeNull();
  });

  test('does not let a member leave after an owner has closed a shared scope', async () => {
    await Promise.all([
      db.doc('users/member').set({ groupId: 'closing-family', role: 'member' }),
      db.doc('users/profile-member').set({ groupId: null, role: null }),
      db.doc('groups/closing-family').set({
        adminId: 'owner',
        lifecycleState: 'deleting',
        deleteRequestedBy: 'owner',
      }),
      db.doc('profiles/closing-profile').set({
        ownerId: 'owner',
        lifecycleState: 'deleting',
        deleteRequestedBy: 'owner',
        memberUids: ['owner', 'profile-member'],
        members: { owner: { role: 'admin' }, 'profile-member': { role: 'member' } },
      }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    await expect(planAccountDeletion(db, adminAuth, 'member')).rejects.toMatchObject({
      code: 'SHARED_SCOPE_CHANGED',
    });
    expect((await db.doc('users/member').get()).data()?.groupId).toBe('closing-family');
    await expect(planAccountDeletion(db, adminAuth, 'profile-member')).rejects.toMatchObject({
      code: 'SHARED_SCOPE_CHANGED',
    });
    expect((await db.doc('profiles/closing-profile').get()).data()?.memberUids)
      .toContain('profile-member');
  });

  test('resumes cleanup of a partially migrated pending group from its durable plan', async () => {
    const pendingGroupId = 'group_1234567890abcdef1234567890abcdef';
    await Promise.all([
      db.doc('users/owner').set({
        email: 'private@example.com',
        pendingGroupId,
        groupMigrationState: 'initializing',
      }),
      db.doc(`groups/${pendingGroupId}`).set({
        adminId: 'owner',
        code: 'PEND23',
        lifecycleState: 'initializing',
        creationVersion: 'server_resumable_v1',
      }),
      db.doc('groupCodes/PEND23').set({ groupId: pendingGroupId, ownerId: 'owner' }),
      db.doc('clients/already-migrated').set({
        userId: 'owner',
        groupId: pendingGroupId,
        untouched: { value: 1 },
      }),
      db.doc('debts/still-personal').set({ userId: 'owner', amount: 9 }),
      db.doc(`settings/${pendingGroupId}`).set({ copied: true }),
      db.doc('clients/unrelated-pending-test').set({ userId: 'other', groupId: 'other' }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    await beginAccountDeletionJob(db, 'owner');
    const planned = await planAccountDeletion(db, adminAuth, 'owner');
    expect(planned).toEqual({
      familyGroupId: pendingGroupId,
      familyGroupCode: 'PEND23',
      profileIds: [],
    });
    expect((await db.doc('clients/already-migrated').get()).exists).toBe(true);
    expect((await db.doc(`groups/${pendingGroupId}`).get()).data()?.lifecycleState).toBe('deleting');
    await persistAccountDeletionPlan(db, 'owner', planned);

    // Simulate a function cut after Auth deletion: the next invocation reloads
    // exact scopes instead of replanning from metadata that cleanup may remove.
    await markAccountDeletionAuthDeleted(db, 'owner');
    const resumed = await loadAccountDeletionJob(db, 'owner');
    expect(resumed?.scopes).toEqual(planned);
    await cleanupDeletedAccountDocuments(db, 'owner', resumed!.scopes);

    for (const path of [
      'clients/already-migrated',
      'debts/still-personal',
      `groups/${pendingGroupId}`,
      'groupCodes/PEND23',
      `settings/${pendingGroupId}`,
    ]) {
      expect((await db.doc(path).get()).exists).toBe(false);
    }
    expect((await db.doc('clients/unrelated-pending-test').get()).exists).toBe(true);
    expect((await db.doc('users/owner').get()).data()).toEqual({ accountState: 'deleted' });
    // Cleanup never removes the plan itself; the handler does that only after
    // all collections and the tombstone finish successfully.
    expect((await db.doc('accountDeletionJobs/owner').get()).exists).toBe(true);
    await deleteAccountDeletionJob(db, 'owner');
  });

  test('releases a join preflight without treating the target as an owned group', async () => {
    const targetGroup = {
      adminId: 'other-owner',
      code: 'JOIN23',
      lifecycleState: 'active',
      immutable: { keep: true },
    };
    const targetClient = {
      userId: 'other-owner',
      groupId: 'join-target',
      name: 'Other account customer',
    };
    await Promise.all([
      db.doc('users/owner').set({
        email: 'private@example.com',
        groupId: null,
        pendingGroupId: 'join-target',
        groupMigrationState: 'join_preflight',
      }),
      db.doc('groups/join-target').set(targetGroup),
      db.doc('clients/join-target-client').set(targetClient),
      db.doc('clients/private-before-join').set({ userId: 'owner', name: 'Private' }),
      db.doc('settings/owner').set({ catalog: ['private'] }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    await beginAccountDeletionJob(db, 'owner');
    const planned = await planAccountDeletion(db, adminAuth, 'owner');

    expect(planned).toEqual({ profileIds: [] });
    expect((await db.doc('users/owner').get()).data()).toEqual(expect.objectContaining({
      accountState: 'deleting',
      groupId: null,
    }));
    expect((await db.doc('users/owner').get()).data()).not.toHaveProperty('pendingGroupId');
    expect((await db.doc('users/owner').get()).data()).not.toHaveProperty('groupMigrationState');
    expect((await db.doc('groups/join-target').get()).data()).toEqual(targetGroup);
    expect((await db.doc('clients/join-target-client').get()).data()).toEqual(targetClient);

    await cleanupDeletedAccountDocuments(db, 'owner', planned);
    expect((await db.doc('groups/join-target').get()).data()).toEqual(targetGroup);
    expect((await db.doc('clients/join-target-client').get()).data()).toEqual(targetClient);
    expect((await db.doc('clients/private-before-join').get()).exists).toBe(false);
    expect((await db.doc('settings/owner').get()).exists).toBe(false);
  });

  test('scheduled worker resumes a durable job after a cut immediately after Auth deletion', async () => {
    await Promise.all([
      db.doc('users/cut-after-auth').set({
        accountState: 'deleting',
        email: 'must-disappear@example.com',
      }),
      db.doc('accountDeletionJobs/cut-after-auth').set({
        uid: 'cut-after-auth',
        requestedBy: 'cut-after-auth',
        requestVersion: 'recent_auth_v1',
        requestConfirmedAt: 'confirmed',
        workerNextAttemptAt: new Date('2020-01-01T00:00:00Z'),
        workerAttemptCount: 0,
        state: 'auth_deleted',
        scopes: { profileIds: [] },
      }),
      db.doc('clients/cut-private-client').set({
        userId: 'cut-after-auth',
        name: 'Private customer',
      }),
      db.doc('settings/cut-after-auth').set({ catalog: ['private'] }),
    ]);
    const missing = Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
    const adminAuth = {
      deleteUser: jest.fn(async () => { throw missing; }),
    } as unknown as Auth;

    await expect(resumeDeletedAccountJobs({
      db,
      adminAuth,
      maxJobs: 10,
      pageSize: 1,
    })).resolves.toEqual({
      scanned: 1, completed: 1, skipped: 0, cancelled: 0, failed: 0,
    });

    expect((await db.doc('accountDeletionJobs/cut-after-auth').get()).exists).toBe(false);
    expect((await db.doc('clients/cut-private-client').get()).exists).toBe(false);
    expect((await db.doc('settings/cut-after-auth').get()).exists).toBe(false);
    expect((await db.doc('users/cut-after-auth').get()).data()).toEqual({
      accountState: 'deleted',
    });
  });

  test('scheduled worker paginates within a hard cap and skips an unproven legacy job', async () => {
    await Promise.all(['worker-a', 'worker-b', 'worker-c', 'worker-live'].flatMap((uid) => [
      db.doc(`users/${uid}`).set({ accountState: 'deleting', private: uid }),
      db.doc(`accountDeletionJobs/${uid}`).set({
        uid,
        ...(uid === 'worker-live' ? {} : {
          requestedBy: uid,
          requestVersion: 'recent_auth_v1',
          requestConfirmedAt: 'confirmed',
        }),
        workerNextAttemptAt: new Date('2020-01-01T00:00:00Z'),
        workerAttemptCount: 0,
        state: uid === 'worker-live' ? 'planned' : 'auth_deleted',
        scopes: { profileIds: [] },
      }),
      db.doc(`clients/${uid}-private`).set({ userId: uid, name: uid }),
    ]));
    const missing = Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
    const adminAuth = {
      deleteUser: jest.fn(async () => { throw missing; }),
    } as unknown as Auth;

    const first = await resumeDeletedAccountJobs({ db, adminAuth, maxJobs: 2, pageSize: 1 });
    expect(first).toEqual({
      scanned: 2, completed: 2, skipped: 0, cancelled: 0, failed: 0,
    });
    expect((await db.collection('accountDeletionJobs').get()).size).toBe(2);

    const second = await resumeDeletedAccountJobs({ db, adminAuth, maxJobs: 2, pageSize: 1 });
    expect(second).toEqual({
      scanned: 2, completed: 1, skipped: 1, cancelled: 0, failed: 0,
    });
    expect((await db.doc('accountDeletionJobs/worker-live').get()).exists).toBe(true);
    expect((await db.doc('clients/worker-live-private').get()).exists).toBe(true);
    expect((await db.doc('users/worker-live').get()).data()).toEqual({
      accountState: 'deleting',
      private: 'worker-live',
    });
  });

  test('backoff prevents three failing low-order jobs from starving a later valid deletion', async () => {
    const uids = ['fail-a', 'fail-b', 'fail-c', 'valid-z'];
    await Promise.all(uids.flatMap((uid, index) => [
      db.doc(`users/${uid}`).set({ accountState: 'deleting', private: uid }),
      db.doc(`accountDeletionJobs/${uid}`).set({
        uid,
        requestedBy: uid,
        requestVersion: 'recent_auth_v1',
        requestConfirmedAt: 'confirmed',
        workerNextAttemptAt: new Date(`2020-01-0${index + 1}T00:00:00Z`),
        workerAttemptCount: 0,
        state: 'auth_deleted',
        scopes: { profileIds: [] },
      }),
    ]));
    const adminAuth = {} as Auth;
    const deleteAuthUser = jest.fn(async (_auth: Auth, uid: string) => {
      if (uid.startsWith('fail-')) throw new Error('temporary Auth outage');
    });

    const first = await resumeDeletedAccountJobs({
      db,
      adminAuth,
      maxJobs: 3,
      pageSize: 3,
      deleteAuthUser,
    });
    expect(first).toEqual({
      scanned: 3, completed: 0, skipped: 0, cancelled: 0, failed: 3,
    });

    const second = await resumeDeletedAccountJobs({
      db,
      adminAuth,
      maxJobs: 3,
      pageSize: 1,
      deleteAuthUser,
    });
    expect(second).toEqual({
      scanned: 1, completed: 1, skipped: 0, cancelled: 0, failed: 0,
    });
    expect((await db.doc('accountDeletionJobs/valid-z').get()).exists).toBe(false);
    expect((await db.doc('users/valid-z').get()).data()).toEqual({ accountState: 'deleted' });
    for (const uid of ['fail-a', 'fail-b', 'fail-c']) {
      expect((await db.doc(`accountDeletionJobs/${uid}`).get()).data()?.workerAttemptCount)
        .toBe(1);
    }
  });

  test('scheduled worker resumes a proven planning job before deleting Auth', async () => {
    await Promise.all([
      db.doc('users/planning-cut').set({ accountState: 'deleting', private: 'remove' }),
      db.doc('accountDeletionJobs/planning-cut').set({
        uid: 'planning-cut',
        requestedBy: 'planning-cut',
        requestVersion: 'recent_auth_v1',
        requestConfirmedAt: 'confirmed',
        workerNextAttemptAt: new Date('2020-01-01T00:00:00Z'),
        workerAttemptCount: 0,
        state: 'planning',
        scopes: { profileIds: [] },
      }),
      db.doc('clients/planning-cut-client').set({
        userId: 'planning-cut', name: 'Private customer',
      }),
    ]);
    const adminAuth = {
      getUser: jest.fn(),
      deleteUser: jest.fn(async () => {}),
    } as unknown as Auth;

    const stats = await resumeDeletedAccountJobs({ db, adminAuth, maxJobs: 1, pageSize: 1 });
    expect(stats).toEqual({
      scanned: 1, completed: 1, skipped: 0, cancelled: 0, failed: 0,
    });
    expect((adminAuth.deleteUser as jest.Mock)).toHaveBeenCalledWith('planning-cut');
    expect((await db.doc('accountDeletionJobs/planning-cut').get()).exists).toBe(false);
    expect((await db.doc('clients/planning-cut-client').get()).exists).toBe(false);
    expect((await db.doc('users/planning-cut').get()).data()).toEqual({ accountState: 'deleted' });
  });

  test('scope conflict cancels planning and reopens only this job markers without deleting Auth', async () => {
    await Promise.all([
      db.doc('users/conflicted-owner').set({ accountState: 'deleting' }),
      db.doc('accountDeletionJobs/conflicted-owner').set({
        uid: 'conflicted-owner',
        requestedBy: 'conflicted-owner',
        requestVersion: 'recent_auth_v1',
        requestConfirmedAt: 'confirmed',
        workerNextAttemptAt: new Date('2020-01-01T00:00:00Z'),
        workerAttemptCount: 0,
        state: 'planning',
        scopes: { profileIds: [] },
      }),
      db.doc('groups/conflicted-family').set({
        adminId: 'conflicted-owner',
        lifecycleState: 'deleting',
        deleteRequestedBy: 'conflicted-owner',
        deleteRequestedAt: 'marker',
        deletePreviousLifecycleState: 'active',
      }),
      db.doc('clients/conflicted-customer').set({
        userId: 'conflicted-owner', groupId: 'conflicted-family', name: 'Preserve',
      }),
    ]);
    const adminAuth = {
      deleteUser: jest.fn(async () => {}),
    } as unknown as Auth;
    const changed = new SharedScopeChangedError('scope changed');

    const stats = await resumeDeletedAccountJobs({
      db,
      adminAuth,
      maxJobs: 1,
      pageSize: 1,
      plan: jest.fn(async () => { throw changed; }),
    });
    expect(stats).toEqual({
      scanned: 1, completed: 0, skipped: 0, cancelled: 1, failed: 0,
    });
    expect((adminAuth.deleteUser as jest.Mock)).not.toHaveBeenCalled();
    expect((await db.doc('accountDeletionJobs/conflicted-owner').get()).exists).toBe(false);
    expect((await db.doc('users/conflicted-owner').get()).data()?.accountState).toBe('active');
    expect((await db.doc('groups/conflicted-family').get()).data()).toEqual({
      adminId: 'conflicted-owner',
      lifecycleState: 'active',
    });
    expect((await db.doc('clients/conflicted-customer').get()).data()?.name).toBe('Preserve');
  });

  test('removes promo redemption PII without returning a code slot or affecting other Premium', async () => {
    const promoId = 'a'.repeat(64);
    const legacyPromoId = 'b'.repeat(64);
    await Promise.all([
      db.doc(`promoCodes/${promoId}`).set({
        active: true, type: 'lifetime', maxUses: 5, usedCount: 2,
      }),
      db.doc(`promoCodes/${promoId}/redemptions/deleting-promo-user`).set({
        uid: 'deleting-promo-user', redeemedAt: 'original',
      }),
      db.doc(`promoCodes/${promoId}/redemptions/other-premium-user`).set({
        uid: 'other-premium-user', redeemedAt: 'original',
      }),
      db.doc('premiumOverrides/deleting-promo-user').set({
        active: true, promoId, type: 'lifetime',
      }),
      db.doc('premiumOverrides/other-premium-user').set({
        active: true, promoId, type: 'lifetime',
      }),
      db.doc(`promoCodes/${legacyPromoId}`).set({
        active: true, type: 'lifetime', maxUses: 2, usedCount: 1,
      }),
      db.doc(`promoCodes/${legacyPromoId}/redemptions/legacy-promo-user`).set({
        uid: 'legacy-promo-user', redeemedAt: 'legacy',
      }),
      db.doc(`promoCodes/${legacyPromoId}/redemptions/deleting-promo-user`).set({
        uid: 'deleting-promo-user', redeemedAt: 'older-redemption',
      }),
      db.doc('premiumOverrides/legacy-promo-user').set({
        active: true, type: 'lifetime', source: 'legacy',
      }),
    ]);

    await cleanupDeletedAccountDocuments(db, 'deleting-promo-user', { profileIds: [] });
    expect((await db.doc(`promoCodes/${promoId}`).get()).data()?.usedCount).toBe(2);
    expect((await db.doc(`promoCodes/${promoId}/redemptions/deleting-promo-user`).get()).exists)
      .toBe(false);
    expect((await db.doc(`promoCodes/${legacyPromoId}/redemptions/deleting-promo-user`).get()).exists)
      .toBe(false);
    expect((await db.doc(`promoCodes/${legacyPromoId}`).get()).data()?.usedCount).toBe(1);
    expect((await db.doc(`promoCodes/${promoId}/redemptions/other-premium-user`).get()).exists)
      .toBe(true);
    expect((await db.doc('premiumOverrides/other-premium-user').get()).data()?.active).toBe(true);

    await cleanupDeletedAccountDocuments(db, 'legacy-promo-user', { profileIds: [] });
    expect((await db.doc(`promoCodes/${legacyPromoId}`).get()).data()?.usedCount).toBe(1);
    expect((await db.doc(`promoCodes/${legacyPromoId}/redemptions/legacy-promo-user`).get()).exists)
      .toBe(false);
  });

  test('includes an owner-only archived profile in post-Auth cleanup', async () => {
    await Promise.all([
      db.doc('users/archived-owner').set({}),
      db.doc('profiles/archived-route').set({
        ownerId: 'archived-owner',
        lifecycleState: 'archived',
        archivedBy: 'archived-owner',
        memberUids: ['archived-owner'],
        members: { 'archived-owner': { role: 'admin' } },
      }),
      db.doc('clients/archived-client').set({
        userId: 'archived-owner',
        groupId: 'archived-route',
        name: 'Archived client',
      }),
    ]);
    const adminAuth = { getUser: jest.fn() } as unknown as Auth;

    const scopes = await planAccountDeletion(db, adminAuth, 'archived-owner');
    expect(scopes).toEqual({ profileIds: ['archived-route'] });
    expect((await db.doc('profiles/archived-route').get()).data()?.lifecycleState).toBe('deleting');
    expect((await db.doc('clients/archived-client').get()).exists).toBe(true);

    await cleanupDeletedAccountDocuments(db, 'archived-owner', scopes);
    expect((await db.doc('profiles/archived-route').get()).exists).toBe(false);
    expect((await db.doc('clients/archived-client').get()).exists).toBe(false);
    expect((await db.doc('users/archived-owner').get()).data()).toEqual({
      accountState: 'deleted',
    });
  });
});
