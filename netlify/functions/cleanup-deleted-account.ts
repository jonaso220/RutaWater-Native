import type { Config } from '@netlify/functions';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import {
  AccountDeletionJob,
  AccountCleanupScopes,
  beginAccountDeletionJob,
  cancelPlanningAccountDeletion,
  cleanupDeletedAccountDocuments,
  deleteAccountDeletionJob,
  loadAccountDeletionJob,
  markAccountDeletionAuthDeleted,
  planAccountDeletion,
  persistAccountDeletionPlan,
} from './_shared/accountCleanupService';
import { EnvironmentReader, getAdminAuth, getAdminFirestore } from './_shared/firebaseAdmin';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });

const bearerToken = (request: Request): string => {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1] || '';
};

const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;

const deleteAuthUserIdempotently = async (adminAuth: Auth, uid: string): Promise<void> => {
  try {
    await adminAuth.deleteUser(uid);
  } catch (error: any) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
};

export const confirmAuthAdminAccess = async (adminAuth: Auth, uid: string): Promise<void> => {
  try {
    await adminAuth.getUser(uid);
  } catch (error: any) {
    // A previous final call may already have deleted Auth but failed while
    // cleaning Firestore. user-not-found still proves Admin access and must
    // allow the idempotent retry to reach the final cleanup.
    if (error?.code !== 'auth/user-not-found') throw error;
  }
};

export const confirmFirestoreAdminAccess = async (db: Firestore, uid: string): Promise<void> => {
  // A read of the caller's own metadata is harmless and verifies both network
  // reachability and the service account's Datastore permission.
  await db.collection('users').doc(uid).get();
};

interface CleanupHandlerDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string; auth_time?: number }>;
  getAuth: (readEnvironment: EnvironmentReader) => Auth;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  getAuthUser: (adminAuth: Auth, uid: string) => Promise<void>;
  confirmFirestore: (db: Firestore, uid: string) => Promise<void>;
  loadJob: (db: Firestore, uid: string) => Promise<AccountDeletionJob | null>;
  beginJob: (db: Firestore, uid: string) => Promise<AccountDeletionJob>;
  cancelPlanning: (db: Firestore, uid: string) => Promise<boolean>;
  plan: (db: Firestore, adminAuth: Auth, uid: string) => Promise<AccountCleanupScopes>;
  persistPlan: (
    db: Firestore,
    uid: string,
    scopes: AccountCleanupScopes,
  ) => Promise<AccountCleanupScopes>;
  deleteAuthUser: (adminAuth: Auth, uid: string) => Promise<void>;
  markAuthDeleted: (db: Firestore, uid: string) => Promise<void>;
  cleanup: (db: Firestore, uid: string, scopes: AccountCleanupScopes) => Promise<void>;
  deleteJob: (db: Firestore, uid: string) => Promise<void>;
  nowSeconds: () => number;
}

export const createCleanupDeletedAccountHandler = (dependencies: CleanupHandlerDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json(405, { error: 'Method Not Allowed' });
    }

    const token = bearerToken(request);
    let authPayload: { sub: string; auth_time?: number };
    try {
      authPayload = await dependencies.verifyToken(token);
    } catch {
      return json(401, { error: 'No autorizado.' });
    }

    let preflight = false;
    try {
      const body = await request.json();
      preflight = typeof body === 'object'
        && body !== null
        && (body as { preflight?: unknown }).preflight === true;
    } catch {
      // Empty/legacy request bodies mean the final deletion call.
    }

    try {
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      const existingJob = await dependencies.loadJob(db, authPayload.sub);
      const now = dependencies.nowSeconds();
      const recentAuthentication = typeof authPayload.auth_time === 'number'
        && authPayload.auth_time <= now
        && now - authPayload.auth_time <= RECENT_AUTH_MAX_AGE_SECONDS;

      // A valid, still-unexpired token may always finish a durable deletion
      // already begun for its own uid. Fresh authentication is mandatory only
      // to create the initial job, never to resume one after Auth was deleted.
      if (!recentAuthentication && !existingJob) {
        return json(401, {
          error: 'Se requiere volver a iniciar sesión.',
          code: 'RECENT_LOGIN_REQUIRED',
        });
      }

      const adminAuth = dependencies.getAuth(dependencies.readEnvironment);
      if (preflight) {
        await dependencies.getAuthUser(adminAuth, authPayload.sub);
        await dependencies.confirmFirestore(db, authPayload.sub);
        return json(200, { success: true, preflight: true });
      }

      // Verify Auth Admin before the first planning mutation even when a
      // caller skips the app's preflight request.
      await dependencies.getAuthUser(adminAuth, authPayload.sub);
      // beginJob is intentionally called on every final attempt: besides
      // creating/reusing the durable job it atomically installs the permanent
      // rules-visible account tombstone before any shared-scope mutation.
      const job = await dependencies.beginJob(db, authPayload.sub);
      let scopes = job.scopes;
      if (job.state === 'planning') {
        // Close joins, re-read memberships, and transfer only to Auth users
        // that still exist. Persist the proven-private scopes before Auth.
        const plannedScopes = await dependencies.plan(db, adminAuth, authPayload.sub);
        scopes = await dependencies.persistPlan(db, authPayload.sub, plannedScopes);
      }

      await dependencies.deleteAuthUser(adminAuth, authPayload.sub);
      await dependencies.markAuthDeleted(db, authPayload.sub);
      await dependencies.cleanup(db, authPayload.sub, scopes);
      await dependencies.deleteJob(db, authPayload.sub);
      return json(200, { success: true });
    } catch (error) {
      console.error(
        'cleanup-deleted-account error:',
        error instanceof Error ? error.message : 'unknown',
      );
      if ((error as { code?: string })?.code === 'SHARED_SCOPE_CHANGED') {
        try {
          const db = dependencies.getFirestore(dependencies.readEnvironment);
          await dependencies.cancelPlanning(db, authPayload.sub);
        } catch (cancelError) {
          // Keep the durable job for the scheduled worker. Do not let a failed
          // rollback broaden this request into Auth/data deletion.
          console.error(
            'cleanup-deleted-account cancellation error:',
            cancelError instanceof Error ? cancelError.message : 'unknown',
          );
        }
        return json(409, {
          error: 'La membresía compartida cambió. Intentá nuevamente.',
          code: 'SHARED_SCOPE_CHANGED',
        });
      }
      return json(500, { error: 'No se pudo completar la limpieza de la cuenta.' });
    }
  };

const productionHandler = createCleanupDeletedAccountHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getFirestore: getAdminFirestore,
  getAuthUser: confirmAuthAdminAccess,
  confirmFirestore: confirmFirestoreAdminAccess,
  loadJob: loadAccountDeletionJob,
  beginJob: beginAccountDeletionJob,
  cancelPlanning: cancelPlanningAccountDeletion,
  plan: planAccountDeletion,
  persistPlan: persistAccountDeletionPlan,
  deleteAuthUser: deleteAuthUserIdempotently,
  markAuthDeleted: markAccountDeletionAuthDeleted,
  cleanup: cleanupDeletedAccountDocuments,
  deleteJob: deleteAccountDeletionJob,
  nowSeconds: () => Math.floor(Date.now() / 1000),
});

export default productionHandler;

export const config: Config = {
  path: '/api/cleanup-deleted-account',
};
