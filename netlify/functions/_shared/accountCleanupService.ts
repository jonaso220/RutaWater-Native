import type { Auth, UserRecord } from 'firebase-admin/auth';
import { FieldPath, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

const DAILY_LOAD_DAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

// Give the foreground request time to finish before the hourly recovery
// worker can claim a newly-created job. The durable job still guarantees a
// later retry if the request is interrupted.
const INITIAL_WORKER_DELAY_MS = 10 * 60 * 1000;

export interface AccountCleanupScopes {
  familyGroupId?: string;
  familyGroupCode?: string;
  profileIds: string[];
}

export type AccountDeletionJobState = 'planning' | 'planned' | 'auth_deleted';

export interface AccountDeletionJob {
  state: AccountDeletionJobState;
  scopes: AccountCleanupScopes;
}

export class SharedScopeChangedError extends Error {
  readonly code = 'SHARED_SCOPE_CHANGED';

  constructor(message: string) {
    super(message);
    this.name = 'SharedScopeChangedError';
  }
}

const normalizeScopes = (value: unknown): AccountCleanupScopes => {
  const raw = typeof value === 'object' && value !== null
    ? value as { familyGroupId?: unknown; familyGroupCode?: unknown; profileIds?: unknown }
    : {};
  const familyGroupId = typeof raw.familyGroupId === 'string' && raw.familyGroupId
    ? raw.familyGroupId
    : undefined;
  const familyGroupCode = typeof raw.familyGroupCode === 'string' && raw.familyGroupCode
    ? raw.familyGroupCode
    : undefined;
  const profileIds = Array.isArray(raw.profileIds)
    ? [...new Set(raw.profileIds.filter(
      (profileId): profileId is string => typeof profileId === 'string' && profileId.length > 0,
    ))].sort()
    : [];
  return {
    ...(familyGroupId ? { familyGroupId } : {}),
    ...(familyGroupCode ? { familyGroupCode } : {}),
    profileIds,
  };
};

const deletionJobRef = (db: Firestore, uid: string) =>
  db.collection('accountDeletionJobs').doc(uid);

const parseDeletionJob = (data: Record<string, any> | undefined): AccountDeletionJob | null => {
  if (!data) return null;
  const state = data.state;
  if (!['planning', 'planned', 'auth_deleted'].includes(state)) {
    throw new Error('Invalid account deletion job state.');
  }
  return {
    state,
    scopes: normalizeScopes(data.scopes),
  } as AccountDeletionJob;
};

export const loadAccountDeletionJob = async (
  db: Firestore,
  uid: string,
): Promise<AccountDeletionJob | null> => {
  const snapshot = await deletionJobRef(db, uid).get();
  return snapshot.exists ? parseDeletionJob(snapshot.data()) : null;
};

/**
 * Creates the durable marker before planning mutates any shared descriptor.
 * Concurrent/retried requests reuse the same marker instead of starting a
 * second, unrelated deletion.
 */
export const beginAccountDeletionJob = async (
  db: Firestore,
  uid: string,
): Promise<AccountDeletionJob> => db.runTransaction(async (transaction) => {
  const ref = deletionJobRef(db, uid);
  const userRef = db.collection('users').doc(uid);
  const [existing, user] = await Promise.all([
    transaction.get(ref),
    transaction.get(userRef),
  ]);
  const parsed = existing.exists ? parseDeletionJob(existing.data()) : null;
  // Keep this document as the permanent rules-visible tombstone. The final
  // cleanup replaces it with `{accountState: 'deleted'}` and no PII.
  if (user.data()?.accountState !== 'deleted') {
    transaction.set(userRef, { accountState: 'deleting' }, { merge: true });
  }
  if (parsed) {
    const existingData = existing.data() || {};
    if (existingData.cancellationRequestedAt != null) {
      throw new SharedScopeChangedError('Account deletion planning is being cancelled.');
    }
    if (
      existingData.uid === uid
      && existingData.requestedBy === uid
      && existingData.requestVersion === 'recent_auth_v1'
      && existingData.requestConfirmedAt != null
      && existingData.workerNextAttemptAt == null
    ) {
      transaction.set(ref, {
        workerNextAttemptAt: FieldValue.serverTimestamp(),
        workerAttemptCount: 0,
      }, { merge: true });
    }
    return parsed;
  }

  const job: AccountDeletionJob = { state: 'planning', scopes: { profileIds: [] } };
  transaction.create(ref, {
    uid,
    requestedBy: uid,
    requestVersion: 'recent_auth_v1',
    requestConfirmedAt: FieldValue.serverTimestamp(),
    workerNextAttemptAt: Timestamp.fromMillis(Date.now() + INITIAL_WORKER_DELAY_MS),
    workerAttemptCount: 0,
    state: job.state,
    scopes: job.scopes,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return job;
});

/**
 * Persists the complete private-scope plan before Firebase Auth is deleted.
 * Scope sets only grow: a concurrent retry can never replace a previously
 * proven private scope with an empty result after partial cleanup.
 */
export const persistAccountDeletionPlan = async (
  db: Firestore,
  uid: string,
  scopes: AccountCleanupScopes,
): Promise<AccountCleanupScopes> => {
  let persistedScopes = normalizeScopes(scopes);
  await db.runTransaction(async (transaction) => {
    const ref = deletionJobRef(db, uid);
    const snapshot = await transaction.get(ref);
    const snapshotData = snapshot.data() || {};
    if (
      !snapshot.exists
      || snapshotData.uid !== uid
      || snapshotData.requestedBy !== uid
      || snapshotData.requestVersion !== 'recent_auth_v1'
      || snapshotData.requestConfirmedAt == null
    ) {
      // Never recreate a missing or unproven job. A concurrent request may
      // have cancelled/completed this deletion after planning mutated shared
      // descriptors; only a durable recent-auth job may authorize Auth/data
      // deletion and scheduled recovery.
      throw new SharedScopeChangedError('Account deletion job changed during planning.');
    }
    if (snapshotData.cancellationRequestedAt != null) {
      throw new SharedScopeChangedError('Account deletion planning was cancelled.');
    }
    const existing = parseDeletionJob(snapshotData);
    const previous = existing?.scopes || { profileIds: [] };
    if (
      previous.familyGroupId
      && persistedScopes.familyGroupId
      && previous.familyGroupId !== persistedScopes.familyGroupId
    ) {
      throw new SharedScopeChangedError('Family cleanup scope changed.');
    }
    if (
      previous.familyGroupCode
      && persistedScopes.familyGroupCode
      && previous.familyGroupCode !== persistedScopes.familyGroupCode
    ) {
      throw new SharedScopeChangedError('Family cleanup code changed.');
    }
    persistedScopes = normalizeScopes({
      familyGroupId: previous.familyGroupId || persistedScopes.familyGroupId,
      familyGroupCode: previous.familyGroupCode || persistedScopes.familyGroupCode,
      profileIds: [...previous.profileIds, ...persistedScopes.profileIds],
    });
    transaction.update(ref, {
      state: existing?.state === 'auth_deleted' ? 'auth_deleted' : 'planned',
      scopes: persistedScopes,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return persistedScopes;
};

export const markAccountDeletionAuthDeleted = async (
  db: Firestore,
  uid: string,
): Promise<void> => {
  await db.runTransaction(async (transaction) => {
    const ref = deletionJobRef(db, uid);
    const job = await transaction.get(ref);
    // Another idempotent foreground/worker execution may already have
    // completed cleanup and deleted the job. Never recreate a partial marker
    // after that success: without its scopes the worker could not recover it.
    if (!job.exists) return;
    transaction.update(ref, {
      state: 'auth_deleted',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const deleteAccountDeletionJob = async (
  db: Firestore,
  uid: string,
): Promise<void> => deletionJobRef(db, uid).delete();

interface SuccessorClassification {
  eligible: string[];
  preserveOnly: string[];
  removable: string[];
}

const classifySuccessors = async (
  db: Firestore,
  adminAuth: Auth,
  candidateUids: string[],
  missingUserRepair: Record<string, any> = {},
): Promise<SuccessorClassification> => {
  const eligible: string[] = [];
  const preserveOnly: string[] = [];
  const removable: string[] = [];
  for (const candidateUid of [...new Set(candidateUids)].filter(Boolean).sort()) {
    let authUser: UserRecord;
    try {
      // Auth is the source of truth for existence. A legacy/missing Firestore
      // user document must never make a live Auth member look disposable.
      authUser = await adminAuth.getUser(candidateUid);
    } catch (error: any) {
      // Only a definitive Auth absence is removable. Permission/network errors
      // abort the owner deletion before customer data can be classified sole.
      if (error?.code !== 'auth/user-not-found') throw error;
      removable.push(candidateUid);
      continue;
    }

    const firestoreState = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(candidateUid);
      const [candidate, deletionJob] = await Promise.all([
        transaction.get(userRef),
        transaction.get(deletionJobRef(db, candidateUid)),
      ]);
      const accountState = candidate.data()?.accountState || 'active';
      if (deletionJob.exists || accountState === 'deleting' || accountState === 'deleted') {
        // Auth still proves this person exists. A concurrent deletion can be
        // cancelled after a scope conflict, so removing their membership now
        // could make the owner misclassify shared customer data as private and
        // delete it. Preserve the scope; only auth/user-not-found is removable.
        return 'preserve' as const;
      }
      if (!candidate.exists) {
        transaction.set(userRef, {
          email: authUser.email || '',
          displayName: authUser.displayName || '',
          ...missingUserRepair,
        }, { merge: true });
      }
      return accountState === 'active' ? 'active' as const : 'preserve' as const;
    });

    if (firestoreState === 'removable') {
      removable.push(candidateUid);
    } else if (authUser.disabled || firestoreState === 'preserve') {
      // Disabled/suspended accounts may later be restored. Keep their
      // membership and every business document, but never grant ownership.
      preserveOnly.push(candidateUid);
    } else {
      eligible.push(candidateUid);
    }
  }
  return { eligible, preserveOnly, removable };
};

const getAuthUsersOrThrow = async (
  adminAuth: Auth,
  uids: string[],
): Promise<Map<string, UserRecord>> => {
  const users = new Map<string, UserRecord>();
  for (const uid of uids) {
    try {
      users.set(uid, await adminAuth.getUser(uid));
    } catch (error: any) {
      if (error?.code === 'auth/user-not-found') {
        throw new SharedScopeChangedError('Successor Auth membership changed.');
      }
      throw error;
    }
  }
  return users;
};

const clearStaleFamilyMemberships = async (
  db: Firestore,
  staleUids: string[],
): Promise<void> => {
  for (let index = 0; index < staleUids.length; index += 400) {
    const batch = db.batch();
    staleUids.slice(index, index + 400).forEach((staleUid) => {
      batch.set(
        db.collection('users').doc(staleUid),
        { groupId: null, role: null },
        { merge: true },
      );
    });
    await batch.commit();
  }
};

const deleteRefs = async (db: Firestore, refs: any[]): Promise<void> => {
  for (let index = 0; index < refs.length; index += 400) {
    const batch = db.batch();
    refs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

const deleteMatching = async (
  db: Firestore,
  collectionName: string,
  field: string,
  value: string,
  include: (data: Record<string, any>) => boolean = () => true,
): Promise<void> => {
  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where(field, '==', value)
      .get();
    const refs = snapshot.docs.filter((doc) => include(doc.data())).map((doc) => doc.ref);
    if (refs.length === 0) return;
    await deleteRefs(db, refs);
  }
};

const deletePromoRedemptionsForUser = async (
  db: Firestore,
  uid: string,
): Promise<void> => {
  const premiumRef = db.collection('premiumOverrides').doc(uid);
  const premium = await premiumRef.get();
  const storedPromoId = premium.data()?.promoId ?? premium.data()?.promoDigest;
  if (typeof storedPromoId === 'string' && /^[a-f0-9]{64}$/.test(storedPromoId)) {
    // The redemption is privacy metadata only. usedCount remains consumed so
    // deleting an account never returns a limited code slot or affects anybody
    // else's already activated Premium.
    await db.collection('promoCodes')
      .doc(storedPromoId)
      .collection('redemptions')
      .doc(uid)
      .delete();
  }

  // Always scan every promo descriptor as well: an account may have
  // deactivated one promotion and later redeemed another. Looking up the
  // deterministic subdocument id avoids a collection-group filtered query,
  // which would require a separately deployed COLLECTION_GROUP index. The
  // bounded pages remain idempotent and never mutate usedCount/descriptors.
  let lastPromoId: string | undefined;
  while (true) {
    let query = db.collection('promoCodes')
      .orderBy(FieldPath.documentId())
      .limit(400);
    if (lastPromoId) query = query.startAfter(lastPromoId);
    const promos = await query.get();
    if (promos.empty) return;
    await deleteRefs(db, promos.docs.map((promo) => promo.ref.collection('redemptions').doc(uid)));
    if (promos.size < 400) return;
    lastPromoId = promos.docs[promos.docs.length - 1].id;
  }
};

const isExplicitPlanningJob = (data: Record<string, any>, uid: string): boolean =>
  data.state === 'planning'
  && data.uid === uid
  && data.requestedBy === uid
  && data.requestVersion === 'recent_auth_v1'
  && data.requestConfirmedAt != null;

const isClaimedPlanningCancellation = (data: Record<string, any>, uid: string): boolean =>
  isExplicitPlanningJob(data, uid) && data.cancellationRequestedAt != null;

const restorePlanningDescriptors = async (
  db: Firestore,
  uid: string,
  collectionName: 'groups' | 'profiles',
  ownerField: 'adminId' | 'ownerId',
): Promise<void> => {
  const candidates = await db.collection(collectionName)
    .where('deleteRequestedBy', '==', uid)
    .get();
  for (const candidate of candidates.docs) {
    await db.runTransaction(async (transaction) => {
      const [descriptor, job] = await Promise.all([
        transaction.get(candidate.ref),
        transaction.get(deletionJobRef(db, uid)),
      ]);
      const data = descriptor.data() || {};
      if (
        !descriptor.exists
        || data[ownerField] !== uid
        || data.lifecycleState !== 'deleting'
        || data.deleteRequestedBy !== uid
        || !job.exists
        || !isClaimedPlanningCancellation(job.data() || {}, uid)
      ) return;
      const allowedPreviousStates = collectionName === 'groups'
        ? ['active', 'initializing', 'dissolving']
        : ['active', 'archived'];
      const previousState = allowedPreviousStates.includes(data.deletePreviousLifecycleState)
        ? data.deletePreviousLifecycleState
        : 'active';
      transaction.update(candidate.ref, {
        lifecycleState: previousState,
        deleteRequestedBy: FieldValue.delete(),
        deleteRequestedAt: FieldValue.delete(),
        deletePreviousLifecycleState: FieldValue.delete(),
      });
    });
  }
};

/**
 * Cancels only an authenticated deletion still in its planning phase. This is
 * used after a canonical SHARED_SCOPE_CHANGED result: Auth and customer data
 * remain untouched, descriptors marked by this exact request are reopened,
 * and deleting account metadata is made usable for a deliberate retry.
 */
export const cancelPlanningAccountDeletion = async (
  db: Firestore,
  uid: string,
): Promise<boolean> => {
  const claimed = await db.runTransaction(async (transaction) => {
    const jobRef = deletionJobRef(db, uid);
    const job = await transaction.get(jobRef);
    const data = job.data() || {};
    if (!job.exists || !isExplicitPlanningJob(data, uid)) return false;
    if (data.cancellationRequestedAt == null) {
      transaction.update(jobRef, {
        cancellationRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return true;
  });
  if (!claimed) return false;

  await restorePlanningDescriptors(db, uid, 'groups', 'adminId');
  await restorePlanningDescriptors(db, uid, 'profiles', 'ownerId');

  return db.runTransaction(async (transaction) => {
    const jobRef = deletionJobRef(db, uid);
    const userRef = db.collection('users').doc(uid);
    const [job, user] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(userRef),
    ]);
    if (!job.exists || !isClaimedPlanningCancellation(job.data() || {}, uid)) return false;

    const userData = user.data() || {};
    const patch: Record<string, any> = { accountState: 'active' };
    if (userData.groupMigrationState === 'deleting') {
      patch.groupMigrationState = typeof userData.pendingGroupId === 'string'
        && userData.pendingGroupId
        ? 'initializing'
        : FieldValue.delete();
    }
    transaction.set(userRef, patch, { merge: true });
    transaction.delete(jobRef);
    return true;
  });
};

export const planAccountDeletion = async (
  db: Firestore,
  adminAuth: Auth,
  uid: string,
): Promise<AccountCleanupScopes> => {
  const scopes: AccountCleanupScopes = { profileIds: [] };
  const userRef = db.collection('users').doc(uid);
  const user = await userRef.get();
  const userData = user.data() || {};
  let familyGroupId = userData.groupId;
  let pendingGroupId = userData.pendingGroupId;

  if (
    typeof pendingGroupId === 'string'
    && pendingGroupId
    && userData.groupMigrationState === 'join_preflight'
  ) {
    const joinPreflightGroupId = pendingGroupId;
    // A join preflight reserves somebody else's active group only as a
    // temporary write fence. Account deletion must release that fence without
    // classifying the target as an owned initializing group or touching any of
    // its documents. beginAccountDeletionJob already set accountState=deleting,
    // so a concurrent join finalization cannot recreate the membership.
    familyGroupId = await db.runTransaction(async (transaction) => {
      const currentUser = await transaction.get(userRef);
      const currentUserData = currentUser.data() || {};
      const currentPendingGroupId = currentUserData.pendingGroupId;
      if (currentPendingGroupId === undefined || currentPendingGroupId === null) {
        return currentUserData.groupId || familyGroupId || null;
      }
      if (
        currentPendingGroupId !== joinPreflightGroupId
        || currentUserData.groupMigrationState !== 'join_preflight'
      ) {
        throw new SharedScopeChangedError('Pending family join changed.');
      }
      transaction.set(userRef, {
        accountState: 'deleting',
        pendingGroupId: FieldValue.delete(),
        groupMigrationState: FieldValue.delete(),
        groupMigrationStartedAt: FieldValue.delete(),
      }, { merge: true });
      return currentUserData.groupId || familyGroupId || null;
    });
    pendingGroupId = null;
  }

  if (typeof pendingGroupId === 'string' && pendingGroupId) {
    const pendingGroupRef = db.collection('groups').doc(pendingGroupId);
    const pendingProfileRef = db.collection('profiles').doc(pendingGroupId);
    const pendingCode = await db.runTransaction(async (transaction) => {
      const [currentUser, pendingGroup, pendingProfile] = await Promise.all([
        transaction.get(userRef),
        transaction.get(pendingGroupRef),
        transaction.get(pendingProfileRef),
      ]);
      const currentUserData = currentUser.data() || {};
      const pendingGroupData = pendingGroup.data() || {};
      if (
        !currentUser.exists
        || currentUserData.pendingGroupId !== pendingGroupId
        || (typeof currentUserData.groupId === 'string' && currentUserData.groupId)
        || !pendingGroup.exists
        || pendingProfile.exists
        || pendingGroupData.adminId !== uid
        || pendingGroupData.creationVersion !== 'server_resumable_v1'
      ) {
        throw new SharedScopeChangedError('Pending family creation changed.');
      }
      const state = pendingGroupData.lifecycleState;
      const sameRetry = state === 'deleting' && pendingGroupData.deleteRequestedBy === uid;
      if (state !== 'initializing' && !sameRetry) {
        throw new SharedScopeChangedError('Pending family group is already closing.');
      }
      const code = pendingGroupData.code;
      if (typeof code !== 'string' || !code) {
        throw new SharedScopeChangedError('Pending family code is missing.');
      }
      const codeRef = db.collection('groupCodes').doc(code);
      const codeReservation = await transaction.get(codeRef);
      if (!codeReservation.exists || codeReservation.data()?.groupId !== pendingGroupId) {
        throw new SharedScopeChangedError('Pending family code reservation changed.');
      }
      transaction.update(pendingGroupRef, {
        lifecycleState: 'deleting',
        deleteRequestedBy: uid,
        deleteRequestedAt: FieldValue.serverTimestamp(),
        ...(sameRetry ? {} : { deletePreviousLifecycleState: state }),
      });
      transaction.set(userRef, {
        accountState: 'deleting',
        groupMigrationState: 'deleting',
      }, { merge: true });
      return code;
    });
    // Some documents may already have migrated to this pending scope. Nothing
    // is deleted now: the exact descriptor/code/settings scope is stored in the
    // durable job and cleaned only after Auth deletion succeeds.
    scopes.familyGroupId = pendingGroupId;
    scopes.familyGroupCode = pendingCode;
    familyGroupId = null;
  }

  // Legacy accounts can own a canonical family group even when users/{uid}
  // lost groupId. Discover ownership from groups.adminId before Auth deletion
  // so the descriptor and its scoped data can never become an unseen orphan.
  // The account tombstone/job already blocks concurrent create/join/transfer.
  const ownedGroups = await db.collection('groups')
    .where('adminId', '==', uid)
    .limit(3)
    .get();
  const discoverableOwnedGroups = ownedGroups.docs.filter((groupDoc) => {
    if (groupDoc.id === pendingGroupId) return false;
    const data = groupDoc.data() || {};
    // This is an intentional preservation result from a prior interrupted
    // plan, not an orphan that should later be classified as sole.
    return !(
      data.lifecycleState === 'archived'
      && data.archivedReason === 'owner_deleted_with_preserved_members'
    );
  });
  if (discoverableOwnedGroups.length > 1) {
    throw new SharedScopeChangedError('Multiple owned family groups found.');
  }
  if (
    typeof pendingGroupId === 'string'
    && pendingGroupId
    && scopes.familyGroupId === pendingGroupId
    && discoverableOwnedGroups.length > 0
  ) {
    throw new SharedScopeChangedError('Pending and active family ownership overlap.');
  }
  if (discoverableOwnedGroups.length === 1) {
    const discoveredGroupId = discoverableOwnedGroups[0].id;
    if (
      typeof familyGroupId === 'string'
      && familyGroupId
      && familyGroupId !== discoveredGroupId
    ) {
      throw new SharedScopeChangedError('Family ownership and membership disagree.');
    }
    familyGroupId = discoveredGroupId;
  }

  if (typeof familyGroupId === 'string' && familyGroupId) {
    const groupRef = db.collection('groups').doc(familyGroupId);
    const group = await groupRef.get();
    if (group.exists && group.data()?.adminId === uid) {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(groupRef);
        const data = current.data() || {};
        if (!current.exists || data.adminId !== uid) {
          throw new SharedScopeChangedError('Family ownership changed.');
        }
        const state = data.lifecycleState || 'active';
        const sameRetry = state === 'deleting' && data.deleteRequestedBy === uid;
        const ownDissolve = state === 'dissolving' && data.dissolveRequestedBy === uid;
        if (state !== 'active' && !sameRetry && !ownDissolve) {
          throw new SharedScopeChangedError('Family group is already closing.');
        }
        transaction.update(groupRef, {
          lifecycleState: 'deleting',
          deleteRequestedBy: uid,
          deleteRequestedAt: FieldValue.serverTimestamp(),
          ...(sameRetry ? {} : { deletePreviousLifecycleState: state }),
        });
      });

      // The lifecycle transaction closes both Admin and legacy client joins.
      // Re-read membership afterwards, then validate candidate Auth accounts.
      const members = await db.collection('users').where('groupId', '==', familyGroupId).get();
      const classifiedMembers = await classifySuccessors(
        db,
        adminAuth,
        members.docs.map((member) => member.id).filter((memberUid) => memberUid !== uid),
        { groupId: familyGroupId, role: 'member' },
      );
      await clearStaleFamilyMemberships(db, classifiedMembers.removable);
      const successorId = classifiedMembers.eligible[0];
      if (successorId) {
        // A deleting member is unable to leave while the group is marked, but
        // revalidate both Auth and canonical membership immediately before the
        // atomic transfer. This also conflicts/retries with any earlier leave
        // transaction that started while the group was still active.
        const successorAuth = (await getAuthUsersOrThrow(adminAuth, [successorId]))
          .get(successorId)!;
        if (successorAuth.disabled) {
          throw new SharedScopeChangedError('Family successor became disabled.');
        }
        const successorRef = db.collection('users').doc(successorId);
        const successorJobRef = deletionJobRef(db, successorId);
        await db.runTransaction(async (transaction) => {
          const [currentGroup, successor, successorJob] = await Promise.all([
            transaction.get(groupRef),
            transaction.get(successorRef),
            transaction.get(successorJobRef),
          ]);
          const currentGroupData = currentGroup.data() || {};
          const successorData = successor.data() || {};
          const currentCode = typeof currentGroupData.code === 'string'
            ? currentGroupData.code
            : '';
          const codeRef = currentCode
            ? db.collection('groupCodes').doc(currentCode)
            : null;
          const codeReservation = codeRef ? await transaction.get(codeRef) : null;
          if (
            !currentGroup.exists
            || currentGroupData.adminId !== uid
            || currentGroupData.lifecycleState !== 'deleting'
            || currentGroupData.deleteRequestedBy !== uid
            || !successor.exists
            || successorData.groupId !== familyGroupId
            || (successorData.accountState || 'active') !== 'active'
            || successorJob.exists
          ) {
            throw new SharedScopeChangedError('Family successor membership changed.');
          }
          if (
            codeReservation?.exists
            && codeReservation.data()?.groupId !== familyGroupId
          ) {
            throw new SharedScopeChangedError('Family code reservation changed.');
          }
          if (
            currentGroupData.creationVersion === 'server_resumable_v1'
            && (!codeRef || !codeReservation?.exists)
          ) {
            throw new SharedScopeChangedError('Family code reservation is missing.');
          }
          transaction.update(groupRef, {
            adminId: successorId,
            adminEmail: successorData.email || '',
            adminName: successorData.displayName || '',
            lifecycleState: 'active',
            deleteRequestedBy: FieldValue.delete(),
            deleteRequestedAt: FieldValue.delete(),
            deletePreviousLifecycleState: FieldValue.delete(),
            dissolveRequestedBy: FieldValue.delete(),
            dissolveRequestedAt: FieldValue.delete(),
          });
          if (codeRef && codeReservation?.exists) {
            transaction.update(codeRef, { ownerId: successorId });
          }
          transaction.set(successorRef, { groupId: familyGroupId, role: 'admin' }, { merge: true });
          transaction.set(userRef, { groupId: null, role: null }, { merge: true });
        });
      } else if (classifiedMembers.preserveOnly.length > 0) {
        // A disabled/suspended Auth member cannot own the scope, but may later
        // return. Archive the descriptor and retain every document rather than
        // misclassifying the route as private to the deleting owner.
        const preservedAuth = await getAuthUsersOrThrow(
          adminAuth,
          classifiedMembers.preserveOnly,
        );
        await db.runTransaction(async (transaction) => {
          const currentGroup = await transaction.get(groupRef);
          const guardSnapshots = await Promise.all(
            classifiedMembers.preserveOnly.flatMap((memberUid) => [
              transaction.get(db.collection('users').doc(memberUid)),
              transaction.get(deletionJobRef(db, memberUid)),
            ]),
          );
          const currentGroupData = currentGroup.data() || {};
          if (
            !currentGroup.exists
            || currentGroupData.adminId !== uid
            || currentGroupData.lifecycleState !== 'deleting'
            || currentGroupData.deleteRequestedBy !== uid
          ) {
            throw new SharedScopeChangedError('Family preservation state changed.');
          }
          classifiedMembers.preserveOnly.forEach((memberUid, index) => {
            const member = guardSnapshots[index * 2];
            const job = guardSnapshots[index * 2 + 1];
            const memberState = member.data()?.accountState || 'active';
            const authUser = preservedAuth.get(memberUid)!;
            if (
              !member.exists
              || member.data()?.groupId !== familyGroupId
              || (!authUser.disabled && !job.exists && memberState === 'active')
            ) {
              throw new SharedScopeChangedError('Preserved family membership changed.');
            }
          });
          transaction.update(groupRef, {
            lifecycleState: 'archived',
            archivedReason: 'owner_deleted_with_preserved_members',
            archivedAt: FieldValue.serverTimestamp(),
            adminEmail: FieldValue.delete(),
            adminName: FieldValue.delete(),
            deleteRequestedBy: FieldValue.delete(),
            deleteRequestedAt: FieldValue.delete(),
            deletePreviousLifecycleState: FieldValue.delete(),
            dissolveRequestedBy: FieldValue.delete(),
            dissolveRequestedAt: FieldValue.delete(),
          });
          transaction.set(userRef, { groupId: null, role: null }, { merge: true });
        });
      } else {
        // All queried members were definitively missing from Auth and were
        // detached above. The lifecycle marker prevents any new join between
        // this proof and durable job persistence.
        const remainingMembers = await db
          .collection('users')
          .where('groupId', '==', familyGroupId)
          .get();
        if (remainingMembers.docs.some((member) => member.id !== uid)) {
          throw new SharedScopeChangedError('Family membership changed while closing.');
        }
        scopes.familyGroupId = familyGroupId;
        const latestGroup = await groupRef.get();
        const code = latestGroup.data()?.code;
        if (typeof code === 'string' && code) {
          const reservation = await db.collection('groupCodes').doc(code).get();
          if (reservation.exists && reservation.data()?.groupId === familyGroupId) {
            scopes.familyGroupCode = code;
          } else if (latestGroup.data()?.creationVersion === 'server_resumable_v1') {
            throw new SharedScopeChangedError('Family code reservation changed.');
          }
        } else if (latestGroup.data()?.creationVersion === 'server_resumable_v1') {
          throw new SharedScopeChangedError('Family code is missing.');
        }
      }
    } else {
      // A member leave participates in the same descriptor transaction as an
      // owner deletion marker. Whichever commits first is observed by the
      // other operation; nobody can be selected as successor while leaving.
      await db.runTransaction(async (transaction) => {
        const [currentUser, currentGroup] = await Promise.all([
          transaction.get(userRef),
          transaction.get(groupRef),
        ]);
        if (!currentUser.exists || currentUser.data()?.groupId !== familyGroupId) return;
        if (currentGroup.exists) {
          const groupData = currentGroup.data() || {};
          if (groupData.adminId === uid) {
            throw new SharedScopeChangedError('Family ownership changed.');
          }
          const lifecycleState = groupData.lifecycleState || 'active';
          const isPreservedArchive = lifecycleState === 'archived'
            && groupData.archivedReason === 'owner_deleted_with_preserved_members';
          if (lifecycleState !== 'active' && !isPreservedArchive) {
            throw new SharedScopeChangedError('Family group is already closing.');
          }
        }
        transaction.set(userRef, { groupId: null, role: null }, { merge: true });
      });
    }
  }

  // Legacy/corrupted profiles may still name this account as ownerId while the
  // owner's UID is missing from memberUids. Discover both canonical signals so
  // deleting Auth can never leave an owned descriptor and its data orphaned.
  const [memberProfiles, ownedProfiles] = await Promise.all([
    db.collection('profiles').where('memberUids', 'array-contains', uid).get(),
    db.collection('profiles').where('ownerId', '==', uid).get(),
  ]);
  const profilesById = new Map(
    [...memberProfiles.docs, ...ownedProfiles.docs].map((profile) => [profile.id, profile]),
  );
  const profiles = [...profilesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  for (const initialProfile of profiles) {
    const action = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(initialProfile.ref);
      const data = current.data() || {};
      const memberUids = Array.isArray(data.memberUids) ? data.memberUids : [];
      if (!current.exists) return 'none' as const;
      if (data.ownerId !== uid) {
        if (!memberUids.includes(uid)) return 'none' as const;
        const lifecycleState = data.lifecycleState || 'active';
        const isPreservedArchive = lifecycleState === 'archived'
          && data.archivedReason === 'owner_deleted_with_preserved_members';
        if (lifecycleState !== 'active' && !isPreservedArchive) {
          throw new SharedScopeChangedError('Profile is already closing.');
        }
        transaction.update(initialProfile.ref, {
          memberUids: FieldValue.arrayRemove(uid),
          [`members.${uid}`]: FieldValue.delete(),
        });
        return 'left' as const;
      }
      const state = data.lifecycleState || 'active';
      const sameRetry = state === 'deleting' && data.deleteRequestedBy === uid;
      const safelyArchived = state === 'archived';
      if (state !== 'active' && !safelyArchived && !sameRetry) {
        throw new SharedScopeChangedError('Profile is already closing.');
      }
      transaction.update(initialProfile.ref, {
        lifecycleState: 'deleting',
        deleteRequestedBy: uid,
        deleteRequestedAt: FieldValue.serverTimestamp(),
        ...(sameRetry ? {} : { deletePreviousLifecycleState: state }),
      });
      return 'owner' as const;
    });
    if (action !== 'owner') continue;

    const currentProfile = await initialProfile.ref.get();
    const currentData = currentProfile.data() || {};
    const memberUids = Array.isArray(currentData.memberUids) ? currentData.memberUids : [];
    const classifiedMembers = await classifySuccessors(
      db,
      adminAuth,
      memberUids.filter((memberUid: unknown): memberUid is string => (
        typeof memberUid === 'string' && memberUid !== uid
      )),
      { profileIds: FieldValue.arrayUnion(initialProfile.id) },
    );
    const retainedMembers = [
      ...classifiedMembers.eligible,
      ...classifiedMembers.preserveOnly,
    ].sort();
    const successorId = classifiedMembers.eligible[0];
    if (successorId) {
      const successorAuth = (await getAuthUsersOrThrow(adminAuth, [successorId]))
        .get(successorId)!;
      if (successorAuth.disabled) {
        throw new SharedScopeChangedError('Profile successor became disabled.');
      }
      const preservedAuth = await getAuthUsersOrThrow(
        adminAuth,
        classifiedMembers.preserveOnly,
      );
      const successorRef = db.collection('users').doc(successorId);
      const successorJobRef = deletionJobRef(db, successorId);
      await db.runTransaction(async (transaction) => {
        const [latest, successor, successorJob] = await Promise.all([
          transaction.get(initialProfile.ref),
          transaction.get(successorRef),
          transaction.get(successorJobRef),
        ]);
        const preserveGuards = await Promise.all(
          classifiedMembers.preserveOnly.flatMap((memberUid) => [
            transaction.get(db.collection('users').doc(memberUid)),
            transaction.get(deletionJobRef(db, memberUid)),
          ]),
        );
        const latestData = latest.data() || {};
        const successorData = successor.data() || {};
        const currentCode = typeof latestData.code === 'string' ? latestData.code : '';
        const codeRef = currentCode
          ? db.collection('profileCodes').doc(currentCode)
          : null;
        const codeReservation = codeRef ? await transaction.get(codeRef) : null;
        const latestMemberUids = Array.isArray(latestData.memberUids)
          ? latestData.memberUids
          : [];
        if (
          !latest.exists
          || latestData.ownerId !== uid
          || latestData.lifecycleState !== 'deleting'
          || latestData.deleteRequestedBy !== uid
          || !latestMemberUids.includes(successorId)
          || retainedMembers.some((memberUid) => !latestMemberUids.includes(memberUid))
          || !successor.exists
          || (successorData.accountState || 'active') !== 'active'
          || successorJob.exists
        ) {
          throw new SharedScopeChangedError('Profile successor membership changed.');
        }
        if (codeReservation?.exists && codeReservation.data()?.profileId !== initialProfile.id) {
          throw new SharedScopeChangedError('Profile code reservation changed.');
        }
        if (
          latestData.creationVersion === 'profile_codes_v1'
          && (!codeRef || !codeReservation?.exists)
        ) {
          throw new SharedScopeChangedError('Profile code reservation is missing.');
        }
        classifiedMembers.preserveOnly.forEach((memberUid, index) => {
          const member = preserveGuards[index * 2];
          const job = preserveGuards[index * 2 + 1];
          const memberState = member.data()?.accountState || 'active';
          const authUser = preservedAuth.get(memberUid)!;
          if (
            !authUser
            || !member.exists
            || (!authUser.disabled && !job.exists && memberState === 'active')
          ) {
            throw new SharedScopeChangedError('Preserved profile membership changed.');
          }
        });
        const existingMembers = latestData.members || {};
        const nextMembers: Record<string, any> = {};
        retainedMembers.forEach((memberUid) => {
          nextMembers[memberUid] = {
            ...(existingMembers[memberUid] || {}),
            role: memberUid === successorId ? 'admin' : 'member',
          };
        });
        transaction.update(initialProfile.ref, {
          ownerId: successorId,
          memberUids: retainedMembers,
          members: nextMembers,
          lifecycleState: 'active',
          deleteRequestedBy: FieldValue.delete(),
          deleteRequestedAt: FieldValue.delete(),
          deletePreviousLifecycleState: FieldValue.delete(),
        });
        if (codeRef && codeReservation?.exists) {
          transaction.update(codeRef, { ownerId: successorId });
        }
        // profileIds is a UI/listener index, not the authorization source, but
        // a version-certified legacy cache may otherwise hide the route from
        // its newly canonical owner forever. Repair it atomically with transfer.
        transaction.set(successorRef, {
          profileIds: FieldValue.arrayUnion(initialProfile.id),
        }, { merge: true });
      });
    } else if (classifiedMembers.preserveOnly.length > 0) {
      const preservedAuth = await getAuthUsersOrThrow(
        adminAuth,
        classifiedMembers.preserveOnly,
      );
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(initialProfile.ref);
        const preserveGuards = await Promise.all(
          classifiedMembers.preserveOnly.flatMap((memberUid) => [
            transaction.get(db.collection('users').doc(memberUid)),
            transaction.get(deletionJobRef(db, memberUid)),
          ]),
        );
        const latestData = latest.data() || {};
        const latestMemberUids = Array.isArray(latestData.memberUids)
          ? latestData.memberUids
          : [];
        if (
          !latest.exists
          || latestData.ownerId !== uid
          || latestData.lifecycleState !== 'deleting'
          || latestData.deleteRequestedBy !== uid
          || classifiedMembers.preserveOnly.some(
            (memberUid) => !latestMemberUids.includes(memberUid),
          )
        ) {
          throw new SharedScopeChangedError('Profile preservation state changed.');
        }
        const existingMembers = latestData.members || {};
        const preservedMembers: Record<string, any> = {};
        classifiedMembers.preserveOnly.forEach((memberUid, index) => {
          const member = preserveGuards[index * 2];
          const job = preserveGuards[index * 2 + 1];
          const memberState = member.data()?.accountState || 'active';
          const authUser = preservedAuth.get(memberUid)!;
          if (
            !member.exists
            || (!authUser.disabled && !job.exists && memberState === 'active')
          ) {
            throw new SharedScopeChangedError('Preserved profile membership changed.');
          }
          preservedMembers[memberUid] = {
            ...(existingMembers[memberUid] || {}),
            role: 'member',
          };
        });
        transaction.update(initialProfile.ref, {
          memberUids: classifiedMembers.preserveOnly,
          members: preservedMembers,
          lifecycleState: 'archived',
          archivedReason: 'owner_deleted_with_preserved_members',
          archivedAt: FieldValue.serverTimestamp(),
          deleteRequestedBy: FieldValue.delete(),
          deleteRequestedAt: FieldValue.delete(),
          deletePreviousLifecycleState: FieldValue.delete(),
        });
      });
    } else {
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(initialProfile.ref);
        const latestData = latest.data() || {};
        const latestMemberUids = Array.isArray(latestData.memberUids)
          ? latestData.memberUids
          : [];
        const newlyAddedMember = latestMemberUids.some((memberUid: unknown) => (
          typeof memberUid === 'string'
          && memberUid !== uid
          && !memberUids.includes(memberUid)
        ));
        if (
          !latest.exists
          || latestData.ownerId !== uid
          || latestData.lifecycleState !== 'deleting'
          || latestData.deleteRequestedBy !== uid
          || newlyAddedMember
        ) {
          throw new SharedScopeChangedError('Profile membership changed while closing.');
        }
        transaction.update(initialProfile.ref, {
          memberUids: [uid],
          members: {
            [uid]: {
              ...(latestData.members?.[uid] || {}),
              role: 'admin',
            },
          },
        });
      });
      scopes.profileIds.push(initialProfile.id);
    }
  }

  return scopes;
};

/**
 * Runs only after Admin Auth deleted (or confirmed deletion of) `uid`.
 * Shared scopes are accepted only after validateAccountCleanupScopes closed and
 * rechecked them, so customer data belonging to another member is never
 * removed. Descriptors are deleted last and retries are idempotent.
 */
export const cleanupDeletedAccountDocuments = async (
  db: Firestore,
  uid: string,
  scopes: AccountCleanupScopes = { profileIds: [] },
): Promise<void> => {
  // Private legacy records: userId is historical attribution on shared docs,
  // so only records without groupId belong to the deleted account itself.
  for (const collectionName of ['clients', 'debts', 'transfers']) {
    await deleteMatching(
      db,
      collectionName,
      'userId',
      uid,
      (data) => !data.groupId,
    );
  }

  const soleScopeIds = [
    ...(scopes.familyGroupId ? [scopes.familyGroupId] : []),
    ...scopes.profileIds,
  ];
  for (const scopeId of soleScopeIds) {
    for (const collectionName of ['clients', 'debts', 'transfers']) {
      await deleteMatching(db, collectionName, 'groupId', scopeId);
    }
  }

  await deletePromoRedemptionsForUser(db, uid);
  await deleteMatching(db, 'profileCreateRequests', 'ownerId', uid);

  const finalRefs = [
    db.collection('settings').doc(uid),
    db.collection('premiumOverrides').doc(uid),
    db.collection('aiUsage').doc(uid),
    ...DAILY_LOAD_DAYS.map((day) => db.collection('daily_loads').doc(`${uid}_${day}`)),
  ];
  if (scopes.familyGroupId) {
    finalRefs.push(
      db.collection('settings').doc(scopes.familyGroupId),
      db.collection('groups').doc(scopes.familyGroupId),
    );
  }
  if (scopes.familyGroupCode) {
    finalRefs.push(db.collection('groupCodes').doc(scopes.familyGroupCode));
  }
  for (const profileId of scopes.profileIds) {
    const profile = await db.collection('profiles').doc(profileId).get();
    const profileCode = profile.data()?.code;
    if (typeof profileCode === 'string' && profileCode) {
      const codeRef = db.collection('profileCodes').doc(profileCode);
      const reservation = await codeRef.get();
      // A stale/corrupted code must never let account cleanup delete another
      // profile's active reservation.
      if (reservation.exists && reservation.data()?.profileId === profileId) {
        finalRefs.push(codeRef);
      }
    }
    finalRefs.push(
      db.collection('settings').doc(profileId),
      db.collection('profiles').doc(profileId),
    );
  }
  await deleteRefs(db, finalRefs);
  // Never remove this rules-visible marker: a Firebase SDK can retain a valid
  // ID token briefly after Admin Auth deletion. Replacing (not merging) also
  // strips email/name/group/profile metadata and leaves no customer PII.
  await db.collection('users').doc(uid).set({ accountState: 'deleted' });
};
