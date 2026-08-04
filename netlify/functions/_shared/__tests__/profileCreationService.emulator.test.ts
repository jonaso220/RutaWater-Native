import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import {
  createProfileForOwner,
  ensureOwnedProfileCodeReservation,
} from '../profileCreationService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('server-owned profile creation and code reservations', () => {
  let app: App;
  let db: Firestore;

  const clearCollection = async (name: string) => {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
  };

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `profile-create-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      'profiles',
      'profileCodes',
      'profileCreateRequests',
      'users',
      'accountDeletionJobs',
    ].map(clearCollection));
    await db.doc('users/owner').set({
      displayName: 'Owner',
      email: 'owner@example.com',
      accountState: 'active',
      profileIds: [],
    });
  });

  afterAll(async () => deleteApp(app));

  test('retries a reserved-code collision without overwriting either profile', async () => {
    await db.doc('profileCodes/ABC234').set({
      profileId: 'profile_existing', ownerId: 'other', state: 'active',
    });
    const ids = [
      'profile_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'profile_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ];
    const codes = ['ABC234', 'DEF567'];
    const result = await createProfileForOwner({
      db,
      uid: 'owner',
      name: 'Ruta Centro',
      requestId: 'request_abcdefghijklmnop',
      generateId: () => ids.shift()!,
      generateCode: () => codes.shift()!,
    });

    expect(result).toEqual({
      profileId: 'profile_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      code: 'DEF567',
      created: true,
    });
    expect((await db.doc('profileCodes/ABC234').get()).data()?.profileId)
      .toBe('profile_existing');
    expect((await db.doc('profileCodes/DEF567').get()).data()?.profileId)
      .toBe(result.profileId);
    expect((await db.doc(`profiles/${result.profileId}`).get()).data())
      .toEqual(expect.objectContaining({ ownerId: 'owner', code: 'DEF567' }));
  });

  test('concurrent and repeated request IDs create exactly one profile', async () => {
    const input = {
      db,
      uid: 'owner',
      name: 'Ruta Unica',
      requestId: 'request_same_abcdefghijkl',
    };
    const concurrent = await Promise.all([
      createProfileForOwner(input),
      createProfileForOwner(input),
    ]);
    expect(new Set(concurrent.map((result) => result.profileId)).size).toBe(1);
    expect(concurrent.map((result) => result.created).sort()).toEqual([false, true]);

    const retry = await createProfileForOwner(input);
    expect(retry.profileId).toBe(concurrent[0].profileId);
    expect(retry.created).toBe(false);
    expect((await db.collection('profiles').get()).size).toBe(1);
    expect((await db.collection('profileCodes').get()).size).toBe(1);
    expect((await db.collection('profileCreateRequests').get()).size).toBe(1);
  });

  test('legacy collision rotation preserves the original profile data', async () => {
    await Promise.all([
      db.doc('profiles/legacy').set({
        ownerId: 'owner',
        name: 'Legacy',
        code: 'KLM234',
        createdAt: 'original-created-at',
        nested: { keep: true },
      }),
      db.doc('profileCodes/KLM234').set({
        profileId: 'other-profile', ownerId: 'other', state: 'active',
      }),
    ]);

    await expect(ensureOwnedProfileCodeReservation({
      db,
      uid: 'owner',
      profileId: 'legacy',
      generateCode: () => 'NPQ567',
    })).resolves.toBe('NPQ567');
    expect((await db.doc('profiles/legacy').get()).data()).toEqual(expect.objectContaining({
      code: 'NPQ567',
      createdAt: 'original-created-at',
      nested: { keep: true },
    }));
    expect((await db.doc('profileCodes/NPQ567').get()).data()?.profileId).toBe('legacy');
  });

  test('repairs only the metadata of a reservation already owned by the profile', async () => {
    await Promise.all([
      db.doc('profiles/legacy').set({
        ownerId: 'owner',
        name: 'Legacy',
        code: 'RST234',
        nested: { keep: true },
      }),
      db.doc('profileCodes/RST234').set({
        profileId: 'legacy',
        ownerId: 'stale-owner',
        state: 'stale',
        customAuditField: 'preserved',
      }),
    ]);

    await expect(ensureOwnedProfileCodeReservation({
      db,
      uid: 'owner',
      profileId: 'legacy',
      generateCode: () => 'UVW567',
    })).resolves.toBe('RST234');
    expect((await db.doc('profiles/legacy').get()).data()).toEqual(expect.objectContaining({
      code: 'RST234',
      nested: { keep: true },
    }));
    expect((await db.doc('profileCodes/RST234').get()).data()).toEqual(expect.objectContaining({
      profileId: 'legacy',
      ownerId: 'owner',
      state: 'active',
      customAuditField: 'preserved',
    }));
  });
});
