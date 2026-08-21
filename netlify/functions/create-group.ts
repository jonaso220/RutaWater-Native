import type { Config } from '@netlify/functions';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import {
  EnvironmentReader,
  getAdminAuth,
  getAdminFirestore,
} from './_shared/firebaseAdmin';
import {
  createGroupWithFirestore,
  GroupCreationError,
  GroupCreationIdentity,
  GroupCreationResult,
} from './_shared/groupCreationService';

const { AiPlanUnavailableError, resolveAiPlan } = require('./_shared/aiQuota');

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

interface ConfirmedAdminUser {
  uid: string;
  email: string;
  displayName: string;
}

interface CreateGroupHandlerDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getAuth: (readEnvironment: EnvironmentReader) => Auth;
  getAuthUser: (adminAuth: Auth, uid: string) => Promise<ConfirmedAdminUser>;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  resolvePlan: (input: {
    db: Firestore;
    uid: string;
    readEnvironment: EnvironmentReader;
    fetchImpl?: typeof fetch;
    nowMillis?: number;
  }) => Promise<'free' | 'monthly' | 'annual'>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  createGroup: (input: {
    db: Firestore;
    identity: GroupCreationIdentity;
  }) => Promise<GroupCreationResult>;
}

export const confirmCreateGroupAuthUser = async (
  adminAuth: Auth,
  uid: string,
): Promise<ConfirmedAdminUser> => {
  const user: UserRecord = await adminAuth.getUser(uid);
  if (user.disabled) {
    throw Object.assign(new Error('Firebase Auth user disabled.'), { code: 'auth/user-disabled' });
  }
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
  };
};

const isInactiveAuthAccountError = (error: unknown): boolean => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === 'auth/user-not-found' || code === 'auth/user-disabled';
};

export const createCreateGroupHandler = (dependencies: CreateGroupHandlerDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json(405, { success: false, code: 'METHOD_NOT_ALLOWED' });
    }

    let authPayload: { sub: string };
    try {
      authPayload = await dependencies.verifyToken(bearerToken(request));
    } catch {
      return json(401, { success: false, code: 'UNAUTHORIZED' });
    }

    // A signed ID token can remain valid briefly after account deletion. Ask
    // Firebase Auth for the canonical live user before any Admin Firestore
    // write, and derive all identity fields from that trusted record.
    let adminAuth: Auth;
    try {
      adminAuth = dependencies.getAuth(dependencies.readEnvironment);
    } catch (error) {
      console.error(
        'create-group Auth configuration error:',
        error instanceof Error ? error.message : 'unknown',
      );
      return json(500, { success: false, code: 'SERVER_ERROR' });
    }

    let confirmedUser: ConfirmedAdminUser;
    try {
      confirmedUser = await dependencies.getAuthUser(adminAuth, authPayload.sub);
      if (confirmedUser.uid !== authPayload.sub) {
        throw new Error('Admin Auth UID mismatch.');
      }
    } catch (error) {
      if (!isInactiveAuthAccountError(error)) {
        console.error(
          'create-group Auth lookup error:',
          error instanceof Error ? error.message : 'unknown',
        );
        return json(500, { success: false, code: 'SERVER_ERROR' });
      }
      return json(401, { success: false, code: 'UNAUTHORIZED' });
    }

    try {
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      const plan = await dependencies.resolvePlan({
        db,
        uid: confirmedUser.uid,
        readEnvironment: dependencies.readEnvironment,
        fetchImpl: dependencies.fetchImpl,
        nowMillis: (dependencies.now?.() || new Date()).getTime(),
      });
      if (plan === 'free') {
        return json(403, { success: false, code: 'PREMIUM_REQUIRED' });
      }
      const result = await dependencies.createGroup({
        db,
        identity: confirmedUser,
      });
      return json(200, {
        success: true,
        groupId: result.groupId,
        code: result.code,
      });
    } catch (error) {
      const planUnavailable = error instanceof AiPlanUnavailableError
        || (error instanceof Error && error.name === 'AiPlanUnavailableError');
      if (planUnavailable) {
        return json(503, { success: false, code: 'PLAN_UNAVAILABLE' });
      }
      if (error instanceof GroupCreationError) {
        if (error.code === 'ALREADY_IN_GROUP') {
          return json(409, { success: false, code: 'ALREADY_IN_GROUP' });
        }
        if (error.code === 'RETRY_REQUIRED') {
          // Cooperative continuation, not a server failure. The phone retries
          // with backoff and the durable collection cursor resumes next page.
          return json(202, {
            success: false,
            code: 'RETRY_REQUIRED',
            retryAfterMs: 750,
          });
        }
        if (error.code === 'FREE_MIGRATION_LIMIT') {
          return json(422, { success: false, code: 'FREE_MIGRATION_LIMIT' });
        }
      }
      // Never log request bodies, bearer tokens, group codes, or group IDs.
      console.error(
        'create-group error:',
        error instanceof Error ? error.message : 'unknown',
      );
      return json(500, { success: false, code: 'SERVER_ERROR' });
    }
  };

const productionHandler = createCreateGroupHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getAuthUser: confirmCreateGroupAuthUser,
  getFirestore: getAdminFirestore,
  resolvePlan: resolveAiPlan,
  createGroup: createGroupWithFirestore,
});

export default productionHandler;

export const config: Config = {
  path: '/api/create-group',
};
