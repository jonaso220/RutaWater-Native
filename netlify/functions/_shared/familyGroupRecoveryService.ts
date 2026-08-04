import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export const FAMILY_GROUP_RECOVERY_VERSION = 1;

export type FamilyGroupRecoveryStatus =
  | 'recovered'
  | 'already'
  | 'not_found'
  | 'blocked'
  | 'ambiguous';

export interface FamilyGroupRecoveryIdentity {
  uid: string;
  email: string;
  displayName: string;
}

export interface FamilyGroupRecoveryResult {
  status: FamilyGroupRecoveryStatus;
  groupId?: string;
  code?: string;
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const accountIsActive = (data: Record<string, any>): boolean => {
  const state = data.accountState;
  return state === undefined || state === null || state === 'active';
};

/**
 * Repairs only canonical membership metadata for a legacy family-group owner.
 * Business collections and settings are never read or written.
 */
export const recoverLegacyFamilyGroup = async (
  db: Firestore,
  identity: FamilyGroupRecoveryIdentity,
): Promise<FamilyGroupRecoveryResult> => db.runTransaction(async (transaction) => {
  const userRef = db.collection('users').doc(identity.uid);
  const jobRef = db.collection('accountDeletionJobs').doc(identity.uid);
  const ownedGroupsQuery = db.collection('groups')
    .where('adminId', '==', identity.uid)
    .limit(2);

  const [ownedGroups, user, deletionJob] = await Promise.all([
    transaction.get(ownedGroupsQuery),
    transaction.get(userRef),
    transaction.get(jobRef),
  ]);
  const userData = user.data() || {};
  const pendingGroupId = nonEmptyString(userData.pendingGroupId);
  const recoverableJoinFence = pendingGroupId !== null
    && userData.groupMigrationState === 'join_preflight';
  if (
    deletionJob.exists
    || !accountIsActive(userData)
    || (pendingGroupId !== null && !recoverableJoinFence)
  ) {
    return { status: 'blocked' };
  }

  const releaseJoinFence = () => {
    if (!recoverableJoinFence) return;
    transaction.set(userRef, {
      pendingGroupId: FieldValue.delete(),
      groupMigrationState: FieldValue.delete(),
      groupMigrationStartedAt: FieldValue.delete(),
    }, { merge: true });
  };

  const currentGroupId = nonEmptyString(userData.groupId);
  if (ownedGroups.size === 0) {
    // Joining never migrates data. A process cut may leave only this write
    // fence behind, so it is always safe to remove on the next authenticated
    // recovery before returning to the personal scope.
    releaseJoinFence();
    if (currentGroupId) return { status: 'blocked' };
    // Persist the definitive negative lookup so ordinary personal accounts do
    // not spend a free Function invocation on every foreground forever.
    transaction.set(userRef, {
      familyGroupRecoveryVersion: FAMILY_GROUP_RECOVERY_VERSION,
    }, { merge: true });
    return { status: 'not_found' };
  }
  if (ownedGroups.size !== 1) {
    releaseJoinFence();
    return { status: 'ambiguous' };
  }

  const group = ownedGroups.docs[0];
  const groupData = group.data() || {};
  const lifecycleState = groupData.lifecycleState || 'active';
  if (lifecycleState !== 'active') {
    releaseJoinFence();
    return { status: 'blocked' };
  }
  if (currentGroupId && currentGroupId !== group.id) {
    releaseJoinFence();
    return { status: 'ambiguous' };
  }

  // A family group and a custom profile must never share a live scope id.
  // Reading this in the same transaction also conflicts with any conversion.
  const profile = await transaction.get(db.collection('profiles').doc(group.id));
  if (profile.exists) {
    releaseJoinFence();
    return { status: 'blocked' };
  }

  const patch = {
    groupId: group.id,
    role: 'admin',
    email: identity.email,
    displayName: identity.displayName,
    familyGroupRecoveryVersion: FAMILY_GROUP_RECOVERY_VERSION,
    ...(recoverableJoinFence ? {
      pendingGroupId: FieldValue.delete(),
      groupMigrationState: FieldValue.delete(),
      groupMigrationStartedAt: FieldValue.delete(),
    } : {}),
  };
  transaction.set(userRef, patch, { merge: true });

  return {
    status: currentGroupId === group.id ? 'already' : 'recovered',
    groupId: group.id,
    code: typeof groupData.code === 'string' ? groupData.code : '',
  };
});
