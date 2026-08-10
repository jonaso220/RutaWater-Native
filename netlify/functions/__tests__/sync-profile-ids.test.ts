import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createSyncProfileIdsHandler } from '../sync-profile-ids';

const fakeAuth = {} as Auth;
const fakeDb = {} as Firestore;

const request = (method: string, body: unknown = {}, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/sync-profile-ids', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

const makeHandler = (overrides: Record<string, any> = {}) => {
  const dependencies = {
    readEnvironment: jest.fn(() => undefined),
    verifyToken: jest.fn(async () => ({ sub: 'token-owner' })),
    getAuth: jest.fn(() => fakeAuth),
    getAuthUser: jest.fn(async () => {}),
    getFirestore: jest.fn(() => fakeDb),
    sync: jest.fn(async () => ['route-a', 'route-b']),
    ...overrides,
  };
  return { handler: createSyncProfileIdsHandler(dependencies), dependencies };
};

describe('sync-profile-ids Netlify Function', () => {
  test('handles preflight and rejects unsupported methods', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('GET'))).status).toBe(405);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('requires a verified token and a still-existing Auth user', async () => {
    const invalid = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });
    expect((await invalid.handler(request('POST'))).status).toBe(401);
    expect(invalid.dependencies.sync).not.toHaveBeenCalled();

    const deleted = makeHandler({
      getAuthUser: jest.fn(async () => {
        throw Object.assign(new Error('deleted'), { code: 'auth/user-not-found' });
      }),
    });
    expect((await deleted.handler(request('POST'))).status).toBe(401);
    expect(deleted.dependencies.sync).not.toHaveBeenCalled();
  });

  test('reports Auth infrastructure failures as server errors, not invalid users', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const unavailable = makeHandler({
      getAuth: jest.fn(() => { throw new Error('module unavailable'); }),
    });
    expect((await unavailable.handler(request('POST'))).status).toBe(500);
    expect(unavailable.dependencies.sync).not.toHaveBeenCalled();

    const lookupFailure = makeHandler({
      getAuthUser: jest.fn(async () => {
        throw Object.assign(new Error('permission denied'), { code: 'auth/internal-error' });
      }),
    });
    expect((await lookupFailure.handler(request('POST'))).status).toBe(500);
    expect(lookupFailure.dependencies.sync).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('uses only the token uid and returns its minimal profile index', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('POST', { uid: 'victim', userId: 'victim' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      profileIds: ['route-a', 'route-b'],
      profileIndexVersion: 1,
    });
    expect(dependencies.sync).toHaveBeenCalledWith(fakeDb, 'token-owner');
    expect(dependencies.sync).not.toHaveBeenCalledWith(fakeDb, 'victim');
  });

  test('does not expose backend failures', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = makeHandler({
      sync: jest.fn(async () => { throw new Error('private profile data'); }),
    });
    const response = await handler(request('POST'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: 'error' });
    errorSpy.mockRestore();
  });
});
