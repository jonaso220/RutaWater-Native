import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { redeemPromo } from '../promoService';

const projectId = 'demo-rutawater';
const digest = (character: string) => character.repeat(64);
const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('promo service against Firestore emulator', () => {
  let app: App;
  let db: Firestore;

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  const clientSnapshot = async () => {
    const snapshot = await db.collection('clients').orderBy('__name__').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  };

  beforeAll(() => {
    app = initializeApp({ projectId }, `promo-service-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      clearCollection('premiumOverrides'),
      clearCollection('promoCodes'),
      clearCollection('clients'),
      clearCollection('users'),
      clearCollection('accountDeletionJobs'),
    ]);
    await Promise.all([
      db.collection('clients').doc('personal').set({ userId: 'u1', name: 'Personal' }),
      db.collection('clients').doc('group').set({ groupId: 'g1', userId: 'owner', name: 'Grupo' }),
      db.collection('clients').doc('profile').set({ groupId: 'p1', userId: 'owner', name: 'Reparto' }),
    ]);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  test('preserves an active legacy override exactly and consumes no code', async () => {
    const legacy = {
      active: true,
      code: 'legacy-retired-code',
      type: 'lifetime',
      redeemedAt: new Date('2025-01-01T00:00:00Z'),
      userId: 'legacy-user',
    };
    await db.collection('premiumOverrides').doc('legacy-user').set(legacy);
    const premiumBefore = (await db.collection('premiumOverrides').doc('legacy-user').get()).data();
    const clientsBefore = await clientSnapshot();

    const status = await redeemPromo({
      db,
      uid: 'legacy-user',
      promoDigest: digest('a'),
    });

    expect(status).toBe('already_active');
    expect((await db.collection('premiumOverrides').doc('legacy-user').get()).data()).toEqual(premiumBefore);
    expect((await db.collection('promoCodes').doc(digest('a')).get()).exists).toBe(false);
    expect(await clientSnapshot()).toEqual(clientsBefore);
  });

  test('redeems a valid code once without changing any client', async () => {
    const promoId = digest('b');
    await db.collection('promoCodes').doc(promoId).set({
      active: true,
      type: 'lifetime',
      maxUses: 1,
      usedCount: 0,
    });
    const clientsBefore = await clientSnapshot();

    expect(await redeemPromo({ db, uid: 'new-user', promoDigest: promoId })).toBe('redeemed');
    expect((await db.collection('premiumOverrides').doc('new-user').get()).data()).toEqual(
      expect.objectContaining({ active: true, type: 'lifetime', userId: 'new-user', promoId }),
    );
    expect((await db.collection('promoCodes').doc(promoId).get()).data()?.usedCount).toBe(1);
    expect((await db.collection('promoCodes').doc(promoId).collection('redemptions').doc('new-user').get()).exists).toBe(true);
    expect(await clientSnapshot()).toEqual(clientsBefore);
  });

  test('keeps retries idempotent', async () => {
    const promoId = digest('c');
    await db.collection('promoCodes').doc(promoId).set({
      active: true,
      type: 'lifetime',
      maxUses: 1,
      usedCount: 0,
    });

    expect(await redeemPromo({ db, uid: 'same-user', promoDigest: promoId })).toBe('redeemed');
    const premiumBefore = (await db.collection('premiumOverrides').doc('same-user').get()).data();
    expect(await redeemPromo({ db, uid: 'same-user', promoDigest: promoId })).toBe('already_active');
    expect((await db.collection('promoCodes').doc(promoId).get()).data()?.usedCount).toBe(1);
    expect((await db.collection('premiumOverrides').doc('same-user').get()).data()).toEqual(premiumBefore);
  });

  test('allows only one winner when two users race for a one-use code', async () => {
    const promoId = digest('d');
    await db.collection('promoCodes').doc(promoId).set({
      active: true,
      type: 'lifetime',
      maxUses: 1,
      usedCount: 0,
    });
    const clientsBefore = await clientSnapshot();

    const statuses = await Promise.all([
      redeemPromo({ db, uid: 'racer-one', promoDigest: promoId }),
      redeemPromo({ db, uid: 'racer-two', promoDigest: promoId }),
    ]);
    expect(statuses.sort()).toEqual(['invalid', 'redeemed']);
    expect((await db.collection('promoCodes').doc(promoId).get()).data()?.usedCount).toBe(1);
    const overrides = await db.collection('premiumOverrides').get();
    expect(overrides.docs.filter((doc) => doc.data().active === true)).toHaveLength(1);
    expect(await clientSnapshot()).toEqual(clientsBefore);
  });

  test('invalid, expired, and exhausted codes do not grant Premium', async () => {
    const now = Date.parse('2026-08-04T12:00:00Z');
    const cases = [
      { id: digest('e'), data: { active: false, type: 'lifetime', maxUses: 1, usedCount: 0 } },
      { id: digest('f'), data: { active: true, type: 'lifetime', maxUses: 1, usedCount: 0, expiresAt: new Date(now - 1) } },
      { id: digest('0'), data: { active: true, type: 'lifetime', maxUses: 1, usedCount: 1 } },
    ];
    await Promise.all(cases.map(({ id, data }) => db.collection('promoCodes').doc(id).set(data)));
    const clientsBefore = await clientSnapshot();

    for (const [index, item] of cases.entries()) {
      expect(await redeemPromo({ db, uid: `invalid-${index}`, promoDigest: item.id, nowMillis: now })).toBe('invalid');
    }
    expect((await db.collection('premiumOverrides').get()).empty).toBe(true);
    expect(await clientSnapshot()).toEqual(clientsBefore);
  });

  test('does not consume a code or recreate Premium for a deleting/deleted account', async () => {
    const promoId = digest('1');
    await Promise.all([
      db.collection('promoCodes').doc(promoId).set({
        active: true,
        type: 'lifetime',
        maxUses: 5,
        usedCount: 0,
      }),
      db.collection('users').doc('deleted-user').set({ accountState: 'deleted' }),
      db.collection('accountDeletionJobs').doc('deleting-user').set({ state: 'planning' }),
    ]);

    await expect(redeemPromo({ db, uid: 'deleted-user', promoDigest: promoId }))
      .resolves.toBe('invalid');
    await expect(redeemPromo({ db, uid: 'deleting-user', promoDigest: promoId }))
      .resolves.toBe('invalid');
    expect((await db.collection('promoCodes').doc(promoId).get()).data()?.usedCount).toBe(0);
    expect((await db.collection('premiumOverrides').get()).empty).toBe(true);
  });
});
