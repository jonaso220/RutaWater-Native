import { randomBytes, randomInt } from 'crypto';
import { isDeepStrictEqual } from 'util';
import {
  DocumentData,
  FieldPath,
  FieldValue,
  Firestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { sharedDataScopeKey } from '../../../src/utils/dataScope';

export const GROUP_CREATION_COLLECTIONS = ['clients', 'debts', 'transfers'] as const;
export const GROUP_CREATION_BATCH_SIZE = 450;
// Firebase's no-cost daily write allowance is 20k. Keep at least half for the
// app's normal operation and for migration metadata/settings writes.
export const FREE_GROUP_MIGRATION_DOCUMENT_LIMIT = 8_000;

const GROUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUP_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const GROUP_ID_PATTERN = /^group_[a-f0-9]{32}$/;
export const BACKEND_CREATION_VERSION = 'server_resumable_v1';
const MAX_RESERVATION_ATTEMPTS = 12;

export type GroupCreationCollection = typeof GROUP_CREATION_COLLECTIONS[number];
export type GroupCreationErrorCode =
  | 'ALREADY_IN_GROUP'
  | 'GROUP_STATE_INVALID'
  | 'FREE_MIGRATION_LIMIT'
  | 'RESERVATION_EXHAUSTED'
  | 'RETRY_REQUIRED';

export class GroupCreationError extends Error {
  constructor(public readonly code: GroupCreationErrorCode, message: string) {
    super(message);
    this.name = 'GroupCreationError';
  }
}

class RetryableReservationCollision extends Error {}

export interface GroupCreationIdentity {
  uid: string;
  email: string;
  displayName: string;
}

export interface GroupCreationResult {
  groupId: string;
  code: string;
}

export interface GroupInitialization extends GroupCreationResult {
  alreadyActive: boolean;
}

export type GroupActivationStatus = 'activated' | 'incomplete';

export interface GroupMigrationBatchResult {
  scanned: number;
  migrated: number;
  complete: boolean;
}

export interface GroupCreationOperations {
  initialize(identity: GroupCreationIdentity): Promise<GroupInitialization>;
  migrateNextBatch(input: {
    collectionName: GroupCreationCollection;
    uid: string;
    groupId: string;
  }): Promise<GroupMigrationBatchResult>;
  copyPersonalSettings(input: { uid: string; groupId: string }): Promise<void>;
  activate(input: {
    identity: GroupCreationIdentity;
    groupId: string;
    code: string;
  }): Promise<GroupActivationStatus>;
}

interface FirestoreGroupCreationOptions {
  generateCode?: () => string;
  generateGroupId?: () => string;
  nowMillis?: () => number;
  migrationDocumentLimit?: number;
}

interface GroupCreationRunOptions {
  shouldYield?: () => boolean;
}

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const isUnscoped = (data: DocumentData): boolean => !asNonEmptyString(data.groupId);

const accountCanStartOrResumeCreation = (data: DocumentData): boolean =>
  data.accountState !== 'deleting' && data.accountState !== 'deleted';

const isBackendOwnedActiveGroup = (
  data: DocumentData | undefined,
  uid: string,
): boolean => Boolean(
  data
  && data.adminId === uid
  && data.lifecycleState === 'active'
  && data.creationVersion === BACKEND_CREATION_VERSION,
);

const identityPatch = (identity: GroupCreationIdentity): Record<string, string> => {
  const patch: Record<string, string> = {};
  if (identity.email) patch.email = identity.email;
  if (identity.displayName) patch.displayName = identity.displayName;
  return patch;
};

export const isValidGeneratedGroupCode = (value: unknown): value is string =>
  typeof value === 'string' && GROUP_CODE_PATTERN.test(value);

export const isValidGeneratedGroupId = (value: unknown): value is string =>
  typeof value === 'string' && GROUP_ID_PATTERN.test(value);

export const generateSecureGroupCode = (): string => {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += GROUP_CODE_ALPHABET[randomInt(GROUP_CODE_ALPHABET.length)];
  }
  return code;
};

export const generateSecureGroupId = (): string => `group_${randomBytes(16).toString('hex')}`;

const settingsWereCopied = (
  personal: DocumentData | undefined,
  group: DocumentData | undefined,
): boolean => {
  if (!personal) return true;
  if (!group) return false;
  return Object.entries(personal).every(([key, value]) => isDeepStrictEqual(group[key], value));
};

