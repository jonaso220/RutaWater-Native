import fs from 'fs';
import path from 'path';
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import 'firebase/compat/firestore';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;

describeWithEmulator('account and group lifecycle Firestore rules', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, rawPort] = (emulator || '127.0.0.1:8080').split(':');
    testEnvironment = await initializeTestEnvironment({
      projectId: 'demo-rutawater',
      firestore: {
        host,
        port: Number(rawPort),
        rules: fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const writes = [
        db.doc('users/owner').set({
          email: 'owner@example.com',
          displayName: 'Owner',
          groupId: 'family',
          role: 'admin',
          profileIds: [],
        }),
        db.doc('users/member').set({
          email: 'member@example.com',
          displayName: 'Member',
          groupId: 'family',
          role: 'member',
          profileIds: [],
        }),
        db.doc('users/outsider').set({
          groupId: null,
          role: null,
          // A user-controlled cache must never grant canonical profile access.
          profileIds: ['family', 'route'],
        }),
        db.doc('users/joiner').set({ groupId: null, role: null }),
        db.doc('users/active-joiner').set({ groupId: null, role: null }),
        db.doc('users/group-creator').set({ groupId: null, role: null, displayName: 'Creator' }),
        db.doc('users/profile-owner').set({ groupId: null, role: null, profileIds: ['route'] }),
        db.doc('users/profile-member').set({ groupId: null, role: null, profileIds: ['route'] }),
        db.doc('groups/family').set({
          adminId: 'owner',
          adminEmail: 'owner@example.com',
          adminName: 'Owner',
          code: 'FAMILY',
          lifecycleState: 'active',
          creationVersion: 'server_resumable_v1',
          createdAt: 'original-created-at',
        }),
        db.doc('groupCodes/FAMILY').set({
          groupId: 'family',
          ownerId: 'owner',
        }),
        db.doc('groups/dissolving').set({
          adminId: 'someone-else',
          code: 'CLOSING',
          lifecycleState: 'dissolving',
          dissolveRequestedBy: 'someone-else',
        }),
        db.doc('groups/active-group').set({
          adminId: 'someone-else',
          code: 'OPEN',
          lifecycleState: 'active',
        }),
        db.doc('groups/foreign-live-group').set({
          adminId: 'someone-else',
          code: 'FOREIGN',
          lifecycleState: 'active',
        }),
        db.doc('profiles/route').set({
          name: 'Shared route',
          ownerId: 'profile-owner',
          memberUids: ['profile-owner', 'profile-member'],
          members: {
            'profile-owner': { role: 'admin' },
            'profile-member': { role: 'member' },
          },
        }),
        db.doc('settings/route').set({ catalog: ['one'] }),
        db.doc('settings/family').set({
          catalog: ['group-product'],
          groupOnly: 'preserved',
          shared: 'group-wins',
        }),
        db.doc('settings/owner').set({
          personalOnly: 'preserved',
          shared: 'personal-old',
        }),
        db.doc('clients/family-client').set({
          groupId: 'family',
          userId: 'member',
          name: 'Untouched client',
          nested: { value: 1 },
        }),
        db.doc('debts/family-debt').set({
          groupId: 'family',
          userId: 'member',
          clientId: 'family-client',
          amount: 125,
        }),
        db.doc('transfers/family-transfer').set({
          groupId: 'family',
          userId: 'member',
          clientId: 'family-client',
          amount: 80,
        }),
        db.doc('clients/route-client').set({
          groupId: 'route',
          userId: 'profile-owner',
          name: 'Profile client',
        }),
        db.doc('clients/legacy-attributed').set({
          groupId: 'foreign-live-group',
          userId: 'outsider',
          name: 'Legacy attribution',
        }),
        db.doc('clients/family-owner-client').set({
          groupId: 'family',
          userId: 'owner',
          name: 'Owner-created client',
        }),
        db.doc('debts/route-debt').set({
          groupId: 'route',
          userId: 'profile-owner',
          clientId: 'route-client',
          amount: 45,
        }),
        db.doc('transfers/route-transfer').set({
          groupId: 'route',
          userId: 'profile-owner',
          clientId: 'route-client',
          amount: 20,
        }),
        db.doc('aiUsage/owner').set({ count: 3, date: '2026-08-04' }),
      ];
      await Promise.all(writes);
    });
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  test('aiUsage is readable only by its owner and never client-writable', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();

    await assertSucceeds(ownerDb.doc('aiUsage/owner').get());
    await assertFails(outsiderDb.doc('aiUsage/owner').get());
    await assertFails(ownerDb.doc('aiUsage/new-owner').set({ count: 0 }));
    await assertFails(ownerDb.doc('aiUsage/owner').update({ count: 0 }));
    await assertFails(ownerDb.doc('aiUsage/owner').delete());
  });

  test('a cached token cannot write after the account deletion tombstone is installed', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        adminDb.doc('premiumOverrides/owner').set({ active: true }),
        adminDb.doc('accountDeletionJobs/owner').set({
          state: 'planning',
          scopes: { profileIds: [] },
        }),
      ]);
    });

    for (const accountState of ['deleting', 'deleted']) {
      await testEnvironment.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc('users/owner').set(
          { accountState },
          { merge: true },
        );
      });
      await assertFails(ownerDb.doc(`clients/cached-${accountState}`).set({
        userId: 'owner',
        name: 'Must not be created',
      }));
      await assertFails(ownerDb.doc('clients/family-owner-client').update({ name: 'stale edit' }));
      await assertFails(ownerDb.doc('clients/family-owner-client').delete());
      await assertFails(ownerDb.doc(`daily_loads/owner_${accountState}`).set({ total: 1 }));
      await assertFails(ownerDb.doc('settings/owner').set({ stale: true }, { merge: true }));
      await assertFails(ownerDb.doc('premiumOverrides/owner').delete());
      await assertFails(ownerDb.doc('users/owner').update({ displayName: 'Stale writer' }));
      await assertFails(ownerDb.doc('users/owner').delete());
      await assertFails(ownerDb.doc(`profiles/cached-${accountState}`).set({
        ownerId: 'owner',
        memberUids: ['owner'],
        members: { owner: { role: 'admin' } },
      }));
      await assertFails(ownerDb.doc('groups/family').update({ adminName: 'Stale writer' }));
      await assertFails(ownerDb.doc('clients/family-owner-client').get());
      await assertFails(ownerDb.doc('daily_loads/owner_Lunes').get());
      await assertFails(ownerDb.doc('aiUsage/owner').get());
      await assertFails(ownerDb.doc('premiumOverrides/owner').get());
      await assertFails(ownerDb.doc('settings/family').get());
      await assertFails(ownerDb.doc('groups/family').get());
      await assertFails(ownerDb.doc('users/member').get());
      await assertFails(ownerDb.doc('accountDeletionJobs/owner').get());
      await assertFails(ownerDb.doc('accountDeletionJobs/owner').delete());
    }
  });

  test('closing lifecycle markers block member leaves and every scoped client write', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const memberDb = testEnvironment.authenticatedContext('member').firestore();
    const profileOwnerDb = testEnvironment.authenticatedContext('profile-owner').firestore();
    const profileMemberDb = testEnvironment.authenticatedContext('profile-member').firestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        adminDb.doc('groups/family').set({
          lifecycleState: 'deleting',
          deleteRequestedBy: 'owner',
        }, { merge: true }),
        adminDb.doc('profiles/route').set({
          lifecycleState: 'deleting',
          deleteRequestedBy: 'profile-owner',
        }, { merge: true }),
      ]);
    });

    await assertFails(memberDb.doc('users/member').update({ groupId: null, role: null }));
    await assertFails(memberDb.doc('clients/family-client').update({ name: 'race' }));
    await assertFails(memberDb.doc('settings/family').set({ race: true }, { merge: true }));
    await assertFails(ownerDb.doc('groups/family').update({ adminName: 'race' }));

    await assertFails(profileMemberDb.doc('profiles/route').update({
      memberUids: ['profile-owner'],
      members: { 'profile-owner': { role: 'admin' } },
    }));
    await assertFails(profileMemberDb.doc('clients/route-client').update({ name: 'race' }));
    await assertFails(profileMemberDb.doc('settings/route').set({ race: true }, { merge: true }));
    await assertFails(profileOwnerDb.doc('profiles/route').update({ name: 'race' }));
    await assertFails(profileOwnerDb.doc('profiles/route').delete());
  });

  test('profile settings are available to its owner/member but not outsiders', async () => {
    const ownerDb = testEnvironment.authenticatedContext('profile-owner').firestore();
    const memberDb = testEnvironment.authenticatedContext('profile-member').firestore();
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();

    await assertSucceeds(ownerDb.doc('settings/route').get());
    await assertSucceeds(memberDb.doc('settings/route').get());
    await assertSucceeds(ownerDb.doc('settings/route').set({ ownerEdit: true }, { merge: true }));
    await assertSucceeds(memberDb.doc('settings/route').set({ memberEdit: true }, { merge: true }));
    await assertFails(outsiderDb.doc('settings/route').get());
    await assertFails(outsiderDb.doc('settings/route').set({ stolen: true }, { merge: true }));

    for (const collectionName of ['clients', 'debts', 'transfers']) {
      await assertSucceeds(
        memberDb.collection(collectionName).where('groupId', '==', 'route').get(),
      );
      await assertFails(
        outsiderDb.collection(collectionName).where('groupId', '==', 'route').get(),
      );
    }
  });

  test('members cannot forge attribution or move shared business records to another scope', async () => {
    const memberDb = testEnvironment.authenticatedContext('member').firestore();
    const profileMemberDb = testEnvironment.authenticatedContext('profile-member').firestore();

    for (const collectionName of ['clients', 'debts', 'transfers']) {
      await assertFails(memberDb.doc(`${collectionName}/forged-owner`).set({
        userId: 'owner',
        groupId: 'family',
        name: 'Forged attribution',
        amount: 1,
      }));
    }

    await assertSucceeds(memberDb.doc('clients/family-client').update({
      name: 'Legitimate shared edit',
    }));
    await assertFails(memberDb.doc('clients/family-client').update({ groupId: null }));
    await assertFails(memberDb.doc('clients/family-owner-client').update({ userId: 'member' }));
    await assertFails(memberDb.doc('debts/family-debt').update({ groupId: null }));
    await assertFails(memberDb.doc('transfers/family-transfer').update({ groupId: null }));
    await assertFails(profileMemberDb.doc('clients/route-client').update({
      groupId: null,
      userId: 'profile-member',
    }));
    await assertFails(profileMemberDb.doc('debts/route-debt').update({
      groupId: null,
      userId: 'profile-member',
    }));
    await assertFails(profileMemberDb.doc('transfers/route-transfer').update({
      groupId: null,
      userId: 'profile-member',
    }));
  });

  test('a member cannot turn a real client into a deletable note', async () => {
    const memberDb = testEnvironment.authenticatedContext('member').firestore();

    await assertFails(memberDb.doc('clients/family-client').update({ isNote: true }));
    await assertFails(memberDb.doc('clients/family-client').delete());
    expect((await memberDb.doc('clients/family-client').get()).data()).toEqual(
      expect.objectContaining({ name: 'Untouched client' }),
    );
  });

  test('client deletion trusts the canonical group admin instead of the cached user role', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/owner').update({ role: 'member' });
    });

    await assertSucceeds(ownerDb.doc('clients/family-client').delete());
  });

  test('a stale admin role cannot let a family member delete a real client', async () => {
    const memberDb = testEnvironment.authenticatedContext('member').firestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/member').update({ role: 'admin' });
    });

    await assertFails(memberDb.doc('clients/family-client').delete());
    expect((await memberDb.doc('clients/family-client').get()).data()).toEqual(
      expect.objectContaining({ name: 'Untouched client' }),
    );
  });

  test('keeps legacy userId queries working without trusting self-declared profileIds', async () => {
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();

    // Compatibility: the app's personal listener queries only by userId and
    // filters groupId locally, so historical attributed docs must not make the
    // entire query fail until the additive scope migration exists.
    await assertSucceeds(
      outsiderDb.collection('clients').where('userId', '==', 'outsider').get(),
    );
    // Security boundary retained in this release: profileIds is only a cache;
    // it cannot expose a route document created by somebody else.
    await assertFails(outsiderDb.doc('clients/route-client').get());
    await assertFails(
      outsiderDb.collection('clients').where('groupId', '==', 'route').get(),
    );
  });

  test('scopeKey rollout stays legacy-compatible but rejects forged or mutable keys', async () => {
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();

    // Published builds do not send scopeKey yet, so version-0 users may still
    // create/update a personal legacy record during the additive rollout.
    await assertSucceeds(outsiderDb.doc('clients/legacy-personal').set({
      userId: 'outsider',
      name: 'Legacy personal',
    }));
    await assertSucceeds(outsiderDb.doc('clients/legacy-personal').update({
      name: 'Still compatible',
    }));

    // The compatible app may add the one canonical value, but a client can
    // never forge, mutate or remove it once present.
    await assertSucceeds(outsiderDb.doc('clients/legacy-personal').update({
      scopeKey: 'user:outsider',
    }));
    await assertFails(outsiderDb.doc('clients/legacy-personal').update({
      scopeKey: 'scope:foreign-live-group',
    }));
    await assertFails(outsiderDb.doc('clients/legacy-personal').update({ scopeKey: null }));
    await assertFails(outsiderDb.doc('clients/forged-scope-key').set({
      userId: 'outsider',
      scopeKey: 'user:someone-else',
      name: 'Forged',
    }));
  });

  test('strict scope reads revoke former creators without exposing or deleting records', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        adminDb.doc('users/outsider').set({ scopeReadVersion: 1 }, { merge: true }),
        adminDb.doc('clients/strict-personal').set({
          userId: 'outsider',
          scopeKey: 'user:outsider',
          name: 'Personal',
        }),
        adminDb.doc('clients/strict-former-shared').set({
          userId: 'outsider',
          groupId: 'foreign-live-group',
          scopeKey: 'scope:foreign-live-group',
          name: 'Shared attribution only',
        }),
      ]);
    });
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();

    await assertSucceeds(outsiderDb.doc('clients/strict-personal').get());
    await assertFails(outsiderDb.doc('clients/strict-former-shared').get());
    // The legacy query is intentionally invalid once the Admin rollout gate is
    // on because it could return the now-revoked shared attribution.
    await assertFails(
      outsiderDb.collection('clients').where('userId', '==', 'outsider').get(),
    );
    const personal = await assertSucceeds(
      outsiderDb.collection('clients').where('scopeKey', '==', 'user:outsider').get(),
    );
    expect(personal.docs.map((document) => document.id)).toContain('strict-personal');
    await assertFails(
      outsiderDb.collection('clients')
        .where('scopeKey', '==', 'scope:foreign-live-group')
        .get(),
    );

    // Strict mode also prevents old clients from creating an unbackfilled doc,
    // and the marker itself remains Admin-only.
    await assertFails(outsiderDb.doc('clients/strict-missing-key').set({
      userId: 'outsider',
      name: 'Old build',
    }));
    await assertFails(outsiderDb.doc('users/outsider').update({ scopeReadVersion: 0 }));

    // Nothing was destroyed as part of revocation.
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      expect((await context.firestore().doc('clients/strict-former-shared').get()).exists)
        .toBe(true);
    });
  });

  test('strict members query canonical shared scopes, not creator attribution', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        adminDb.doc('users/profile-member').set({ scopeReadVersion: 1 }, { merge: true }),
        adminDb.doc('clients/route-client').set({
          scopeKey: 'scope:route',
        }, { merge: true }),
        adminDb.doc('debts/route-debt').set({
          scopeKey: 'scope:route',
        }, { merge: true }),
        adminDb.doc('transfers/route-transfer').set({
          scopeKey: 'scope:route',
        }, { merge: true }),
      ]);
    });
    const memberDb = testEnvironment.authenticatedContext('profile-member').firestore();

    for (const collectionName of ['clients', 'debts', 'transfers']) {
      await assertSucceeds(
        memberDb.collection(collectionName)
          .where('scopeKey', '==', 'scope:route')
          .where('groupId', '==', 'route')
          .get(),
      );
    }
  });

  test('the server-only write seal prevents new legacy gaps before read activation', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('systemMigrations/dataScopeV1').set({
        phase: 'sealed_audit',
        writeVersion: 1,
      });
    });
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();

    await assertFails(outsiderDb.doc('systemMigrations/dataScopeV1').get());
    await assertFails(outsiderDb.doc('clients/sealed-legacy').set({
      userId: 'outsider',
      name: 'Old app write',
    }));
    await assertSucceeds(outsiderDb.doc('clients/sealed-canonical').set({
      userId: 'outsider',
      scopeKey: 'user:outsider',
      name: 'Compatible app write',
    }));
    await assertFails(outsiderDb.doc('clients/sealed-blank-group').set({
      userId: 'outsider',
      groupId: '',
      scopeKey: 'scope:',
      name: 'Invalid blank scope',
    }));
  });

  test('the global gate makes accounts created after verification strict by default', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        adminDb.doc('systemMigrations/dataScopeV1').set({
          phase: 'verified', writeVersion: 1, readVersion: 1,
        }),
        adminDb.doc('appConfig/dataScope').set({
          readVersion: 1, minimumAppBuild: '1.48',
        }),
        adminDb.doc('clients/future-former-shared').set({
          userId: 'future-user',
          groupId: 'foreign-live-group',
          scopeKey: 'scope:foreign-live-group',
          name: 'Must not leak through creator attribution',
        }),
      ]);
    });
    const futureDb = testEnvironment.authenticatedContext('future-user').firestore();
    await assertSucceeds(futureDb.doc('users/future-user').set({
      groupId: null, role: null, displayName: 'Future',
    }));
    await assertSucceeds(futureDb.doc('appConfig/dataScope').get());
    await assertFails(futureDb.doc('appConfig/dataScope').update({ readVersion: 0 }));
    await assertFails(futureDb.doc('systemMigrations/dataScopeV1').get());

    await assertSucceeds(futureDb.doc('clients/future-personal').set({
      userId: 'future-user', scopeKey: 'user:future-user', name: 'Personal',
    }));
    await assertSucceeds(futureDb.doc('clients/future-personal').get());
    await assertFails(futureDb.doc('clients/future-former-shared').get());
    await assertFails(
      futureDb.collection('clients').where('userId', '==', 'future-user').get(),
    );
    await assertSucceeds(
      futureDb.collection('clients').where('scopeKey', '==', 'user:future-user').get(),
    );
  });

  test('clients cannot bypass the authenticated join endpoint for any family group', async () => {
    const joinerDb = testEnvironment.authenticatedContext('joiner').firestore();
    const activeJoinerDb = testEnvironment.authenticatedContext('active-joiner').firestore();

    await assertFails(joinerDb.doc('users/joiner').set({
      groupId: 'dissolving',
      role: 'member',
    }, { merge: true }));
    await assertFails(activeJoinerDb.doc('users/active-joiner').set({
      groupId: 'active-group',
      role: 'member',
    }, { merge: true }));
  });

  test('profile index certification is server-owned even though profileIds remains a cache', async () => {
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();
    const newUserDb = testEnvironment.authenticatedContext('new-user').firestore();

    // Older clients still need to maintain profileIds during create/leave/archive,
    // but they cannot mark an incomplete cache as canonically synchronized.
    await assertSucceeds(outsiderDb.doc('users/outsider').update({ profileIds: ['route'] }));
    await assertFails(outsiderDb.doc('users/outsider').update({ profileIndexVersion: 1 }));
    await assertFails(newUserDb.doc('users/new-user').set({
      groupId: null,
      role: null,
      profileIds: [],
      profileIndexVersion: 1,
    }));
  });

  test('keeps family creation server-owned while hiding groups from outsiders', async () => {
    const creatorDb = testEnvironment.authenticatedContext('group-creator').firestore();
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();
    const memberDb = testEnvironment.authenticatedContext('member').firestore();
    const batch = creatorDb.batch();
    batch.set(creatorDb.doc('groups/new-family'), {
      adminId: 'group-creator',
      code: 'NEW234',
      lifecycleState: 'active',
    });
    batch.set(creatorDb.doc('users/group-creator'), {
      groupId: 'new-family', role: 'admin',
    }, { merge: true });
    await assertFails(batch.commit());
    let clientCreatedGroupExists = true;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      clientCreatedGroupExists = (await context.firestore().doc('groups/new-family').get()).exists;
    });
    expect(clientCreatedGroupExists).toBe(false);
    await assertSucceeds(memberDb.doc('groups/family').get());
    await assertFails(outsiderDb.doc('groups/family').get());
    await assertFails(outsiderDb.collection('groups').where('code', '==', 'FAMILY').get());
  });

  test('pending group migration freezes only personal writes and protects server fields', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        adminDb.doc('users/group-creator').set({
          pendingGroupId: 'group_1234567890abcdef1234567890abcdef',
          groupMigrationState: 'initializing',
          groupMigrationStartedAt: new Date('2026-08-04T12:00:00Z'),
        }, { merge: true }),
        adminDb.doc('clients/pending-personal').set({
          userId: 'group-creator',
          name: 'Must be migrated',
        }),
        adminDb.doc('settings/group-creator').set({ catalog: ['personal'] }),
      ]);
    });
    const creatorDb = testEnvironment.authenticatedContext('group-creator').firestore();

    await assertFails(creatorDb.doc('clients/pending-new').set({
      userId: 'group-creator',
      name: 'Late personal write',
    }));
    await assertFails(creatorDb.doc('clients/pending-personal').update({ name: 'Late edit' }));
    await assertFails(creatorDb.doc('debts/pending-debt').set({
      userId: 'group-creator',
      amount: 1,
    }));
    await assertFails(creatorDb.doc('transfers/pending-transfer').set({
      userId: 'group-creator',
      amount: 1,
    }));
    await assertFails(creatorDb.doc('settings/group-creator').set({ late: true }, { merge: true }));
    await assertFails(creatorDb.doc('users/group-creator').update({
      pendingGroupId: null,
      groupMigrationState: null,
      groupMigrationStartedAt: null,
    }));
    await assertFails(creatorDb.doc('groups/client-bypass').set({
      adminId: 'group-creator',
      code: 'BYP234',
      lifecycleState: 'active',
    }));
    await assertFails(creatorDb.doc('groupCodes/BYP234').set({
      groupId: 'client-bypass',
      ownerId: 'group-creator',
    }));

    // Unrelated account metadata remains editable; the backend-owned migration
    // marker is preserved automatically by a merge update.
    await assertSucceeds(creatorDb.doc('users/group-creator').update({ displayName: 'Still usable' }));
  });

  test('a join preflight reservation rejects concurrent personal writes', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/joiner').set({
        pendingGroupId: 'active-group',
        groupMigrationState: 'join_preflight',
        groupMigrationStartedAt: new Date('2026-08-04T12:00:00Z'),
      }, { merge: true });
    });
    const joinerDb = testEnvironment.authenticatedContext('joiner').firestore();

    await Promise.all([
      assertFails(joinerDb.doc('clients/join-race-client').set({
        userId: 'joiner', name: 'Late client',
      })),
      assertFails(joinerDb.doc('debts/join-race-debt').set({
        userId: 'joiner', amount: 1,
      })),
      assertFails(joinerDb.doc('transfers/join-race-transfer').set({
        userId: 'joiner', amount: 1,
      })),
      assertFails(joinerDb.doc('settings/joiner').set({ late: true })),
    ]);
    await assertFails(joinerDb.doc('users/joiner').update({
      pendingGroupId: null,
      groupMigrationState: null,
      groupMigrationStartedAt: null,
    }));
  });

  test('profiles allow canonical member gets but deny every client-side list/code query', async () => {
    const ownerDb = testEnvironment.authenticatedContext('profile-owner').firestore();
    const memberDb = testEnvironment.authenticatedContext('profile-member').firestore();
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();

    await assertSucceeds(ownerDb.doc('profiles/route').get());
    await assertSucceeds(memberDb.doc('profiles/route').get());
    await assertFails(
      memberDb.collection('profiles').where('memberUids', 'array-contains', 'profile-member').get(),
    );
    await assertFails(outsiderDb.doc('profiles/route').get());
    await assertFails(outsiderDb.collection('profiles').where('code', '==', 'ROUTE234').get());
  });

  test('a profile member can only remove their own exact membership', async () => {
    const memberDb = testEnvironment.authenticatedContext('profile-member').firestore();
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();
    const ownerDb = testEnvironment.authenticatedContext('profile-owner').firestore();
    const routeRef = memberDb.doc('profiles/route');

    await assertFails(outsiderDb.doc('profiles/route').update({
      memberUids: ['profile-owner', 'profile-member', 'outsider'],
      'members.outsider': { role: 'member' },
    }));
    await assertFails(routeRef.update({
      memberUids: ['profile-owner', 'profile-member', 'outsider'],
      'members.outsider': { role: 'member' },
    }));
    await assertFails(routeRef.update({
      memberUids: ['profile-member'],
      members: { 'profile-member': { role: 'member' } },
    }));
    await assertSucceeds(routeRef.update({
      memberUids: ['profile-owner'],
      members: { 'profile-owner': { role: 'admin' } },
    }));

    // The owner remains the only client allowed to manage third parties.
    await assertSucceeds(ownerDb.doc('profiles/route').update({
      memberUids: ['profile-owner', 'outsider'],
      members: {
        'profile-owner': { role: 'admin' },
        outsider: { role: 'member' },
      },
    }));
  });

  test('a profile owner cannot transfer ownership, remove self, or rewrite immutable metadata', async () => {
    const ownerDb = testEnvironment.authenticatedContext('profile-owner').firestore();
    const routeRef = ownerDb.doc('profiles/route');

    await assertFails(routeRef.update({ ownerId: 'outsider' }));
    await assertFails(routeRef.update({ createdAt: 'forged' }));
    await assertFails(routeRef.update({ convertedFromFamilyGroup: true }));
    await assertFails(routeRef.update({
      memberUids: ['profile-member'],
      members: { 'profile-member': { role: 'member' } },
    }));

    // Even an owner cannot allocate or rotate invite codes client-side.
    await assertFails(routeRef.update({ code: 'ABC234' }));
    await assertFails(routeRef.update({ code: 'DEF567' }));
    expect((await routeRef.get()).data()).toEqual(expect.objectContaining({
      ownerId: 'profile-owner',
    }));
  });

  test('client profile creation is denied even with well-formed owner data', async () => {
    const ownerDb = testEnvironment.authenticatedContext('profile-owner').firestore();
    const base = {
      name: 'New route',
      ownerId: 'profile-owner',
      code: 'GHJ234',
      memberUids: ['profile-owner'],
      members: { 'profile-owner': { role: 'admin' } },
      createdAt: new Date('2026-08-04T12:00:00Z'),
      lifecycleState: 'active',
    };

    await assertFails(ownerDb.doc('profiles/bad-code').set({ ...base, code: 'IIIIII' }));
    await assertFails(ownerDb.doc('profiles/bad-owner').set({
      ...base,
      memberUids: ['outsider'],
      members: { outsider: { role: 'admin' } },
    }));
    await assertFails(ownerDb.doc('profiles/valid-profile').set(base));
  });

  test('profile invite reservations and idempotency receipts are server-only', async () => {
    const ownerDb = testEnvironment.authenticatedContext('profile-owner').firestore();

    await assertFails(ownerDb.doc('profileCodes/ABC234').get());
    await assertFails(ownerDb.doc('profileCodes/ABC234').set({
      profileId: 'route',
      ownerId: 'profile-owner',
      state: 'active',
    }));
    await assertFails(ownerDb.doc('profileCreateRequests/profile-owner_request').get());
    await assertFails(ownerDb.doc('profileCreateRequests/profile-owner_request').set({
      ownerId: 'profile-owner',
      profileId: 'route',
      code: 'ABC234',
    }));
  });

  test('profile deletion is an atomic archive that preserves every business document', async () => {
    const ownerDb = testEnvironment.authenticatedContext('profile-owner').firestore();
    const memberDb = testEnvironment.authenticatedContext('profile-member').firestore();
    const profileRef = ownerDb.doc('profiles/route');
    const before = {
      client: (await ownerDb.doc('clients/route-client').get()).data(),
      debt: (await ownerDb.doc('debts/route-debt').get()).data(),
      transfer: (await ownerDb.doc('transfers/route-transfer').get()).data(),
      settings: (await ownerDb.doc('settings/route').get()).data(),
    };
    const batch = ownerDb.batch();
    batch.update(profileRef, {
      lifecycleState: 'archived',
      archivedAt: new Date('2026-08-04T12:00:00Z'),
      memberUids: ['profile-owner'],
      members: { 'profile-owner': { role: 'admin' } },
    });
    batch.set(ownerDb.doc('users/profile-owner'), {
      profileIds: [], activeProfileId: '__primary__',
    }, { merge: true });
    await assertSucceeds(batch.commit());

    expect((await profileRef.get()).data()).toEqual(expect.objectContaining({
      lifecycleState: 'archived', memberUids: ['profile-owner'],
    }));
    expect((await ownerDb.doc('clients/route-client').get()).data()).toEqual(before.client);
    expect((await ownerDb.doc('debts/route-debt').get()).data()).toEqual(before.debt);
    expect((await ownerDb.doc('transfers/route-transfer').get()).data()).toEqual(before.transfer);
    expect((await ownerDb.doc('settings/route').get()).data()).toEqual(before.settings);
    await assertFails(memberDb.doc('profiles/route').get());
    await assertFails(profileRef.update({ name: 'mutated after archive' }));
    await assertFails(profileRef.delete());
  });

  test('canonical admin repairs a missing role but client-side ownership transfer is denied', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/owner').set({
        email: 'owner@example.com',
        displayName: 'Owner',
        groupId: 'family',
        profileIds: [],
      });
    });
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await assertSucceeds(ownerDb.doc('users/owner').update({ role: 'admin' }));
    expect((await ownerDb.doc('users/owner').get()).data()?.role).toBe('admin');

    const batch = ownerDb.batch();
    batch.update(ownerDb.doc('groups/family'), {
      adminId: 'member',
      adminEmail: 'member@example.com',
      adminName: 'Member',
    });
    batch.update(ownerDb.doc('users/member'), { role: 'admin' });
    batch.update(ownerDb.doc('users/owner'), { groupId: null, role: null });
    await assertFails(batch.commit());

    expect((await ownerDb.doc('groups/family').get()).data()).toEqual(
      expect.objectContaining({ adminId: 'owner', adminEmail: 'owner@example.com' }),
    );
  });

  test('a family admin may only change another member groupId and role', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await assertFails(ownerDb.doc('users/member').update({ displayName: 'Forged' }));
    await assertFails(ownerDb.doc('users/member').update({ profileIds: ['family'] }));
    await assertSucceeds(ownerDb.doc('users/member').update({ groupId: null, role: null }));
  });

  test('an active group descriptor cannot be deleted without atomic conversion', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    await assertFails(ownerDb.doc('groups/family').delete());
    expect((await ownerDb.doc('clients/family-client').get()).exists).toBe(true);
  });

  test('the client cannot rewrite immutable group identity or invite metadata', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const groupRef = ownerDb.doc('groups/family');

    await assertFails(groupRef.update({ code: 'HIJACK' }));
    await assertFails(groupRef.update({ adminId: 'member' }));
    await assertFails(groupRef.update({ creationVersion: 'legacy' }));
    await assertFails(groupRef.update({ lifecycleState: 'active', adminName: 'Forged' }));
    expect((await groupRef.get()).data()).toEqual(expect.objectContaining({
      adminId: 'owner',
      code: 'FAMILY',
      creationVersion: 'server_resumable_v1',
    }));
  });

  test('atomically converts a family group without changing scoped business data', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const memberDb = testEnvironment.authenticatedContext('member').firestore();
    const outsiderDb = testEnvironment.authenticatedContext('outsider').firestore();
    const groupRef = ownerDb.doc('groups/family');

    const before = {
      client: (await ownerDb.doc('clients/family-client').get()).data(),
      debt: (await ownerDb.doc('debts/family-debt').get()).data(),
      transfer: (await ownerDb.doc('transfers/family-transfer').get()).data(),
    };

    await assertSucceeds(groupRef.update({
      lifecycleState: 'dissolving',
      dissolveRequestedBy: 'owner',
      dissolveRequestedAt: 'marker-time',
    }));
    const profilePreflight = await ownerDb.doc('profiles/family').get();
    expect(profilePreflight.exists).toBe(false);
    await assertSucceeds(ownerDb.doc('groupCodes/FAMILY').get());
    await assertFails(outsiderDb.doc('groupCodes/FAMILY').get());
    await assertFails(ownerDb.doc('clients/family-client').update({ name: 'racing write' }));

    const groupSettings = (await ownerDb.doc('settings/family').get()).data() || {};
    const personalSettings = (await ownerDb.doc('settings/owner').get()).data() || {};
    const batch = ownerDb.batch();
    batch.set(ownerDb.doc('profiles/family'), {
      name: 'Private route',
      ownerId: 'owner',
      memberUids: ['owner'],
      members: { owner: { role: 'admin', name: 'Owner', email: 'owner@example.com' } },
      createdAt: 'original-created-at',
      lifecycleState: 'active',
      convertedFromFamilyGroup: true,
    });
    batch.set(ownerDb.doc('users/owner'), {
      groupId: null,
      role: null,
      profileIds: ['family'],
      activeProfileId: 'family',
    }, { merge: true });
    batch.update(ownerDb.doc('users/member'), { groupId: null, role: null });
    batch.set(ownerDb.doc('settings/owner'), {
      ...personalSettings,
      ...groupSettings,
    }, { merge: true });
    batch.delete(ownerDb.doc('groupCodes/FAMILY'));
    batch.delete(groupRef);
    await assertSucceeds(batch.commit());

    // Once converted, the former admin is intentionally unable to probe the
    // deleted group path through client rules. Inspect existence as Admin.
    await assertFails(ownerDb.doc('groups/family').get());
    let convertedGroupExists = true;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      convertedGroupExists = (await context.firestore().doc('groups/family').get()).exists;
    });
    expect(convertedGroupExists).toBe(false);
    let convertedCodeExists = true;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      convertedCodeExists = (await context.firestore().doc('groupCodes/FAMILY').get()).exists;
    });
    expect(convertedCodeExists).toBe(false);
    expect((await ownerDb.doc('profiles/family').get()).data()).toEqual(
      expect.objectContaining({ ownerId: 'owner', memberUids: ['owner'] }),
    );
    expect((await ownerDb.doc('clients/family-client').get()).data()).toEqual(before.client);
    expect((await ownerDb.doc('debts/family-debt').get()).data()).toEqual(before.debt);
    expect((await ownerDb.doc('transfers/family-transfer').get()).data()).toEqual(before.transfer);
    expect((await ownerDb.doc('settings/owner').get()).data()).toEqual({
      personalOnly: 'preserved',
      catalog: ['group-product'],
      groupOnly: 'preserved',
      shared: 'group-wins',
    });
    expect((await ownerDb.doc('settings/family').get()).exists).toBe(true);
    await assertSucceeds(ownerDb.collection('clients').where('groupId', '==', 'family').get());

    // Compatibility debt documented in the rule: direct userId attribution
    // remains readable until the additive scope migration. It does not grant
    // access to other customers or to the converted profile/settings.
    await assertSucceeds(memberDb.doc('clients/family-client').get());
    await assertFails(memberDb.doc('clients/family-owner-client').get());
    await assertFails(memberDb.collection('clients').where('groupId', '==', 'family').get());
    await assertFails(memberDb.doc('settings/family').get());
    await assertFails(outsiderDb.doc('clients/family-client').get());
    await assertFails(outsiderDb.collection('clients').where('groupId', '==', 'family').get());
  });

  test('a rejected final conversion batch rolls back every metadata change', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const groupRef = ownerDb.doc('groups/family');
    await assertSucceeds(groupRef.update({
      lifecycleState: 'dissolving',
      dissolveRequestedBy: 'owner',
    }));

    const batch = ownerDb.batch();
    batch.set(ownerDb.doc('profiles/family'), {
      name: 'Private route',
      ownerId: 'owner',
      memberUids: ['owner'],
    });
    batch.update(ownerDb.doc('users/owner'), {
      groupId: null,
      role: null,
      profileIds: ['family'],
    });
    batch.update(ownerDb.doc('users/outsider'), { role: 'admin' });
    batch.delete(groupRef);
    await assertFails(batch.commit());

    expect((await groupRef.get()).data()).toEqual(expect.objectContaining({
      lifecycleState: 'dissolving',
      dissolveRequestedBy: 'owner',
    }));
    let rolledBackProfileExists = true;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      rolledBackProfileExists = (await context.firestore().doc('profiles/family').get()).exists;
    });
    expect(rolledBackProfileExists).toBe(false);
    expect((await ownerDb.doc('users/owner').get()).data()).toEqual(
      expect.objectContaining({ groupId: 'family', role: 'admin' }),
    );
    expect((await ownerDb.doc('clients/family-client').get()).data()?.name).toBe('Untouched client');
  });
});
