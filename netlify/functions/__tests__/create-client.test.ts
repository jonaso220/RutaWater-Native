import type { Firestore } from 'firebase-admin/firestore';
import { createCreateClientHandler } from '../create-client';
import { ClientCreationError } from '../_shared/clientCreationService';

const fakeDb = {} as Firestore;

const request = (method: string, body: unknown = {}, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/create-client', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

const client = (id = 'client_1') => ({
  id,
  data: {
    name: 'Cliente',
    freq: 'on_demand',
    userId: 'attacker-controlled',
  },
});

const makeHandler = (overrides: Record<string, any> = {}) => {
  const dependencies = {
    readEnvironment: jest.fn(() => undefined),
    verifyToken: jest.fn(async () => ({ sub: 'token-owner' })),
    getFirestore: jest.fn(() => fakeDb),
    resolvePlan: jest.fn(async () => 'free' as const),
    create: jest.fn(async ({ items }) => ({
      ids: items.map((item: { id: string }) => item.id),
      created: items.length,
      limit: 60,
      count: items.length,
    })),
    ...overrides,
  };
  return { handler: createCreateClientHandler(dependencies), dependencies };
};

describe('create-client Netlify Function', () => {
  test('authenticates, resolves the canonical plan, and trusts only the token uid', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('POST', { items: [client()] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok', ids: ['client_1'], created: 1, limit: 60, count: 1,
    });
    expect(dependencies.resolvePlan).toHaveBeenCalledWith(expect.objectContaining({
      db: fakeDb,
      uid: 'token-owner',
    }));
    expect(dependencies.create).toHaveBeenCalledWith(expect.objectContaining({
      db: fakeDb,
      uid: 'token-owner',
      plan: 'free',
      items: [client()],
    }));
  });

  test('rejects invalid auth and malformed payloads before Firestore writes', async () => {
    const invalidAuth = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });
    expect((await invalidAuth.handler(request('POST', { items: [client()] }))).status).toBe(401);
    expect(invalidAuth.dependencies.create).not.toHaveBeenCalled();

    const malformed = makeHandler();
    expect((await malformed.handler(request('POST', { items: [] }))).status).toBe(400);
    expect(malformed.dependencies.resolvePlan).not.toHaveBeenCalled();
  });

  test('maps quota and Premium failures without exposing backend details', async () => {
    const atLimit = makeHandler({
      create: jest.fn(async () => { throw new ClientCreationError('CLIENT_LIMIT_REACHED'); }),
    });
    const limited = await atLimit.handler(request('POST', { items: [client()] }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ status: 'error', code: 'CLIENT_LIMIT_REACHED' });

    const bulkFree = makeHandler({
      create: jest.fn(async () => { throw new ClientCreationError('PREMIUM_REQUIRED'); }),
    });
    const forbidden = await bulkFree.handler(request('POST', {
      items: [client('client_1'), client('client_2')],
    }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ status: 'error', code: 'PREMIUM_REQUIRED' });
  });
});
