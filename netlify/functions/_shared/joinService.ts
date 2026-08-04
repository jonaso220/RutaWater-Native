import {
  FieldValue,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import {
  normalizeInviteCode,
  PROFILE_CODE_RESERVATION_VERSION,
} from './profileInviteCode';

export { normalizeInviteCode } from './profileInviteCode';

export type JoinStatus = 'ok' | 'not_found' | 'already' | 'has_personal_data' | 'error';

const isActive = (data: DocumentData): boolean =>
  // Profiles created by older app versions did not persist lifecycleState.
  // Treat that legacy shape as active while rejecting every explicit closing
  // state. New documents always write `active`.
  data.lifecycleState === undefined || data.lifecycleState === 'active';

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const accountCanJoin = (data: DocumentData | undefined): boolean => {
  const state = data?.accountState;
  const pendingGroupId = data?.pendingGroupId;
  const hasPendingGroup = typeof pendingGroupId === 'string' && pendingGroupId.trim().length > 0;
  return !hasPendingGroup && (state === undefined || state === null || state === 'active');
};

const accountIsActive = (data: DocumentData | undefined): boolean => {
  const state = data?.accountState;
  return state === undefined || state === null || state === 'active';
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const isPersonalBusinessDocument = (data: DocumentData): boolean =>
  asNonEmptyString(data.groupId) === null;

const hasPersonalGroupJoinData = async (db: Firestore, uid: string): Promise<boolean> => {
  const [clients, debts, transfers] = await Promise.all([
    db.collection('clients').where('userId', '==', uid).get(),
    db.collection('debts').where('userId', '==', uid).get(),
    db.collection('transfers').where('userId', '==', uid).get(),
  ]);

  return clients.docs.some((doc) => isPersonalBusinessDocument(doc.data()))
    || debts.docs.some((doc) => isPersonalBusinessDocument(doc.data()))
    || transfers.docs.some((doc) => isPersonalBusinessDocument(doc.data()));
};

const clearGroupJoinReservation = async (
  db: Firestore,
  uid: string,
  groupId: string,
): Promise<void> => {
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async (transaction) => {
    const user = await transaction.get(userRef);
    const data = user.data() || {};
    if (
      data.pendingGroupId !== groupId
      || data.groupMigrationState !== 'join_preflight'
    ) return;

    transaction.set(userRef, {
      pendingGroupId: FieldValue.delete(),
      groupMigrationState: FieldValue.delete(),
      groupMigrationStartedAt: FieldValue.delete(),
    }, { merge: true });
  });
};

interface GroupJoinReservation {
  status?: JoinStatus;
  groupId?: string;
}

interface JoinInput {
  db: Firestore;
  uid: string;
  code: string;
  scanPersonalData?: (db: Firestore, uid: string) => Promise<boolean>;
}

export const joinGroupByCode = async ({
  db,
  uid,
  code,
  scanPersonalData = hasPersonalGroupJoinData,
}: JoinInput): Promise<JoinStatus> => {
  if (!uid || !normalizeInviteCode(code)) throw new Error('Join input inválido.');

  const normalizedCode = normalizeInviteCode(code)!;
  const groupQuery = db.collection('groups').where('code', '==', normalizedCode).limit(2);
  const userRef = db.collection('users').doc(uid);
  const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);

  // Phase 1 atomically reserves the requested group on users/{uid}. Firestore
  // rules use pendingGroupId as a write fence, so personal route writes
  // cannot appear while the server checks whether joining would hide data.
  const reservation = await db.runTransaction<GroupJoinReservation>(async (transaction) => {
    const groups = await transaction.get(groupQuery);
    if (groups.size !== 1) return { status: 'not_found' };

    const group = groups.docs[0];
    if (!isActive(group.data())) return { status: 'not_found' };

    const user = await transaction.get(userRef);
    const deletionJob = await transaction.get(deletionJobRef);
    const userData = user.data() || {};
    if (deletionJob.exists || !accountIsActive(user.data())) return { status: 'error' };

    const currentGroupId = asNonEmptyString(userData.groupId);
    const canonicalRole = group.data().adminId === uid ? 'admin' : 'member';
    if (currentGroupId === group.id) {
      const ownsStaleJoinReservation = userData.pendingGroupId === group.id
        && userData.groupMigrationState === 'join_preflight';
      // Legacy/corrupted caches must not demote the canonical group owner in
      // useAuth. Repair only the role derived from the server-owned group doc.
      if (userData.role !== canonicalRole || ownsStaleJoinReservation) {
        transaction.set(userRef, {
          role: canonicalRole,
          ...(ownsStaleJoinReservation ? {
            pendingGroupId: FieldValue.delete(),
            groupMigrationState: FieldValue.delete(),
            groupMigrationStartedAt: FieldValue.delete(),
          } : {}),
        }, { merge: true });
      }
      return { status: 'already' };
    }
    if (currentGroupId) return { status: 'error' };

    const pendingGroupId = asNonEmptyString(userData.pendingGroupId);
    if (pendingGroupId) {
      // A retry for the same preflight resumes safely. A different code, or a
      // family-group creation in progress, can never steal the reservation.
      if (
        pendingGroupId === group.id
        && userData.groupMigrationState === 'join_preflight'
      ) return { groupId: group.id };
      return { status: 'error' };
    }

    transaction.set(userRef, {
      pendingGroupId: group.id,
      groupMigrationState: 'join_preflight',
      groupMigrationStartedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { groupId: group.id };
  });

  if (reservation.status) return reservation.status;
  const groupId = reservation.groupId;
  if (!groupId) return 'error';

  // No document is moved or deleted. Personal settings intentionally remain at
  // settings/{uid}: StoreSync reads the group's settings while joined and uses
  // these private settings again after leaving. Only personal route/business
  // data would become hidden, so only that data blocks activation.
  try {
    if (await scanPersonalData(db, uid)) {
      await clearGroupJoinReservation(db, uid, groupId);
      return 'has_personal_data';
    }
  } catch (error) {
    // A normal exception must not strand the account behind the write fence.
    // A hard process termination is repaired canonically by the login recovery
    // endpoint, which recognizes join_preflight as safe to discard.
    await clearGroupJoinReservation(db, uid, groupId).catch(() => undefined);
    throw error;
  }

  // Phase 2 revalidates every mutable decision immediately before activation.
  // The pending marker continues to block client writes until this transaction
  // clears it together with the new canonical membership.
  return db.runTransaction<JoinStatus>(async (transaction) => {
    const groupRef = db.collection('groups').doc(groupId);
    const [group, user, deletionJob] = await Promise.all([
      transaction.get(groupRef),
      transaction.get(userRef),
      transaction.get(deletionJobRef),
    ]);
    const userData = user.data() || {};
    const currentGroupId = asNonEmptyString(userData.groupId);
    const groupData = group.data() || {};
    const ownsReservation = userData.pendingGroupId === groupId
      && userData.groupMigrationState === 'join_preflight';

    if (currentGroupId === groupId) {
      if (deletionJob.exists || !accountIsActive(user.data())) {
        if (ownsReservation) {
          transaction.set(userRef, {
            pendingGroupId: FieldValue.delete(),
            groupMigrationState: FieldValue.delete(),
            groupMigrationStartedAt: FieldValue.delete(),
          }, { merge: true });
        }
        return 'error';
      }
      if (!group.exists || groupData.code !== normalizedCode || !isActive(groupData)) {
        if (ownsReservation) {
          transaction.set(userRef, {
            pendingGroupId: FieldValue.delete(),
            groupMigrationState: FieldValue.delete(),
            groupMigrationStartedAt: FieldValue.delete(),
          }, { merge: true });
        }
        return 'not_found';
      }
      const canonicalRole = groupData.adminId === uid ? 'admin' : 'member';
      transaction.set(userRef, {
        role: canonicalRole,
        ...(ownsReservation ? {
          pendingGroupId: FieldValue.delete(),
          groupMigrationState: FieldValue.delete(),
          groupMigrationStartedAt: FieldValue.delete(),
        } : {}),
      }, { merge: true });
      return 'already';
    }

    if (!ownsReservation) return 'error';

    if (deletionJob.exists || !accountIsActive(user.data()) || currentGroupId) {
      transaction.set(userRef, {
        pendingGroupId: FieldValue.delete(),
        groupMigrationState: FieldValue.delete(),
        groupMigrationStartedAt: FieldValue.delete(),
      }, { merge: true });
      return 'error';
    }

    if (!group.exists || groupData.code !== normalizedCode || !isActive(groupData)) {
      transaction.set(userRef, {
        pendingGroupId: FieldValue.delete(),
        groupMigrationState: FieldValue.delete(),
        groupMigrationStartedAt: FieldValue.delete(),
      }, { merge: true });
      return 'not_found';
    }

    const canonicalRole = groupData.adminId === uid ? 'admin' : 'member';
    transaction.set(userRef, {
      groupId,
      role: canonicalRole,
      pendingGroupId: FieldValue.delete(),
      groupMigrationState: FieldValue.delete(),
      groupMigrationStartedAt: FieldValue.delete(),
    }, { merge: true });
    return 'ok';
  });
};

export const joinProfileByCode = async ({ db, uid, code }: JoinInput): Promise<JoinStatus> => {
  if (!uid || !normalizeInviteCode(code)) throw new Error('Join input inválido.');

  const normalizedCode = normalizeInviteCode(code)!;
  const codeRef = db.collection('profileCodes').doc(normalizedCode);
  const legacyProfileQuery = db.collection('profiles').where('code', '==', normalizedCode).limit(2);
  const userRef = db.collection('users').doc(uid);
  const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);

  return db.runTransaction(async (transaction) => {
    const reservation = await transaction.get(codeRef);
    const reservationData = reservation.data() || {};
    let profile: DocumentSnapshot;
    let shouldBackfillReservation = false;
    if (reservation.exists) {
      if (
        reservationData.state !== 'active'
        || typeof reservationData.profileId !== 'string'
      ) return 'not_found';
      profile = await transaction.get(db.collection('profiles').doc(reservationData.profileId));
    } else {
      // Controlled migration window: only a single legacy profile without the
      // server marker may claim an unreserved code. New profiles never query.
      const legacyProfiles = await transaction.get(legacyProfileQuery);
      if (legacyProfiles.size !== 1) return 'not_found';
      profile = legacyProfiles.docs[0];
      if (profile.data().codeReservationVersion === PROFILE_CODE_RESERVATION_VERSION) {
        return 'not_found';
      }
      shouldBackfillReservation = true;
    }

    if (!profile.exists) return 'not_found';
    const profileData = profile.data() || {};
    if (
      !isActive(profileData)
      || profileData.code !== normalizedCode
      || typeof profileData.ownerId !== 'string'
      || !profileData.ownerId
      || (reservation.exists && reservationData.ownerId !== profileData.ownerId)
    ) return 'not_found';

    const user = await transaction.get(userRef);
    const deletionJob = await transaction.get(deletionJobRef);
    const userData = user.data() || {};
    if (deletionJob.exists || !accountCanJoin(user.data())) return 'error';
    const memberUids = stringArray(profileData.memberUids);
    const profileIds = stringArray(userData.profileIds);
    if (shouldBackfillReservation) {
      transaction.create(codeRef, {
        profileId: profile.id,
        ownerId: profileData.ownerId,
        state: 'active',
        reservationVersion: PROFILE_CODE_RESERVATION_VERSION,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(profile.ref, {
        codeReservationVersion: PROFILE_CODE_RESERVATION_VERSION,
      });
    }
    if (memberUids.includes(uid)) {
      if (!profileIds.includes(profile.id)) {
        transaction.set(userRef, {
          profileIds: [...profileIds, profile.id],
        }, { merge: true });
      }
      return 'already';
    }

    // Account metadata is read canonically, never accepted from the request.
    // This read is also in the transaction so the optional profileIds cache is
    // merged without losing a concurrent profile membership.
    const members = profileData.members && typeof profileData.members === 'object'
      ? profileData.members
      : {};
    transaction.update(profile.ref, {
      memberUids: [...memberUids, uid],
      members: {
        ...members,
        [uid]: {
          role: 'member',
          name: typeof userData.displayName === 'string' ? userData.displayName : '',
          email: typeof userData.email === 'string' ? userData.email : '',
        },
      },
    });
    transaction.set(userRef, {
      profileIds: profileIds.includes(profile.id)
        ? profileIds
        : [...profileIds, profile.id],
    }, { merge: true });
    return 'ok';
  });
};
