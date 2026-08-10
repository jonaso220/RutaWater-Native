import type { Config } from '@netlify/functions';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import {
  AppCompatibilityError,
  normalizeAppCompatibilityInput,
  recordAppCompatibility,
} from './_shared/appCompatibilityService';
import {
  readAppCompatibilityPolicy,
  validCompatibilityPepper,
} from './_shared/appCompatibilityPolicy';
import {
  EnvironmentReader,
  getAdminAuth,
  getAdminFirestore,
} from './_shared/firebaseAdmin';
import {
  confirmJoinAuthUser,
  isInactiveAuthAccountError,
} from './_shared/joinEndpoint';

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

const bearerToken = (request: Request): string =>
  /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';

interface ReportAppVersionDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getAuth: (readEnvironment: EnvironmentReader) => Auth;
  getAuthUser: (adminAuth: Auth, uid: string) => Promise<void>;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  record: typeof recordAppCompatibility;
}

export const createReportAppVersionHandler = (
  dependencies: ReportAppVersionDependencies,
) => async (request: Request): Promise<Response> => {
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
      'report-app-version Auth configuration error:',
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
      'report-app-version Auth lookup error:',
      typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : error instanceof Error ? error.name : 'unknown',
    );
    return json(500, { status: 'error' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { status: 'error' });
  }
  const input = normalizeAppCompatibilityInput(body);
  if (!input) return json(400, { status: 'error' });

  const policy = readAppCompatibilityPolicy(dependencies.readEnvironment);
  const pepper = dependencies.readEnvironment('APP_COMPATIBILITY_ID_PEPPER');
  if (!policy || !validCompatibilityPepper(pepper)) {
    return json(503, { status: 'error' });
  }

  try {
    const db = dependencies.getFirestore(dependencies.readEnvironment);
    const result = await dependencies.record(db, authPayload.sub, input, policy, pepper);
    if (!result.accepted) {
      return json(409, { status: 'error', code: 'INSTALLATION_LIMIT_REACHED' });
    }
    return json(200, {
      status: 'ok',
      policyVersion: policy.policyVersion,
      compatible: result.compatibilityStatus === 'compatible',
    });
  } catch (error) {
    if (error instanceof AppCompatibilityError) {
      return json(409, { status: 'error', code: error.code });
    }
    // Never log the request body, token, uid or installation identifier.
    console.error(
      'report-app-version error:',
      error instanceof Error ? error.name : 'unknown',
    );
    return json(500, { status: 'error' });
  }
};

export default createReportAppVersionHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getAuthUser: confirmJoinAuthUser,
  getFirestore: getAdminFirestore,
  record: recordAppCompatibility,
});

export const config: Config = {
  path: '/api/report-app-version',
};
