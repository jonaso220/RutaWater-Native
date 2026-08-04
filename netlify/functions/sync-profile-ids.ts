import type { Config } from '@netlify/functions';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import {
  EnvironmentReader,
  getAdminAuth,
  getAdminFirestore,
} from './_shared/firebaseAdmin';
import { confirmJoinAuthUser } from './_shared/joinEndpoint';
import { syncProfileIds } from './_shared/profileIndexService';

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

interface SyncProfileIdsDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getAuth: (readEnvironment: EnvironmentReader) => Auth;
  getAuthUser: (adminAuth: Auth, uid: string) => Promise<void>;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  sync: (db: Firestore, uid: string) => Promise<string[]>;
}

export const createSyncProfileIdsHandler = (dependencies: SyncProfileIdsDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') return json(405, { status: 'error' });

    let authPayload: { sub: string };
    try {
      authPayload = await dependencies.verifyToken(bearerToken(request));
      const adminAuth = dependencies.getAuth(dependencies.readEnvironment);
      await dependencies.getAuthUser(adminAuth, authPayload.sub);
    } catch {
      return json(401, { status: 'error' });
    }

    try {
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      const profileIds = await dependencies.sync(db, authPayload.sub);
      return json(200, { status: 'ok', profileIds, profileIndexVersion: 1 });
    } catch (error) {
      console.error(
        'sync-profile-ids error:',
        error instanceof Error ? error.message : 'unknown',
      );
      return json(500, { status: 'error' });
    }
  };

export default createSyncProfileIdsHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getAuthUser: confirmJoinAuthUser,
  getFirestore: getAdminFirestore,
  sync: syncProfileIds,
});

export const config: Config = {
  path: '/api/sync-profile-ids',
};
