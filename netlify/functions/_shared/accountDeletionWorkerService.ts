import type { Auth } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import {
  cancelPlanningAccountDeletion,
  cleanupDeletedAccountDocuments,
  deleteAccountDeletionJob,
  loadAccountDeletionJob,
  markAccountDeletionAuthDeleted,
  persistAccountDeletionPlan,
  planAccountDeletion,
  SharedScopeChangedError,
} from './accountCleanupService';

export interface AccountDeletionWorkerStats {
  scanned: number;
  completed: number;
  skipped: number;
  cancelled: number;
  failed: number;
}

interface AccountDeletionWorkerInput {
  db: Firestore;
  adminAuth: Auth;
  maxJobs?: number;
  pageSize?: number;
  maxRuntimeMs?: number;
  now?: () => number;
  plan?: typeof planAccountDeletion;
  persistPlan?: typeof persistAccountDeletionPlan;
  markAuthDeleted?: typeof markAccountDeletionAuthDeleted;
  cancelPlanning?: typeof cancelPlanningAccountDeletion;
  cleanup?: typeof cleanupDeletedAccountDocuments;
  deleteJob?: typeof deleteAccountDeletionJob;
  deleteAuthUser?: (adminAuth: Auth, uid: string) => Promise<void>;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const hasValidPersistedScopes = (data: DocumentData, uid: string): boolean => {
  if (
    data.uid !== uid
    || !['planning', 'planned', 'auth_deleted'].includes(data.state)
    || data.requestedBy !== uid
    || data.requestVersion !== 'recent_auth_v1'
    || data.requestConfirmedAt == null
  ) {
    return false;
  }
  const scopes = data.scopes;
  if (!scopes || typeof scopes !== 'object' || !Array.isArray(scopes.profileIds)) return false;
  if (!scopes.profileIds.every(isNonEmptyString)) return false;
  if (scopes.familyGroupId !== undefined && !isNonEmptyString(scopes.familyGroupId)) return false;
  if (scopes.familyGroupCode !== undefined && !isNonEmptyString(scopes.familyGroupCode)) return false;
  return scopes.familyGroupCode === undefined || scopes.familyGroupId !== undefined;
};

const deleteAuthUserIdempotently = async (adminAuth: Auth, uid: string): Promise<void> => {
  try {
    await adminAuth.deleteUser(uid);
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') return;
    throw error;
  }
};

const rescheduleJob = async (
  candidate: QueryDocumentSnapshot,
  nowMillis: number,
  result: 'failed' | 'invalid_job',
): Promise<void> => {
  const rawAttemptCount = candidate.data()?.workerAttemptCount;
  const attemptCount = Number.isInteger(rawAttemptCount) && rawAttemptCount >= 0
    ? Number(rawAttemptCount)
    : 0;
  const delayMillis = result === 'invalid_job'
    ? 24 * 60 * 60 * 1000
    : Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.min(attemptCount, 6)));
  try {
    await candidate.ref.update({
      workerAttemptCount: FieldValue.increment(1),
      workerNextAttemptAt: Timestamp.fromMillis(nowMillis + delayMillis),
      workerLastResult: result,
      workerLastAttemptAt: FieldValue.serverTimestamp(),
    });
  } catch (error: any) {
    // A foreground retry may have completed and deleted the job first.
    if (error?.code !== 5 && error?.code !== 'not-found') throw error;
  }
};

/**
 * Finishes only durable deletions carrying the recent-auth request proof that
 * beginAccountDeletionJob writes. Planning is resumed and persisted before
 * Auth deletion; planned/auth_deleted jobs reuse only their stored scopes.
 * Failed/invalid jobs get exponential backoff so a low document ID can never
 * starve later deletions. Pagination, a deadline, and a hard cap keep each free
 * invocation bounded without persisting another copy of a user's UID cursor.
 */
export const resumeDeletedAccountJobs = async ({
  db,
  adminAuth,
  maxJobs = 10,
  pageSize = 5,
  maxRuntimeMs = 24_000,
  now = Date.now,
  plan = planAccountDeletion,
  persistPlan = persistAccountDeletionPlan,
  markAuthDeleted = markAccountDeletionAuthDeleted,
  cancelPlanning = cancelPlanningAccountDeletion,
  cleanup = cleanupDeletedAccountDocuments,
  deleteJob = deleteAccountDeletionJob,
  deleteAuthUser = deleteAuthUserIdempotently,
}: AccountDeletionWorkerInput): Promise<AccountDeletionWorkerStats> => {
  const safeMaxJobs = Math.max(1, Math.min(100, Math.floor(maxJobs)));
  const safePageSize = Math.max(1, Math.min(20, Math.floor(pageSize)));
  const stats: AccountDeletionWorkerStats = {
    scanned: 0,
    completed: 0,
    skipped: 0,
    cancelled: 0,
    failed: 0,
  };
  const startedAt = now();

  workerLoop: while (stats.scanned < safeMaxJobs && now() - startedAt < maxRuntimeMs) {
    const currentPageSize = Math.min(safePageSize, safeMaxJobs - stats.scanned);
    const page = db.collection('accountDeletionJobs')
      .where('workerNextAttemptAt', '<=', Timestamp.fromMillis(now()))
      .orderBy('workerNextAttemptAt')
      .limit(currentPageSize);
    const pageSnapshot = await page.get();
    if (pageSnapshot.empty) break;

    for (const candidate of pageSnapshot.docs) {
      if (now() - startedAt >= maxRuntimeMs) break workerLoop;
      stats.scanned += 1;
      const data = candidate.data() || {};
      if (!hasValidPersistedScopes(data, candidate.id)) {
        stats.skipped += 1;
        await rescheduleJob(candidate, now(), 'invalid_job');
        continue;
      }

      try {
        // Re-read through the canonical parser. A foreground retry may have
        // completed or changed the job after this page snapshot.
        const job = await loadAccountDeletionJob(db, candidate.id);
        if (!job) {
          stats.skipped += 1;
          continue;
        }
        let scopes = job.scopes;
        if (job.state === 'planning') {
          try {
            scopes = await plan(db, adminAuth, candidate.id);
            scopes = await persistPlan(db, candidate.id, scopes);
          } catch (error) {
            if (
              error instanceof SharedScopeChangedError
              || (error as { code?: string })?.code === 'SHARED_SCOPE_CHANGED'
            ) {
              if (await cancelPlanning(db, candidate.id)) {
                stats.cancelled += 1;
              } else {
                stats.failed += 1;
                await rescheduleJob(candidate, now(), 'failed').catch(() => undefined);
              }
              continue;
            }
            throw error;
          }
        }
        await deleteAuthUser(adminAuth, candidate.id);
        await markAuthDeleted(db, candidate.id);
        await cleanup(db, candidate.id, scopes);
        await deleteJob(db, candidate.id);
        stats.completed += 1;
      } catch {
        // Jobs are independent and cleanup is idempotent. Keep this job for a
        // later run while continuing the current page without logging a UID.
        stats.failed += 1;
        await rescheduleJob(candidate, now(), 'failed').catch(() => undefined);
      }
    }
  }

  return stats;
};
