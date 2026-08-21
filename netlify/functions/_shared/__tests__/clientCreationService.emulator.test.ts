import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import {
  ClientCreationError,
  createClientDocuments,
} from '../clientCreationService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const item = (id: string, groupId?: string) => ({
  id,
  data: {
    name: `Cliente ${id}`,
    freq: 'on_demand',
    visitDay: 'Sin Asignar',
    visitDays: [],
    isNote: false,
    ...(groupId ? { groupId } : {}),
  },
});

describeWithEmulator('transactional client creation quota', () => {
  let app: App;
  let db: Firestore;

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `client-create-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      'clients',
      'users',
      'groups',
      'profiles',
      'accountDeletionJobs',
    ].map(clearCollection));
    await db.doc('users/owner').set({ accountState: 'active' });
  });

  afterAll(async () => deleteApp(app));

  test('serializes simultaneous writes so a Free account never reaches 61', async () => {
    const batch = db.batch();
    for (let index = 0; index < 59; index += 1) {
      batch.set(db.doc(`clients/existing-${index}`), {
        userId: 'owner', name: `Existing ${index}`, isNote: false,
      });
    }
    await batch.commit();

    const results = await Promise.allSettled([
      createClientDocuments({ db, uid: 'owner', plan: 'free', items: [item('new-a')] }),
      createClientDocuments({ db, uid: 'owner', plan: 'free', items: [item('new-b')] }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ClientCreationError);
    expect(rejected.reason.code).toBe('CLIENT_LIMIT_REACHED');
    const clients = await db.collection('clients').where('userId', '==', 'owner').get();
    expect(clients.docs.filter((doc) => doc.data().isNote !== true)).toHaveLength(60);
  });

  test('counts documents globally across owned profile scopes but ignores notes', async () => {
    await Promise.all([
      db.doc('profiles/profile_a').set({
        ownerId: 'owner', memberUids: ['owner'], lifecycleState: 'active',
      }),
      db.doc('profiles/profile_b').set({
        ownerId: 'owner', memberUids: ['owner'], lifecycleState: 'active',
      }),
      db.doc('clients/note').set({ userId: 'owner', isNote: true }),
    ]);
    const batch = db.batch();
    for (let index = 0; index < 60; index += 1) {
      const groupId = index % 2 === 0 ? 'profile_a' : 'profile_b';
      batch.set(db.doc(`clients/profile-client-${index}`), {
        userId: 'owner', groupId, isNote: false, name: `Existing ${index}`,
      });
    }
    await batch.commit();

    await expect(createClientDocuments({
      db,
      uid: 'owner',
      plan: 'free',
      items: [item('client-61', 'profile_a')],
    })).rejects.toMatchObject({ code: 'CLIENT_LIMIT_REACHED' });
  });

  test('allows Premium bulk restore and keeps retries idempotent', async () => {
    const items = [item('restore-a'), item('restore id.with spaces')];
    const first = await createClientDocuments({ db, uid: 'owner', plan: 'annual', items });
    const retry = await createClientDocuments({ db, uid: 'owner', plan: 'annual', items });

    expect(first).toMatchObject({ ids: ['restore-a', 'restore id.with spaces'], created: 2, limit: null });
    expect(retry).toMatchObject({ ids: ['restore-a', 'restore id.with spaces'], created: 0, limit: null });
    expect((await db.collection('clients').get()).size).toBe(2);
  });
});
