import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  backfillDataScopePage,
  backfillEntireDataScopeCollection,
} from '../dataScopeBackfillService';
import {
  activateStrictScopeReadsForUser,
  advanceDataScopeMigration,
  advanceStrictScopeActivation,
  finalizeStrictScopeActivation,
  getDataScopeMigrationStatus,
  restartStrictScopeActivation,
  sealDataScopeWrites,
} from '../dataScopeMigrationService';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('data scope backfill against Firestore emulator', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-rutawater' }, `scope-backfill-${Date.now()}`);
    db = getFirestore(app);
  });

  beforeEach(async () => {
    await Promise.all([
      'clients',
      'debts',
      'transfers',
      'users',
      'groups',
      'profiles',
      'systemMigrations',
      'appConfig',
    ].map(async (collection) => {
      const snapshot = await db.collection(collection).get();
      await Promise.all(snapshot.docs.map((document) => db.recursiveDelete(document.ref)));
    }));
  });

  afterAll(async () => deleteApp(app));

  test('adds only canonical scopeKey and is idempotent across pages', async () => {
    await Promise.all([
      db.doc('clients/a-personal').set({
        userId: 'owner', name: 'Ana', nested: { untouched: true },
      }),
      db.doc('clients/b-shared').set({
        userId: 'former-member', groupId: 'route', name: 'Beto', amount: 42,
      }),
      db.doc('clients/c-stale').set({
        userId: 'creator', groupId: 'route', scopeKey: 'user:creator', name: 'Caro',
      }),
      db.doc('clients/d-ready').set({
        userId: 'owner', scopeKey: 'user:owner', name: 'Dani',
      }),
      db.doc('clients/e-malformed').set({ groupId: 'route', name: 'No attribution' }),
    ]);

    let cursor: string | undefined;
    do {
      const result = await backfillDataScopePage(db, {
        collection: 'clients', cursor, pageSize: 2, write: true,
      });
      expect(result.updated).toBeLessThanOrEqual(2);
      cursor = result.nextCursor || undefined;
    } while (cursor);

    expect((await db.doc('clients/a-personal').get()).data()).toEqual({
      userId: 'owner',
      name: 'Ana',
      nested: { untouched: true },
      scopeKey: 'user:owner',
    });
    expect((await db.doc('clients/b-shared').get()).data()).toEqual({
      userId: 'former-member',
      groupId: 'route',
      name: 'Beto',
      amount: 42,
      scopeKey: 'scope:route',
    });
    expect((await db.doc('clients/c-stale').get()).data()?.scopeKey).toBe('scope:route');
    expect((await db.doc('clients/d-ready').get()).data()?.scopeKey).toBe('user:owner');
    expect((await db.doc('clients/e-malformed').get()).data()?.scopeKey).toBeUndefined();
    await expect(backfillEntireDataScopeCollection(db, 'clients', true)).resolves.toEqual({
      collection: 'clients',
      scanned: 5,
      needsUpdate: 0,
      updated: 0,
      skippedMalformed: 1,
      orphanedScopes: 0,
    });
  });

  test('dry-run reports work but does not mutate any record', async () => {
    await db.doc('debts/debt-1').set({
      userId: 'member', groupId: 'route', amount: 100,
    });
    const before = (await db.doc('debts/debt-1').get()).data();

    await expect(backfillEntireDataScopeCollection(db, 'debts')).resolves.toEqual({
      collection: 'debts',
      scanned: 1,
      needsUpdate: 1,
      updated: 0,
      skippedMalformed: 0,
      orphanedScopes: 1,
    });
    expect((await db.doc('debts/debt-1').get()).data()).toEqual(before);
  });

  test('normalizes only an unambiguous blank groupId and leaves customer fields untouched', async () => {
    await db.doc('clients/blank-group').set({
      userId: 'owner',
      groupId: '   ',
      scopeKey: 'scope:stale',
      name: 'Keep me',
      nested: { untouched: true },
    });

    await expect(backfillDataScopePage(db, {
      collection: 'clients', write: true,
    })).resolves.toEqual(expect.objectContaining({ updated: 1, skippedMalformed: 0 }));
    expect((await db.doc('clients/blank-group').get()).data()).toEqual({
      userId: 'owner',
      scopeKey: 'user:owner',
      name: 'Keep me',
      nested: { untouched: true },
    });
    await expect(backfillEntireDataScopeCollection(db, 'clients')).resolves.toEqual(
      expect.objectContaining({ needsUpdate: 0, skippedMalformed: 0, orphanedScopes: 0 }),
    );
  });

  test('counts missing/colliding/unowned shared descriptors but accepts preserved profiles', async () => {
    await Promise.all([
      db.doc('clients/missing').set({
        userId: 'creator', groupId: 'missing-scope', scopeKey: 'scope:missing-scope',
      }),
      db.doc('clients/no-member').set({
        userId: 'creator', groupId: 'group-no-member', scopeKey: 'scope:group-no-member',
      }),
      db.doc('clients/family-valid').set({
        userId: 'creator', groupId: 'family-valid', scopeKey: 'scope:family-valid',
      }),
      db.doc('clients/profile-valid').set({
        userId: 'creator', groupId: 'profile-valid', scopeKey: 'scope:profile-valid',
      }),
      db.doc('groups/group-no-member').set({ adminId: 'gone' }),
      db.doc('groups/family-valid').set({ adminId: 'member' }),
      db.doc('users/member').set({ groupId: 'family-valid', accountState: 'active' }),
      db.doc('profiles/profile-valid').set({
        lifecycleState: 'archived', ownerId: 'profile-owner', memberUids: ['profile-owner'],
      }),
    ]);

    await expect(backfillEntireDataScopeCollection(db, 'clients')).resolves.toEqual(
      expect.objectContaining({
        needsUpdate: 0,
        skippedMalformed: 0,
        orphanedScopes: 2,
      }),
    );

    for (let step = 0; step < 12; step += 1) {
      const status = await advanceDataScopeMigration(db);
      if (status.phase === 'blocked') break;
    }
    expect(await getDataScopeMigrationStatus(db)).toEqual(expect.objectContaining({
      phase: 'blocked', orphanedScopes: 2, writeVersion: 0,
    }));
  });

  test('durably backfills, seals writes, re-audits, then activates one user', async () => {
    await Promise.all([
      db.doc('users/owner').set({ accountState: 'active', displayName: 'Owner' }),
      db.doc('profiles/route').set({
        ownerId: 'member', memberUids: ['member'], lifecycleState: 'archived',
      }),
      db.doc('clients/client-1').set({ userId: 'owner', name: 'Ana' }),
      db.doc('debts/debt-1').set({
        userId: 'member', groupId: 'route', clientId: 'client-1', amount: 20,
      }),
      db.doc('transfers/transfer-1').set({
        userId: 'member', groupId: 'route', clientId: 'client-1',
      }),
    ]);

    for (let step = 0; step < 12; step += 1) {
      const status = await advanceDataScopeMigration(db);
      if (status.phase === 'ready_to_seal') break;
    }
    expect(await getDataScopeMigrationStatus(db)).toEqual(expect.objectContaining({
      phase: 'ready_to_seal',
      auditNeedsUpdate: 0,
      auditMalformed: 0,
      writeVersion: 0,
    }));
    await expect(activateStrictScopeReadsForUser(db, 'owner')).rejects.toMatchObject({
      code: 'MIGRATION_NOT_VERIFIED',
    });
    await expect(sealDataScopeWrites(db, {
      serverProofVerified: false,
      minimumAppBuild: '1.48',
    })).rejects.toMatchObject({ code: 'MINIMUM_VERSION_REQUIRED' });

    await sealDataScopeWrites(db, {
      serverProofVerified: true,
      minimumAppBuild: '1.48',
    });
    for (let step = 0; step < 6; step += 1) {
      const status = await advanceDataScopeMigration(db);
      if (status.phase === 'verified') break;
    }
    expect(await getDataScopeMigrationStatus(db)).toEqual(expect.objectContaining({
      phase: 'verified',
      writeVersion: 1,
      minimumAppBuild: '1.48',
    }));

    await expect(activateStrictScopeReadsForUser(db, 'owner')).resolves.toEqual({
      uid: 'owner', scopeReadVersion: 1,
    });
    expect((await db.doc('users/owner').get()).data()).toEqual(expect.objectContaining({
      displayName: 'Owner',
      scopeReadVersion: 1,
    }));
    expect((await db.doc('clients/client-1').get()).data()?.scopeKey).toBe('user:owner');
    expect((await db.doc('debts/debt-1').get()).data()?.scopeKey).toBe('scope:route');
    expect((await db.doc('transfers/transfer-1').get()).data()?.scopeKey).toBe('scope:route');
  });

  test('malformed attribution blocks sealing and never activates reads', async () => {
    await Promise.all([
      db.doc('users/owner').set({ accountState: 'active' }),
      db.doc('clients/malformed').set({ groupId: 'route', name: 'Missing userId' }),
    ]);
    for (let step = 0; step < 12; step += 1) {
      const status = await advanceDataScopeMigration(db);
      if (status.phase === 'blocked') break;
    }
    expect(await getDataScopeMigrationStatus(db)).toEqual(expect.objectContaining({
      phase: 'blocked', auditMalformed: 1, writeVersion: 0,
    }));
    await expect(sealDataScopeWrites(db, {
      serverProofVerified: true,
      minimumAppBuild: '1.48',
    })).rejects.toMatchObject({ code: 'MIGRATION_NOT_READY' });
    await expect(activateStrictScopeReadsForUser(db, 'owner')).rejects.toMatchObject({
      code: 'MIGRATION_NOT_VERIFIED',
    });
    expect((await db.doc('users/owner').get()).data()?.scopeReadVersion).toBeUndefined();
  });

  test('activation checkpoints an exact-size page and publishes the future-account global gate', async () => {
    await Promise.all([
      db.doc('systemMigrations/dataScopeV1').set({
        phase: 'verified',
        collectionIndex: 0,
        cursor: null,
        auditNeedsUpdate: 0,
        auditMalformed: 0,
        orphanedScopes: 0,
        writeVersion: 1,
        readVersion: 0,
        minimumAppBuild: '1.48',
      }),
      db.doc('users/a-user').set({ accountState: 'active' }),
      db.doc('users/b-user').set({ accountState: 'active' }),
    ]);

    const first = await advanceStrictScopeActivation(db, { pageSize: 2 });
    expect(first.activation).toEqual(expect.objectContaining({
      cursor: 'b-user', scanned: 2, activated: 2, complete: false,
    }));
    const boundaryPage = await advanceStrictScopeActivation(db, { pageSize: 2 });
    expect(boundaryPage.activation).toEqual(expect.objectContaining({
      cursor: null, scanned: 2, activated: 2, complete: true,
    }));

    const finalized = await finalizeStrictScopeActivation(db, { serverProofVerified: true });
    expect(finalized.readVersion).toBe(1);
    expect((await db.doc('appConfig/dataScope').get()).data()).toEqual(
      expect.objectContaining({ readVersion: 1, minimumAppBuild: '1.48' }),
    );

    // A future account has no writable per-user marker, but rules/app use the
    // global server-owned readVersion and therefore default it to v1.
    await db.doc('users/z-future').set({ accountState: 'active' });
    expect((await db.doc('users/z-future').get()).data()?.scopeReadVersion).toBeUndefined();
    expect((await db.doc('systemMigrations/dataScopeV1').get()).data()?.readVersion).toBe(1);
  });

  test('activation skips deleted users, blocks pending users and can restart idempotently', async () => {
    await Promise.all([
      db.doc('systemMigrations/dataScopeV1').set({
        phase: 'verified',
        auditNeedsUpdate: 0,
        auditMalformed: 0,
        orphanedScopes: 0,
        writeVersion: 1,
        minimumAppBuild: '1.48',
      }),
      db.doc('users/deleted').set({ accountState: 'deleted' }),
      db.doc('users/pending').set({
        accountState: 'active', pendingGroupId: 'group', groupMigrationState: 'join_preflight',
      }),
    ]);
    const blocked = await advanceStrictScopeActivation(db, { pageSize: 10 });
    expect(blocked.activation).toEqual(expect.objectContaining({
      skippedInactive: 1, blocked: 1, activated: 0, complete: true,
    }));
    await expect(finalizeStrictScopeActivation(db, { serverProofVerified: true }))
      .rejects.toMatchObject({ code: 'ACTIVATION_NOT_READY' });
    expect((await db.doc('users/deleted').get()).data()?.scopeReadVersion).toBeUndefined();

    await db.doc('users/pending').update({
      pendingGroupId: FieldValue.delete(),
      groupMigrationState: FieldValue.delete(),
    });
    await restartStrictScopeActivation(db);
    const clean = await advanceStrictScopeActivation(db, { pageSize: 10 });
    expect(clean.activation).toEqual(expect.objectContaining({
      skippedInactive: 1, blocked: 0, activated: 1, complete: true,
    }));
    await expect(finalizeStrictScopeActivation(db, { serverProofVerified: true }))
      .resolves.toEqual(expect.objectContaining({ readVersion: 1 }));
  });

  test('a live lease rejects overlap while an expired lease resumes safely', async () => {
    await db.doc('systemMigrations/dataScopeV1').set({
      phase: 'audit',
      collectionIndex: 0,
      cursor: null,
      writeVersion: 0,
      leaseToken: 'other-worker',
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    await expect(advanceDataScopeMigration(db)).rejects.toMatchObject({ code: 'MIGRATION_BUSY' });

    await db.doc('systemMigrations/dataScopeV1').update({
      leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1),
    });
    await expect(advanceDataScopeMigration(db)).resolves.toEqual(
      expect.objectContaining({ phase: 'audit' }),
    );
  });
});