const validatePendingOwner = (
  userData: DocumentData,
  groupData: DocumentData | undefined,
  uid: string,
  groupId: string,
): void => {
  if (
    !accountCanStartOrResumeCreation(userData)
    || asNonEmptyString(userData.groupId)
    || userData.pendingGroupId !== groupId
    || !groupData
    || groupData.adminId !== uid
    || groupData.lifecycleState !== 'initializing'
    || groupData.creationVersion !== BACKEND_CREATION_VERSION
  ) {
    throw new GroupCreationError(
      'GROUP_STATE_INVALID',
      'La reserva de creación de grupo no es válida.',
    );
  }
};

/**
 * Orchestrates only additive/idempotent operations. If an invocation stops,
 * users/{uid}.pendingGroupId and the initializing group let the next call
 * resume without deleting or duplicating any business document.
 */
export const runResumableGroupCreation = async (
  identity: GroupCreationIdentity,
  operations: GroupCreationOperations,
  options: GroupCreationRunOptions = {},
): Promise<GroupCreationResult> => {
  if (!identity.uid) throw new GroupCreationError('GROUP_STATE_INVALID', 'UID requerido.');

  const initialization = await operations.initialize(identity);
  if (initialization.alreadyActive) {
    return { groupId: initialization.groupId, code: initialization.code };
  }

  // pendingGroupId is the write fence: security rules evaluate it at commit
  // time and reject new personal writes. Each collection therefore needs one
  // durable ordered pass, not repeated scans from the beginning.
  for (const collectionName of GROUP_CREATION_COLLECTIONS) {
    let complete = false;
    while (!complete) {
      if (options.shouldYield?.()) {
        throw new GroupCreationError(
          'RETRY_REQUIRED',
          'La migración continuará en otra invocación.',
        );
      }
      const migration = await operations.migrateNextBatch({
        collectionName,
        uid: identity.uid,
        groupId: initialization.groupId,
      });
      complete = migration.complete;
      if (!complete && migration.scanned === 0) {
        throw new GroupCreationError(
          'RETRY_REQUIRED',
          'La migración no avanzó y se debe reintentar.',
        );
      }
      if (!complete && options.shouldYield?.()) {
        throw new GroupCreationError(
          'RETRY_REQUIRED',
          'La migración continuará en otra invocación.',
        );
      }
    }
  }

  await operations.copyPersonalSettings({
    uid: identity.uid,
    groupId: initialization.groupId,
  });

  const activation = await operations.activate({
    identity,
    groupId: initialization.groupId,
    code: initialization.code,
  });
  if (activation === 'activated') {
    return { groupId: initialization.groupId, code: initialization.code };
  }

  throw new GroupCreationError(
    'RETRY_REQUIRED',
    'La migración sigue recibiendo escrituras personales; se debe reintentar.',
  );
};

