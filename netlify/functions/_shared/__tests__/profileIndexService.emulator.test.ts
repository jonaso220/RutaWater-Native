import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { syncProfileIds } from '../profileIndexService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('legacy profile index recovery against Firestore emulator', () => {
  let app: App;
  let db: Firestore;

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `profile-index-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all(['profiles', 'profileCodes', 'users', 'accountDeletionJobs'].map(clearCollection));
    await Promise.all([
      db.collection('users').doc('legacy').set({
        email: 'legacy@example.com', displayName: 'Legacy', groupId: 'family', role: 'member',
      }),
      db.collection('profiles').doc('active-route').set({
        ownerId: 'owner', memberUids: ['owner', 'legacy'], lifecycleState: 'active',
      }),
      db.collection('profiles').doc('legacy-route').set({
        ownerId: 'legacy', memberUids: ['legacy'],
      }),
      db.collection('profiles').doc('owner-legacy-no-membership').set({
        ownerId: 'legacy', name: 'Very old owner route',
      }),
      db.collection('profiles').doc('deleting-route').set({
        ownerId: 'legacy', memberUids: ['legacy'], lifecycleState: 'deleting',
      }),
      db.collection('profiles').doc('foreign-route').set({
        ownerId: 'other', memberUids: ['other'], lifecycleState: 'active',
      }),
    ]);
  });

  afterAll(async () => deleteApp(app));

  test('backfills only active canonical memberships and preserves account data', async () => {
    await expect(syncProfileIds(db, 'legacy')).resolves.toEqual([
      'active-route', 'legacy-route', 'owner-legacy-no-membership',
    ]);
    expect((await db.collection('users').doc('legacy').get()).data()).toEqual({
      email: 'legacy@example.com',
      displayName: 'Legacy',
      groupId: 'family',
      role: 'member',
      profileIds: ['active-route', 'legacy-route', 'owner-legacy-no-membership'],
      profileIndexVersion: 1,
    });
    expect((await db.collection('profiles').doc('owner-legacy-no-membership').get()).data())
      .toEqual(expect.objectContaining({
        memberUids: ['legacy'],
        members: {
          legacy: { role: 'admin', name: 'Legacy', email: 'legacy@example.com' },
        },
      }));
  });

  test('cleans stale cache entries idempotently without touching profile documents', async () => {
    await db.collection('users').doc('legacy').set({
      profileIds: ['foreign-route', 'missing-route'],
    }, { merge: true });
    await syncProfileIds(db, 'legacy');
    const profilesBefore = (await db.collection('profiles').orderBy('__name__').get())
      .docs.map((doc) => ({ id: doc.id, data: doc.data() }));

    const expected = ['active-route', 'legacy-route', 'owner-legacy-no-membership'];
    expect(await syncProfileIds(db, 'legacy')).toEqual(expected);
    expect(await syncProfileIds(db, 'legacy')).toEqual(expected);
    expect((await db.collection('users').doc('legacy').get()).data()).toEqual(
      expect.objectContaining({ profileIds: expected, profileIndexVersion: 1 }),
    );
    const profilesAfter = (await db.collection('profiles').orderBy('__name__').get())
      .docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    expect(profilesAfter).toEqual(profilesBefore);
  });

  test('does not recreate the cache after account cleanup has been planned', async () => {
    await db.collection('users').doc('legacy').update({ accountState: 'deleting' });
    await expect(syncProfileIds(db, 'legacy')).rejects.toThrow('ACCOUNT_DELETION_IN_PROGRESS');
    expect((await db.collection('users').doc('legacy').get()).data()?.profileIds).toBeUndefined();

    await db.collection('users').doc('legacy').update({ accountState: 'active' });
    await db.collection('accountDeletionJobs').doc('legacy').set({ state: 'planned' });
    await expect(syncProfileIds(db, 'legacy')).rejects.toThrow('ACCOUNT_DELETION_IN_PROGRESS');
    expect((await db.collection('users').doc('legacy').get()).data()?.profileIds).toBeUndefined();
  });
});
