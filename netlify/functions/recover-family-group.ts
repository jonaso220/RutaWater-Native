import type { Config } from '@netlify/functions';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import {
  FamilyGroupRecoveryIdentity,
  FamilyGroupRecoveryResult,
  recoverLegacyFamilyGroup,
} from './_shared/familyGroupRecoveryService';
import {
  EnvironmentReader,
  getAdminAuth,
  getAdminFirestore,
} from './_shared/firebaseAdmin';

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

interface RecoveryHandlerDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getAuth: (readEnvironment: EnvironmentReader) => Auth;
  getAuthUser: (adminAuth: Auth, uid: string) => Promise<FamilyGroupRecoveryIdentity>;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  recover: (
    db: Firestore,
    identity: FamilyGroupRecoveryIdentity,
  ) => Promise<FamilyGroupRecoveryResult>;
}

export const confirmRecoveryAuthUser = async (
  adminAuth: Auth,
  uid: string,
): Promise<FamilyGroupRecoveryIdentity> => {
  const user: UserRecord = await adminAuth.getUser(uid);
  if (user.disabled) {
    throw Object.assign(new Error('Firebase Auth user disabled.'), {
      code: 'auth/user-disabled',
    });
  }
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
  };
};

export const createRecoverFamilyGroupHandler = (dependencies: RecoveryHandlerDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json(405, { success: false, status: 'blocked' });
    }

    let authPayload: { sub: string };
    try {
      authPayload = await dependencies.verifyToken(bearerToken(request));
    } catch {
      return json(401, { success: false, status: 'blocked' });
    }

    try {
      const adminAuth = dependencies.getAuth(dependencies.readEnvironment);
      const identity = await dependencies.getAuthUser(adminAuth, authPayload.sub);
      if (identity.uid !== authPayload.sub) throw new Error('Admin Auth UID mismatch.');
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      const result = await dependencies.recover(db, identity);
      const conflict = result.status === 'blocked' || result.status === 'ambiguous';
      return json(conflict ? 409 : 200, {
        success: !conflict,
        ...result,
      });
    } catch (error: any) {
      if (error?.code === 'auth/user-not-found' || error?.code === 'auth/user-disabled') {
        return json(401, { success: false, status: 'blocked' });
      }
      // Never log bearer tokens or recovered group identifiers/codes.
      console.error(
        'recover-family-group error:',
        error instanceof Error ? error.message : 'unknown',
      );
      return json(500, { success: false, status: 'blocked' });
    }
  };

export default createRecoverFamilyGroupHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getAuthUser: confirmRecoveryAuthUser,
  getFirestore: getAdminFirestore,
  recover: recoverLegacyFamilyGroup,
});

export const config: Config = {
  path: '/api/recover-family-group',
};
