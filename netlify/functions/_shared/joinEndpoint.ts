import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { EnvironmentReader } from './firebaseAdmin';
import { JoinStatus, normalizeInviteCode } from './joinService';

export const JOIN_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, joinStatus: JoinStatus): Response =>
  new Response(JSON.stringify({ status: joinStatus }), {
    status,
    headers: { 'Content-Type': 'application/json', ...JOIN_CORS_HEADERS },
  });

const bearerToken = (request: Request): string => {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1] || '';
};

export interface JoinEndpointDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getAuth: (readEnvironment: EnvironmentReader) => Auth;
  getAuthUser: (adminAuth: Auth, uid: string) => Promise<void>;
  allowAttempt: (uid: string) => boolean;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  join: (input: { db: Firestore; uid: string; code: string }) => Promise<JoinStatus>;
  logLabel: string;
}

export const confirmJoinAuthUser = async (adminAuth: Auth, uid: string): Promise<void> => {
  const user = await adminAuth.getUser(uid);
  if (user.disabled) {
    throw Object.assign(new Error('AUTH_USER_DISABLED'), { code: 'auth/user-disabled' });
  }
};

export const isInactiveAuthAccountError = (error: unknown): boolean => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === 'auth/user-not-found'
    || code === 'auth/user-disabled'
    || (error instanceof Error && error.message === 'AUTH_USER_DISABLED');
};

const safeAuthErrorLabel = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (typeof code === 'string' && code) return code;
  return error instanceof Error ? error.name : 'unknown';
};

// A small in-memory limiter adds no paid service or billable Firestore writes.
// It is intentionally only a burst guard (serverless instances do not share
// memory); bearer auth, generic responses, and private rules remain the hard
// security boundary.
const JOIN_WINDOW_MS = 60_000;
const JOIN_ATTEMPTS_PER_WINDOW = 20;
const joinAttempts = new Map<string, { start: number; count: number }>();

export const allowJoinAttempt = (uid: string, now = Date.now()): boolean => {
  const current = joinAttempts.get(uid);
  if (!current || now - current.start >= JOIN_WINDOW_MS) {
    joinAttempts.set(uid, { start: now, count: 1 });
    if (joinAttempts.size > 1000) {
      for (const [key, value] of joinAttempts) {
        if (now - value.start >= JOIN_WINDOW_MS) joinAttempts.delete(key);
      }
    }
    return true;
  }
  if (current.count >= JOIN_ATTEMPTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
};

export const createJoinEndpointHandler = (dependencies: JoinEndpointDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JOIN_CORS_HEADERS });
    }
    if (request.method !== 'POST') return json(405, 'error');

    let authPayload: { sub: string };
    try {
      authPayload = await dependencies.verifyToken(bearerToken(request));
    } catch {
      return json(401, 'error');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(200, 'not_found');
    }
    const rawCode = typeof body === 'object' && body !== null && 'code' in body
      ? (body as { code?: unknown }).code
      : undefined;
    const code = normalizeInviteCode(rawCode);
    // Malformed and unknown codes are intentionally indistinguishable.
    if (!code) return json(200, 'not_found');

    // Firebase ID tokens remain cryptographically valid for a short window
    // after Auth deletion. Confirm the account still exists before any Admin
    // write so a stale token can never recreate users/{uid} or memberships.
    let adminAuth: Auth;
    try {
      adminAuth = dependencies.getAuth(dependencies.readEnvironment);
    } catch (error) {
      console.error(`${dependencies.logLabel} Auth configuration error:`, safeAuthErrorLabel(error));
      return json(500, 'error');
    }
    try {
      await dependencies.getAuthUser(adminAuth, authPayload.sub);
    } catch (error) {
      if (isInactiveAuthAccountError(error)) return json(401, 'error');
      console.error(`${dependencies.logLabel} Auth lookup error:`, safeAuthErrorLabel(error));
      return json(500, 'error');
    }
    if (!dependencies.allowAttempt(authPayload.sub)) return json(429, 'error');

    try {
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      const status = await dependencies.join({
        db,
        uid: authPayload.sub,
        code,
      });
      return json(200, status);
    } catch (error) {
      // Never log invite codes, request bodies, or identity tokens.
      console.error(
        `${dependencies.logLabel} error:`,
        error instanceof Error ? error.message : 'unknown',
      );
      return json(500, 'error');
    }
  };
