import type { Config } from '@netlify/functions';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import {
  EnvironmentReader,
  getAdminFirestore,
} from './_shared/firebaseAdmin';
import {
  ClientCreateItem,
  ClientCreationError,
  ClientCreationPlan,
  createClientDocuments,
} from './_shared/clientCreationService';

const { AiPlanUnavailableError, resolveAiPlan } = require('./_shared/aiQuota');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BODY_BYTES = 500_000;

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });

const bearerToken = (request: Request): string => {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1] || '';
};

interface CreateClientDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  resolvePlan: (input: {
    db: Firestore;
    uid: string;
    readEnvironment: EnvironmentReader;
    fetchImpl?: typeof fetch;
    nowMillis?: number;
  }) => Promise<ClientCreationPlan>;
  create: (input: {
    db: Firestore;
    uid: string;
    plan: ClientCreationPlan;
    items: ClientCreateItem[];
  }) => Promise<{ ids: string[]; created: number; limit: number | null; count: number | null }>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const parseItems = (body: unknown): ClientCreateItem[] | null => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const rawItems = Array.isArray(record.items)
    ? record.items
    : [{ id: record.id, data: record.data }];
  if (rawItems.length < 1) return null;
  const items: ClientCreateItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== 'string'
      || !item.data
      || typeof item.data !== 'object'
      || Array.isArray(item.data)
    ) return null;
    items.push({ id: item.id, data: item.data as Record<string, unknown> });
  }
  return items;
};

export const createCreateClientHandler = (dependencies: CreateClientDependencies) =>
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

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return json(413, { status: 'error', code: 'CLIENT_CREATE_INPUT_INVALID' });
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return json(400, { status: 'error', code: 'CLIENT_CREATE_INPUT_INVALID' });
    }
    const items = parseItems(body);
    if (!items) return json(400, { status: 'error', code: 'CLIENT_CREATE_INPUT_INVALID' });

    try {
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      const plan = await dependencies.resolvePlan({
        db,
        uid: authPayload.sub,
        readEnvironment: dependencies.readEnvironment,
        fetchImpl: dependencies.fetchImpl,
        nowMillis: (dependencies.now?.() || new Date()).getTime(),
      });
      const result = await dependencies.create({
        db,
        uid: authPayload.sub,
        plan,
        items,
      });
      return json(200, { status: 'ok', ...result });
    } catch (error) {
      if (error instanceof ClientCreationError) {
        if (error.code === 'CLIENT_LIMIT_REACHED') {
          return json(429, { status: 'error', code: error.code });
        }
        if (error.code === 'PREMIUM_REQUIRED') {
          return json(403, { status: 'error', code: error.code });
        }
        if (error.code === 'ACCOUNT_WRITE_BLOCKED') {
          return json(401, { status: 'error', code: error.code });
        }
        if (error.code === 'CLIENT_CREATE_SCOPE_DENIED') {
          return json(403, { status: 'error', code: error.code });
        }
        return json(400, { status: 'error', code: error.code });
      }
      const planUnavailable = error instanceof AiPlanUnavailableError
        || (error instanceof Error && error.name === 'AiPlanUnavailableError');
      console.error(
        'create-client error:',
        error instanceof Error ? error.message : 'unknown',
      );
      return json(planUnavailable ? 503 : 500, {
        status: 'error',
        code: planUnavailable ? 'PLAN_UNAVAILABLE' : 'SERVER_ERROR',
      });
    }
  };

export default createCreateClientHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getFirestore: getAdminFirestore,
  resolvePlan: resolveAiPlan,
  create: createClientDocuments,
});

export const config: Config = {
  path: '/api/create-client',
};
