import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

const { reserveAiUsage } = require('../aiQuota');

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('AI quota service against Firestore emulator', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `ai-quota-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    const usage = await db.collection('aiUsage').get();
    const clients = await db.collection('clients').get();
    const users = await db.collection('users').get();
    const deletionJobs = await db.collection('accountDeletionJobs').get();
    await Promise.all([
      ...usage.docs.map((doc) => db.recursiveDelete(doc.ref)),
      ...clients.docs.map((doc) => db.recursiveDelete(doc.ref)),
      ...users.docs.map((doc) => db.recursiveDelete(doc.ref)),
      ...deletionJobs.docs.map((doc) => db.recursiveDelete(doc.ref)),
    ]);
    await db.collection('clients').doc('untouched').set({ userId: 'u1', name: 'Ana' });
  });

  afterAll(async () => deleteApp(app));

  test('allows exactly ten concurrent free reservations and changes no client', async () => {
    const clientsBefore = (await db.collection('clients').get()).docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));
    const now = new Date('2026-08-04T12:00:00Z');
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveAiUsage({
      db,
      uid: 'racer',
      plan: 'free',
      now,
    })));

    expect(results.filter((item: { allowed: boolean }) => item.allowed)).toHaveLength(10);
    expect((await db.collection('aiUsage').doc('racer').get()).data()).toEqual(
      expect.objectContaining({ count: 10, limit: 10, period: '2026-08', plan: 'free' }),
    );
    const clientsAfter = (await db.collection('clients').get()).docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));
    expect(clientsAfter).toEqual(clientsBefore);
  }, 20_000);

  test('preserves the current month count and resets only on a server month change', async () => {
    await db.collection('aiUsage').doc('monthly-user').set({ count: 299, period: '2026-08' });
    await expect(reserveAiUsage({
      db,
      uid: 'monthly-user',
      plan: 'monthly',
      now: new Date('2026-08-31T23:59:00Z'),
    })).resolves.toEqual(expect.objectContaining({ allowed: true, count: 300 }));
    await expect(reserveAiUsage({
      db,
      uid: 'monthly-user',
      plan: 'monthly',
      now: new Date('2026-09-01T00:00:00Z'),
    })).resolves.toEqual(expect.objectContaining({ allowed: true, count: 1, period: '2026-09' }));
  });

  test('a deletion marker or tombstone cannot recreate AI usage', async () => {
    await db.collection('users').doc('deleting-user').set({ accountState: 'deleting' });
    await db.collection('accountDeletionJobs').doc('job-user').set({ state: 'planning' });

    await expect(reserveAiUsage({
      db,
      uid: 'deleting-user',
      plan: 'free',
    })).rejects.toMatchObject({ name: 'AiAccountInactiveError' });
    await expect(reserveAiUsage({
      db,
      uid: 'job-user',
      plan: 'free',
    })).rejects.toMatchObject({ name: 'AiAccountInactiveError' });
    expect((await db.collection('aiUsage').doc('deleting-user').get()).exists).toBe(false);
    expect((await db.collection('aiUsage').doc('job-user').get()).exists).toBe(false);
  });
});