export const createFirestoreGroupCreationOperations = (
  db: Firestore,
  options: FirestoreGroupCreationOptions = {},
): GroupCreationOperations => {
  const generateCode = options.generateCode || generateSecureGroupCode;
  const generateGroupId = options.generateGroupId || generateSecureGroupId;
  const nowMillis = options.nowMillis || Date.now;
  const migrationDocumentLimit = options.migrationDocumentLimit
    ?? FREE_GROUP_MIGRATION_DOCUMENT_LIMIT;

  const initialize = async (identity: GroupCreationIdentity): Promise<GroupInitialization> => {
    // Count before reserving pendingGroupId. An over-limit request performs no
    // writes at all, so it cannot strand the account behind the write fence.
    // `userId` is an intentionally conservative upper bound: it may include
    // already-shared attribution, but it can never undercount legacy personal
    // records whose groupId/scopeKey field is absent.
    const userRef = db.collection('users').doc(identity.uid);
    const deletionJobRef = db.collection('accountDeletionJobs').doc(identity.uid);
    const [preflightUser, preflightDeletionJob] = await db.getAll(userRef, deletionJobRef);
    const preflightData = preflightUser.data() || {};
    if (!accountCanStartOrResumeCreation(preflightData) || preflightDeletionJob.exists) {
      throw new GroupCreationError(
        'GROUP_STATE_INVALID',
        'La cuenta se está eliminando y no puede crear un grupo.',
      );
    }
    if (!asNonEmptyString(preflightData.groupId) && !asNonEmptyString(preflightData.pendingGroupId)) {
      const counts = await Promise.all(GROUP_CREATION_COLLECTIONS.map(async (collectionName) => {
        const aggregate = await db.collection(collectionName)
          .where('userId', '==', identity.uid)
          .count()
          .get();
        return aggregate.data().count;
      }));
      const attributedDocumentCount = counts.reduce((total, count) => total + count, 0);
      if (attributedDocumentCount > migrationDocumentLimit) {
        throw new GroupCreationError(
          'FREE_MIGRATION_LIMIT',
          'La migración supera el presupuesto gratuito configurado.',
        );
      }
    }

    for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt += 1) {
      const candidateGroupId = generateGroupId();
      const candidateCode = generateCode();
      if (!isValidGeneratedGroupId(candidateGroupId) || !isValidGeneratedGroupCode(candidateCode)) {
        throw new GroupCreationError(
          'GROUP_STATE_INVALID',
          'El generador produjo una reserva inválida.',
        );
      }

      try {
        return await db.runTransaction(async (transaction) => {
          const userRef = db.collection('users').doc(identity.uid);
          const userSnapshot = await transaction.get(userRef);
          const deletionJob = await transaction.get(
            db.collection('accountDeletionJobs').doc(identity.uid),
          );
          const userData = userSnapshot.data() || {};
          if (!accountCanStartOrResumeCreation(userData) || deletionJob.exists) {
            throw new GroupCreationError(
              'GROUP_STATE_INVALID',
              'La cuenta se está eliminando y no puede crear un grupo.',
            );
          }
          const currentGroupId = asNonEmptyString(userData.groupId);

          // A retry after the final response was lost is an idempotent success,
          // but an existing legacy/foreign membership must never be replaced.
          if (currentGroupId) {
            const currentGroup = await transaction.get(db.collection('groups').doc(currentGroupId));
            const currentData = currentGroup.data();
            if (
              userData.role === 'admin'
              && isBackendOwnedActiveGroup(currentData, identity.uid)
              && isValidGeneratedGroupCode(currentData?.code)
            ) {
              if (asNonEmptyString(userData.pendingGroupId)) {
                transaction.set(userRef, {
                  pendingGroupId: FieldValue.delete(),
                  groupMigrationState: FieldValue.delete(),
                  groupMigrationStartedAt: FieldValue.delete(),
                }, { merge: true });
              }
              return {
                groupId: currentGroupId,
                code: currentData.code,
                alreadyActive: true,
              };
            }
            throw new GroupCreationError(
              'ALREADY_IN_GROUP',
              'El usuario ya pertenece a otro grupo.',
            );
          }

          const pendingGroupId = asNonEmptyString(userData.pendingGroupId);
          const groupId = pendingGroupId || candidateGroupId;
          const groupRef = db.collection('groups').doc(groupId);
          const profileRef = db.collection('profiles').doc(groupId);
          const groupSnapshot = await transaction.get(groupRef);
          const profileSnapshot = await transaction.get(profileRef);

          if (profileSnapshot.exists) {
            if (pendingGroupId) {
              throw new GroupCreationError(
                'GROUP_STATE_INVALID',
                'El ID pendiente ya corresponde a un reparto preservado.',
              );
            }
            throw new RetryableReservationCollision('Group ID already used by a profile.');
          }
          if (groupSnapshot.exists && !pendingGroupId) {
            throw new RetryableReservationCollision('Group ID already exists.');
          }

          const existingGroup = groupSnapshot.data();
          if (
            existingGroup
            && (
              existingGroup.adminId !== identity.uid
              || existingGroup.lifecycleState !== 'initializing'
              || existingGroup.creationVersion !== BACKEND_CREATION_VERSION
            )
          ) {
            throw new GroupCreationError(
              'GROUP_STATE_INVALID',
              'El grupo pendiente no pertenece a esta operación.',
            );
          }

          const code = existingGroup?.code ?? candidateCode;
          if (!isValidGeneratedGroupCode(code)) {
            throw new GroupCreationError('GROUP_STATE_INVALID', 'El código reservado no es válido.');
          }

          const codeRef = db.collection('groupCodes').doc(code);
          const codeSnapshot = await transaction.get(codeRef);
          const groupsWithCode = await transaction.get(
            db.collection('groups').where('code', '==', code).limit(2),
          );
          const codeOwner = asNonEmptyString(codeSnapshot.data()?.groupId);
          const duplicateGroup = groupsWithCode.docs.some((doc) => doc.id !== groupId);
          if ((codeOwner && codeOwner !== groupId) || duplicateGroup) {
            if (pendingGroupId) {
              throw new GroupCreationError(
                'GROUP_STATE_INVALID',
                'El código del grupo pendiente dejó de ser único.',
              );
            }
            throw new RetryableReservationCollision('Group code already exists.');
          }

          const now = Timestamp.fromMillis(nowMillis());
          if (!groupSnapshot.exists) {
            transaction.create(groupRef, {
              code,
              adminId: identity.uid,
              adminEmail: identity.email,
              adminName: identity.displayName,
              createdAt: now,
              lifecycleState: 'initializing',
              creationVersion: BACKEND_CREATION_VERSION,
              migrationCursors: {},
              migrationCompleted: {
                clients: false,
                debts: false,
                transfers: false,
              },
            });
          }
          if (!codeSnapshot.exists) {
            transaction.create(codeRef, {
              groupId,
              ownerId: identity.uid,
              createdAt: now,
            });
          }
          transaction.set(userRef, {
            ...identityPatch(identity),
            pendingGroupId: groupId,
            groupMigrationState: 'initializing',
            groupMigrationStartedAt: userData.groupMigrationStartedAt || now,
          }, { merge: true });

          return { groupId, code, alreadyActive: false };
        });
      } catch (error) {
        if (error instanceof RetryableReservationCollision) continue;
        throw error;
      }
    }

    throw new GroupCreationError(
      'RESERVATION_EXHAUSTED',
      'No fue posible reservar un identificador único.',
    );
  };

  const migrateNextBatch: GroupCreationOperations['migrateNextBatch'] = async ({
    collectionName,
    uid,
    groupId,
  }) => {
    return db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const groupRef = db.collection('groups').doc(groupId);
      const profileRef = db.collection('profiles').doc(groupId);
      const userSnapshot = await transaction.get(userRef);
      const groupSnapshot = await transaction.get(groupRef);
      const profileSnapshot = await transaction.get(profileRef);
      const groupData = groupSnapshot.data();
      validatePendingOwner(userSnapshot.data() || {}, groupData, uid, groupId);
      if (profileSnapshot.exists) {
        throw new GroupCreationError(
          'GROUP_STATE_INVALID',
          'El ID del grupo fue ocupado por un reparto durante la migración.',
        );
      }

      const completed = groupData?.migrationCompleted?.[collectionName] === true;
      if (completed) return { scanned: 0, migrated: 0, complete: true };

      const cursor = asNonEmptyString(groupData?.migrationCursors?.[collectionName]);
      let query = db
        .collection(collectionName)
        .where('userId', '==', uid)
        .orderBy(FieldPath.documentId())
        .limit(GROUP_CREATION_BATCH_SIZE);
      if (cursor) query = query.startAfter(cursor);
      // Query inside the transaction gives every candidate the same current
      // snapshot used by the writes; a concurrent transaction retries from
      // the durable cursor instead of overwriting another scope.
      const page = await transaction.get(query);

      let migrated = 0;
      for (const document of page.docs) {
        const data = document.data();
        if (data?.userId === uid && isUnscoped(data)) {
          // Move authorization scope together with groupId. userId remains
          // immutable creator attribution and must never be used as the new
          // shared-scope key.
          transaction.update(document.ref, {
            groupId,
            scopeKey: sharedDataScopeKey(groupId),
          });
          migrated += 1;
        }
      }

      const complete = page.size < GROUP_CREATION_BATCH_SIZE;
      const lastId = page.docs[page.docs.length - 1]?.id;
      transaction.update(groupRef, {
        [`migrationCompleted.${collectionName}`]: complete,
        [`migrationCursors.${collectionName}`]: complete || !lastId
          ? FieldValue.delete()
          : lastId,
      });
      return { scanned: page.size, migrated, complete };
    });
  };

  const copyPersonalSettings: GroupCreationOperations['copyPersonalSettings'] = async ({
    uid,
    groupId,
  }) => db.runTransaction(async (transaction) => {
    const userRef = db.collection('users').doc(uid);
    const groupRef = db.collection('groups').doc(groupId);
    const profileRef = db.collection('profiles').doc(groupId);
    const personalSettingsRef = db.collection('settings').doc(uid);
    const groupSettingsRef = db.collection('settings').doc(groupId);
    const userSnapshot = await transaction.get(userRef);
    const groupSnapshot = await transaction.get(groupRef);
    const profileSnapshot = await transaction.get(profileRef);
    const personalSettings = await transaction.get(personalSettingsRef);
    await transaction.get(groupSettingsRef);

    validatePendingOwner(userSnapshot.data() || {}, groupSnapshot.data(), uid, groupId);
    if (profileSnapshot.exists) {
      throw new GroupCreationError(
        'GROUP_STATE_INVALID',
        'El ID del grupo fue ocupado por un reparto durante la migración.',
      );
    }
    if (personalSettings.exists) {
      transaction.set(groupSettingsRef, personalSettings.data() || {}, { merge: true });
    }
  });

  const activate: GroupCreationOperations['activate'] = async ({ identity, groupId, code }) =>
    db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(identity.uid);
      const groupRef = db.collection('groups').doc(groupId);
      const profileRef = db.collection('profiles').doc(groupId);
      const codeRef = db.collection('groupCodes').doc(code);
      const personalSettingsRef = db.collection('settings').doc(identity.uid);
      const groupSettingsRef = db.collection('settings').doc(groupId);

      const userSnapshot = await transaction.get(userRef);
      const groupSnapshot = await transaction.get(groupRef);
      const profileSnapshot = await transaction.get(profileRef);
      const codeSnapshot = await transaction.get(codeRef);
      const personalSettings = await transaction.get(personalSettingsRef);
      const groupSettings = await transaction.get(groupSettingsRef);

      const userData = userSnapshot.data() || {};
      if (!accountCanStartOrResumeCreation(userData)) {
        throw new GroupCreationError(
          'GROUP_STATE_INVALID',
          'La cuenta se está eliminando y no puede activar un grupo.',
        );
      }
      const groupData = groupSnapshot.data();
      const currentGroupId = asNonEmptyString(userData.groupId);
      if (
        currentGroupId === groupId
        && userData.role === 'admin'
        && isBackendOwnedActiveGroup(groupData, identity.uid)
      ) {
        return 'activated';
      }
      if (currentGroupId) {
        throw new GroupCreationError('ALREADY_IN_GROUP', 'El usuario ya pertenece a otro grupo.');
      }

      validatePendingOwner(userData, groupData, identity.uid, groupId);
      if (
        profileSnapshot.exists
        || groupData?.code !== code
        || codeSnapshot.data()?.groupId !== groupId
      ) {
        throw new GroupCreationError(
          'GROUP_STATE_INVALID',
          'La reserva del grupo cambió antes de activarse.',
        );
      }

      const migrationComplete = GROUP_CREATION_COLLECTIONS.every(
        (collectionName) => groupData?.migrationCompleted?.[collectionName] === true,
      );
      if (
        !migrationComplete
        || !settingsWereCopied(personalSettings.data(), groupSettings.data())
      ) {
        return 'incomplete';
      }

      const now = Timestamp.fromMillis(nowMillis());
      transaction.set(userRef, {
        ...identityPatch(identity),
        groupId,
        role: 'admin',
        pendingGroupId: FieldValue.delete(),
        groupMigrationState: FieldValue.delete(),
        groupMigrationStartedAt: FieldValue.delete(),
      }, { merge: true });
      transaction.update(groupRef, {
        lifecycleState: 'active',
        activatedAt: now,
        migrationCursors: FieldValue.delete(),
        migrationCompleted: FieldValue.delete(),
      });
      return 'activated';
    });

  return {
    initialize,
    migrateNextBatch,
    copyPersonalSettings,
    activate,
  };
};

export const createGroupWithFirestore = async (input: {
  db: Firestore;
  identity: GroupCreationIdentity;
  maxRuntimeMs?: number;
  nowMillis?: () => number;
}): Promise<GroupCreationResult> => {
  const nowMillis = input.nowMillis || Date.now;
  const startedAt = nowMillis();
  const maxRuntimeMs = input.maxRuntimeMs ?? 18_000;
  return runResumableGroupCreation(
    input.identity,
    createFirestoreGroupCreationOperations(input.db),
    { shouldYield: () => nowMillis() - startedAt >= maxRuntimeMs },
  );
};
