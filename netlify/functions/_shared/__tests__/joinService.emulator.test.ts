import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { joinGroupByCode, joinProfileByCode } from '../joinService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('authenticated join services against Firestore emulator', () => {
  let app: App;
  let db: Firestore;

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `join-service-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      'groups',
      'profiles',
      'profileCodes',
      'users',
      'accountDeletionJobs',
      'clients',
      'debts',
      'transfers',
      'settings',
    ].map(clearCollection));
    await Promise.all([
      db.collection('groups').doc('open-a').set({
        code: 'ABC234', adminId: 'admin-a', lifecycleState: 'active',
      }),
      db.collection('groups').doc('open-b').set({
        code: 'DEF567', adminId: 'admin-b', lifecycleState: 'active',
      }),
      db.collection('groups').doc('closing').set({
        code: 'GHJ789', adminId: 'admin-c', lifecycleState: 'dissolving',
      }),
      db.collection('profiles').doc('route-open').set({
        code: 'KLM234',
        ownerId: 'route-owner',
        lifecycleState: 'active',
        memberUids: ['route-owner'],
        members: { 'route-owner': { role: 'admin' } },
      }),
      db.collection('profiles').doc('route-legacy').set({
        code: 'NPQ567',
        ownerId: 'legacy-owner',
        memberUids: ['legacy-owner'],
        members: { 'legacy-owner': { role: 'admin' } },
      }),
      db.collection('profiles').doc('route-closing').set({
        code: 'RST789',
        ownerId: 'closing-owner',
        lifecycleState: 'closing',
        memberUids: ['closing-owner'],
        members: { 'closing-owner': { role: 'admin' } },
      }),
      db.collection('users').doc('new-user').set({
        email: 'new@example.com', displayName: 'New', groupId: null, profileIds: [],
      }),
      db.collection('users').doc('admin-a').set({
        email: 'admin@example.com', groupId: null, role: null,
      }),
      db.collection('users').doc('busy-user').set({ groupId: 'open-b', role: 'member' }),
      db.collection('users').doc('profile-user').set({
        email: 'profile@example.com', displayName: 'Profile User', profileIds: [],
      }),
      db.collection('users').doc('racer').set({ groupId: null, role: null }),
      db.collection('users').doc('deleting-user').set({
        groupId: null, role: null, accountState: 'deleting', profileIds: [],
      }),
      db.collection('users').doc('pending-user').set({
        groupId: null, role: null, pendingGroupId: 'reserved-group', profileIds: [],
      }),
      db.collection('users').doc('deletion-job-user').set({
        groupId: null, role: null, accountState: 'active', profileIds: [],
      }),
      db.collection('users').doc('existing-profile-member').set({
        accountState: 'active', profileIds: [],
      }),
      db.collection('accountDeletionJobs').doc('deletion-job-user').set({ state: 'planned' }),
    ]);
  });

  afterAll(async () => deleteApp(app));

  test('joins one active group, preserves account data, and is idempotent', async () => {
    await expect(joinGroupByCode({ db, uid: 'new-user', code: 'ABC234' })).resolves.toBe('ok');
    expect((await db.collection('users').doc('new-user').get()).data()).toEqual({
      email: 'new@example.com',
      displayName: 'New',
      groupId: 'open-a',
      role: 'member',
      profileIds: [],
    });
    await expect(joinGroupByCode({ db, uid: 'new-user', code: 'ABC234' })).resolves.toBe('already');
  });

  test('refuses to hide personal business data and releases the join reservation', async () => {
    const personalDocuments = {
      client: { userId: 'new-user', name: 'Personal client', nested: { keep: true } },
      debt: { userId: 'new-user', clientId: 'personal-client', amount: 15 },
      transfer: { userId: 'new-user', clientId: 'personal-client', amount: 7 },
    };
    await Promise.all([
      db.doc('clients/personal-client').set(personalDocuments.client),
      db.doc('debts/personal-debt').set(personalDocuments.debt),
      db.doc('transfers/personal-transfer').set(personalDocuments.transfer),
    ]);

    await expect(joinGroupByCode({ db, uid: 'new-user', code: 'ABC234' }))
      .resolves.toBe('has_personal_data');
    expect((await db.doc('users/new-user').get()).data()).toEqual({
      email: 'new@example.com',
      displayName: 'New',
      groupId: null,
      profileIds: [],
    });
    expect((await db.doc('clients/personal-client').get()).data()).toEqual(personalDocuments.client);
    expect((await db.doc('debts/personal-debt').get()).data()).toEqual(personalDocuments.debt);
    expect((await db.doc('transfers/personal-transfer').get()).data())
      .toEqual(personalDocuments.transfer);
  });

  test('joins with personal settings and leaves them byte-for-byte intact', async () => {
    const settings = { catalog: [{ name: 'Bidon', price: 120 }], nested: { keep: true } };
    await db.doc('settings/new-user').set(settings);

    await expect(joinGroupByCode({ db, uid: 'new-user', code: 'ABC234' }))
      .resolves.toBe('ok');
    expect((await db.doc('settings/new-user').get()).data()).toEqual(settings);
    expect((await db.doc('users/new-user').get()).data()).not.toHaveProperty('pendingGroupId');
    expect((await db.doc('users/new-user').get()).data()?.groupId).toBe('open-a');
  });

  test('releases the write fence when the personal-data scan throws', async () => {
    const scanError = new Error('temporary scan failure');
    await expect(joinGroupByCode({
      db,
      uid: 'new-user',
      code: 'ABC234',
      scanPersonalData: async () => { throw scanError; },
    })).rejects.toBe(scanError);

    const user = (await db.doc('users/new-user').get()).data();
    expect(user?.groupId).toBeNull();
    expect(user).not.toHaveProperty('pendingGroupId');
    expect(user).not.toHaveProperty('groupMigrationState');
  });

  test('ignores already-scoped documents and resumes the same preflight idempotently', async () => {
    await Promise.all([
      db.doc('clients/scoped-client').set({
        userId: 'new-user', groupId: 'route-open', name: 'Shared route client',
      }),
      db.doc('debts/scoped-debt').set({
        userId: 'new-user', groupId: 'open-b', amount: 10,
      }),
      db.doc('transfers/scoped-transfer').set({
        userId: 'new-user', groupId: 'open-b', amount: 4,
      }),
      db.doc('users/new-user').set({
        pendingGroupId: 'open-a',
        groupMigrationState: 'join_preflight',
      }, { merge: true }),
    ]);

    await expect(joinGroupByCode({ db, uid: 'new-user', code: 'ABC234' })).resolves.toBe('ok');
    expect((await db.doc('users/new-user').get()).data()).toEqual({
      email: 'new@example.com',
      displayName: 'New',
      groupId: 'open-a',
      role: 'member',
      profileIds: [],
    });
    expect((await db.doc('clients/scoped-client').get()).exists).toBe(true);
    expect((await db.doc('debts/scoped-debt').get()).exists).toBe(true);
    expect((await db.doc('transfers/scoped-transfer').get()).exists).toBe(true);
  });

  test('derives and repairs the canonical admin role without trusting user metadata', async () => {
    await expect(joinGroupByCode({ db, uid: 'admin-a', code: 'ABC234' })).resolves.toBe('ok');
    expect((await db.collection('users').doc('admin-a').get()).data()).toEqual({
      email: 'admin@example.com', groupId: 'open-a', role: 'admin',
    });

    await db.collection('users').doc('admin-a').update({ role: 'member' });
    await expect(joinGroupByCode({ db, uid: 'admin-a', code: 'ABC234' })).resolves.toBe('already');
    expect((await db.collection('users').doc('admin-a').get()).data()?.role).toBe('admin');
  });

  test('does not join closing/unknown groups or replace another membership', async () => {
    await expect(joinGroupByCode({ db, uid: 'new-user', code: 'GHJ789' })).resolves.toBe('not_found');
    await expect(joinGroupByCode({ db, uid: 'new-user', code: 'UVW234' })).resolves.toBe('not_found');
    await expect(joinGroupByCode({ db, uid: 'busy-user', code: 'ABC234' })).resolves.toBe('error');
    expect((await db.collection('users').doc('busy-user').get()).data()).toEqual({
      groupId: 'open-b', role: 'member',
    });
  });

  test('serializes two simultaneous group joins for the same account', async () => {
    const statuses = await Promise.all([
      joinGroupByCode({ db, uid: 'racer', code: 'ABC234' }),
      joinGroupByCode({ db, uid: 'racer', code: 'DEF567' }),
    ]);
    expect(statuses.filter((status) => status === 'ok')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'error')).toHaveLength(1);
    expect(['open-a', 'open-b']).toContain(
      (await db.collection('users').doc('racer').get()).data()?.groupId,
    );
  });

  test('never recreates memberships after account deletion has started', async () => {
    await expect(joinGroupByCode({ db, uid: 'deleting-user', code: 'ABC234' }))
      .resolves.toBe('error');
    await expect(joinProfileByCode({ db, uid: 'deleting-user', code: 'KLM234' }))
      .resolves.toBe('error');
    expect((await db.collection('users').doc('deleting-user').get()).data()).toEqual({
      groupId: null, role: null, accountState: 'deleting', profileIds: [],
    });
    expect((await db.collection('profiles').doc('route-open').get()).data()?.memberUids)
      .toEqual(['route-owner']);
  });

  test('does not race a resumable family-group creation', async () => {
    await expect(joinGroupByCode({ db, uid: 'pending-user', code: 'ABC234' }))
      .resolves.toBe('error');
    await expect(joinProfileByCode({ db, uid: 'pending-user', code: 'KLM234' }))
      .resolves.toBe('error');
    expect((await db.collection('users').doc('pending-user').get()).data()).toEqual({
      groupId: null,
      role: null,
      pendingGroupId: 'reserved-group',
      profileIds: [],
    });
  });

  test('serializes joins with the durable account deletion job', async () => {
    await expect(joinGroupByCode({ db, uid: 'deletion-job-user', code: 'ABC234' }))
      .resolves.toBe('error');
    await expect(joinProfileByCode({ db, uid: 'deletion-job-user', code: 'KLM234' }))
      .resolves.toBe('error');
    expect((await db.collection('users').doc('deletion-job-user').get()).data()).toEqual({
      groupId: null, role: null, accountState: 'active', profileIds: [],
    });
  });

  test('an idempotent profile join repairs a missing profileIds cache entry', async () => {
    await db.collection('profiles').doc('route-open').update({
      memberUids: ['route-owner', 'existing-profile-member'],
      'members.existing-profile-member': { role: 'member' },
    });
    await expect(joinProfileByCode({ db, uid: 'existing-profile-member', code: 'KLM234' }))
      .resolves.toBe('already');
    expect((await db.collection('users').doc('existing-profile-member').get()).data()?.profileIds)
      .toEqual(['route-open']);
  });

  test('joins active and legacy-active profiles with canonical account metadata', async () => {
    await expect(joinProfileByCode({ db, uid: 'profile-user', code: 'KLM234' })).resolves.toBe('ok');
    const profile = (await db.collection('profiles').doc('route-open').get()).data();
    expect(profile?.memberUids).toEqual(['route-owner', 'profile-user']);
    expect(profile?.members?.['profile-user']).toEqual({
      role: 'member', name: 'Profile User', email: 'profile@example.com',
    });
    expect((await db.collection('users').doc('profile-user').get()).data()?.profileIds)
      .toEqual(['route-open']);
    await expect(joinProfileByCode({ db, uid: 'profile-user', code: 'KLM234' }))
      .resolves.toBe('already');

    await expect(joinProfileByCode({ db, uid: 'legacy-member', code: 'NPQ567' }))
      .resolves.toBe('ok');
    expect((await db.doc('profileCodes/KLM234').get()).data()).toEqual(
      expect.objectContaining({ profileId: 'route-open', ownerId: 'route-owner' }),
    );
    expect((await db.doc('profiles/route-open').get()).data()?.codeReservationVersion)
      .toBe('profile_codes_v1');
  });

  test('uses an exact reservation and never falls back for a marked missing reservation', async () => {
    await db.doc('profileCodes/KLM234').set({
      profileId: 'route-open', ownerId: 'route-owner', state: 'active',
    });
    await db.doc('profiles/duplicate-code').set({
      code: 'KLM234', ownerId: 'other', memberUids: ['other'], lifecycleState: 'active',
    });
    await expect(joinProfileByCode({ db, uid: 'profile-user', code: 'KLM234' }))
      .resolves.toBe('ok');
    expect((await db.doc('profiles/duplicate-code').get()).data()?.memberUids).toEqual(['other']);

    await db.doc('profileCodes/KLM234').delete();
    await db.doc('profiles/route-open').update({ codeReservationVersion: 'profile_codes_v1' });
    await db.doc('profiles/duplicate-code').delete();
    await db.doc('users/profile-user').update({ profileIds: [] });
    await db.doc('profiles/route-open').update({
      memberUids: ['route-owner'],
      members: { 'route-owner': { role: 'admin' } },
    });
    await expect(joinProfileByCode({ db, uid: 'profile-user', code: 'KLM234' }))
      .resolves.toBe('not_found');
  });

  test('rejects a closing profile and makes concurrent retries idempotent', async () => {
    await expect(joinProfileByCode({ db, uid: 'profile-user', code: 'RST789' }))
      .resolves.toBe('not_found');

    await db.collection('users').doc('profile-racer').set({ profileIds: [] });
    const statuses = await Promise.all([
      joinProfileByCode({ db, uid: 'profile-racer', code: 'KLM234' }),
      joinProfileByCode({ db, uid: 'profile-racer', code: 'KLM234' }),
    ]);
    expect(statuses.sort()).toEqual(['already', 'ok']);
    const memberUids = (await db.collection('profiles').doc('route-open').get()).data()?.memberUids;
    expect(memberUids.filter((uid: string) => uid === 'profile-racer')).toHaveLength(1);
  });
});
