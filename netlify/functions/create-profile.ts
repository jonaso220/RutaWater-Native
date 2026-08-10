import type { Config } from '@netlify/functions';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import {
  EnvironmentReader,
  getAdminAuth,
  getAdminFirestore,
} from './_shared/firebaseAdmin';
import {
  confirmJoinAuthUser,
  isInactiveAuthAccountError,
} from './_shared/joinEndpoint';
import {
  createProfileForOwner,
  type CreatedProfileResult,
} from './_shared/profileCreationService';

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

interface CreateProfileDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getAuth: (readEnvironment: EnvironmentReader) => Auth;
  getAuthUser: (adminAuth: Auth, uid: string) => Promise<void>;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  create: (
    db: Firestore,
    uid: string,
    name: string,
    requestId: string,
  ) => Promise<CreatedProfileResult>;
}

export const createCreateProfileHandler = (dependencies: CreateProfileDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') return json(405, { status: 'error' });

    let authPayload: { sub: string };
    try {
      authPayload = await dependencies.verifyToken(bearerToken(request));
    } catch {
      return json(401, { status: 'error' });
    }

    let adminAuth: Auth;
    try {
      adminAuth = dependencies.getAuth(dependencies.readEnvironment);
    } catch (error) {
      console.error(
        'create-profile Auth configuration error:',
        error instanceof Error ? error.name : 'unknown',
      );
      return json(500, { status: 'error' });
    }
    try {
      await dependencies.getAuthUser(adminAuth, authPayload.sub);
    } catch (error) {
      if (isInactiveAuthAccountError(error)) {
        return json(401, { status: 'error' });
      }
      console.error(
        'create-profile Auth lookup error:',
        typeof (error as { code?: unknown })?.code === 'string'
          ? (error as { code: string }).code
          : error instanceof Error ? error.name : 'unknown',
      );
      return json(500, { status: 'error' });
    }

    let body: { name?: unknown; requestId?: unknown };
    try {
      body = await request.json() as { name?: unknown; requestId?: unknown };
    } catch {
      return json(400, { status: 'error' });
    }
    if (
      typeof body.name !== 'string'
      || !body.name.trim()
      || body.name.trim().length > 80
      || typeof body.requestId !== 'string'
      || !/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId)
    ) return json(400, { status: 'error' });

    try {
      const result = await dependencies.create(
        dependencies.getFirestore(dependencies.readEnvironment),
        authPayload.sub,
        body.name.trim(),
        body.requestId,
      );
      return json(200, { status: 'ok', ...result });
    } catch (error) {
      console.error(
        'create-profile error:',
        error instanceof Error ? error.message : 'unknown',
      );
      return json(500, { status: 'error' });
    }
  };

export default createCreateProfileHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getAuthUser: confirmJoinAuthUser,
  getFirestore: getAdminFirestore,
  create: (db, uid, name, requestId) => createProfileForOwner({
    db,
    uid,
    name,
    requestId,
  }),
});

export const config: Config = {
  path: '/api/create-profile',
};
