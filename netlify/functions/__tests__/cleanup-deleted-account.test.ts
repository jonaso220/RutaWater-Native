import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  confirmAuthAdminAccess,
  confirmFirestoreAdminAccess,
  createCleanupDeletedAccountHandler,
} from '../cleanup-deleted-account';

const fakeDb = {} as Firestore;
const fakeAuth = {} as Auth;
const nowSeconds = 1_786_000_000;

const makeHandler = (overrides: Record<string, any> = {}) => {
  const dependencies = {
    readEnvironment: jest.fn(() => undefined),
    verifyToken: jest.fn(async () => ({ sub: 'authenticated-user', auth_time: nowSeconds - 30 })),
    getAuth: jest.fn(() => fakeAuth),
    getFirestore: jest.fn(() => fakeDb),
    getAuthUser: jest.fn(async () => {}),
    confirmFirestore: jest.fn(async () => {}),
    loadJob: jest.fn(async () => null),
    beginJob: jest.fn(async () => ({ state: 'planning', scopes: { profileIds: [] } })),
    cancelPlanning: jest.fn(async () => true),
    plan: jest.fn(async () => ({ profileIds: [] })),
    persistPlan: jest.fn(async (_db, _uid, scopes) => scopes),
    deleteAuthUser: jest.fn(async () => {}),
    markAuthDeleted: jest.fn(async () => {}),
    cleanup: jest.fn(async () => {}),
    deleteJob: jest.fn(async () => {}),
    nowSeconds: jest.fn(() => nowSeconds),
    ...overrides,
  };
  return { handler: createCleanupDeletedAccountHandler(dependencies), dependencies };
};

const request = (method: string, body?: unknown, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/cleanup-deleted-account', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('cleanup-deleted-account Netlify Function', () => {
  test('handles CORS and rejects unsupported methods', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('GET'))).status).toBe(405);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('requires a verified Firebase token', async () => {
    const { handler } = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });
    expect((await handler(request('POST', {}))).status).toBe(401);
  });

  test('requires a recent login before deleting anything', async () => {
    const { handler, dependencies } = makeHandler({
      verifyToken: jest.fn(async () => ({
        sub: 'authenticated-user',
        auth_time: nowSeconds - 301,
      })),
    });
    const response = await handler(request('POST', {}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'RECENT_LOGIN_REQUIRED' }));
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
    expect(dependencies.cleanup).not.toHaveBeenCalled();
  });

  test('allows an old but valid token to resume an existing durable job', async () => {
    const scopes = { familyGroupId: 'private-family', profileIds: ['private-route'] };
    const { handler, dependencies } = makeHandler({
      verifyToken: jest.fn(async () => ({
        sub: 'authenticated-user',
        auth_time: nowSeconds - 3_600,
      })),
      loadJob: jest.fn(async () => ({ state: 'auth_deleted', scopes })),
      beginJob: jest.fn(async () => ({ state: 'auth_deleted', scopes })),
    });

    const response = await handler(request('POST', {}));
    expect(response.status).toBe(200);
    expect(dependencies.beginJob).toHaveBeenCalledWith(fakeDb, 'authenticated-user');
    expect(dependencies.plan).not.toHaveBeenCalled();
    expect(dependencies.cleanup).toHaveBeenCalledWith(fakeDb, 'authenticated-user', scopes);
    expect(dependencies.deleteJob).toHaveBeenCalledWith(fakeDb, 'authenticated-user');
  });

  test('preflight verifies Admin access without deleting anything', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('POST', { preflight: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, preflight: true });
    expect(dependencies.getAuthUser).toHaveBeenCalledWith(fakeAuth, 'authenticated-user');
    expect(dependencies.getFirestore).toHaveBeenCalled();
    expect(dependencies.confirmFirestore).toHaveBeenCalledWith(fakeDb, 'authenticated-user');
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
    expect(dependencies.cleanup).not.toHaveBeenCalled();
  });

  test('preflight configuration errors do not delete or clean up', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, dependencies } = makeHandler({
      getAuth: jest.fn(() => { throw new Error('missing service account'); }),
    });
    const response = await handler(request('POST', { preflight: true }));

    expect(response.status).toBe(500);
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
    expect(dependencies.cleanup).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('preflight Firestore read failures do not delete or clean up', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, dependencies } = makeHandler({
      confirmFirestore: jest.fn(async () => { throw new Error('datastore denied'); }),
    });
    const response = await handler(request('POST', { preflight: true }));

    expect(response.status).toBe(500);
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
    expect(dependencies.cleanup).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('preflight can resume after Auth was already deleted', async () => {
    const missingUser = Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
    const adminAuth = {
      getUser: jest.fn(async () => { throw missingUser; }),
    } as unknown as Auth;
    await expect(confirmAuthAdminAccess(adminAuth, 'already-deleted')).resolves.toBeUndefined();
  });

  test('Firestore preflight performs one harmless metadata read', async () => {
    const get = jest.fn(async () => ({}));
    const doc = jest.fn(() => ({ get }));
    const collection = jest.fn(() => ({ doc }));
    const db = { collection } as unknown as Firestore;

    await confirmFirestoreAdminAccess(db, 'owner');
    expect(collection).toHaveBeenCalledWith('users');
    expect(doc).toHaveBeenCalledWith('owner');
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('persists scopes before deleting Auth and cleans only the verified uid', async () => {
    const order: string[] = [];
    const { handler, dependencies } = makeHandler({
      verifyToken: jest.fn(async () => ({ sub: 'token-owner', auth_time: nowSeconds - 10 })),
      beginJob: jest.fn(async () => {
        order.push('begin-job');
        return { state: 'planning', scopes: { profileIds: [] } };
      }),
      plan: jest.fn(async () => { order.push('plan'); return { profileIds: [] }; }),
      persistPlan: jest.fn(async (_db, _uid, scopes) => {
        order.push('persist-plan');
        return scopes;
      }),
      deleteAuthUser: jest.fn(async () => { order.push('auth'); }),
      markAuthDeleted: jest.fn(async () => { order.push('mark-auth-deleted'); }),
      cleanup: jest.fn(async () => { order.push('firestore'); }),
      deleteJob: jest.fn(async () => { order.push('delete-job'); }),
    });
    const response = await handler(request('POST', { userId: 'victim-user' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(dependencies.deleteAuthUser).toHaveBeenCalledWith(fakeAuth, 'token-owner');
    expect(dependencies.plan).toHaveBeenCalledWith(fakeDb, fakeAuth, 'token-owner');
    expect(dependencies.cleanup).toHaveBeenCalledWith(fakeDb, 'token-owner', { profileIds: [] });
    expect(dependencies.cleanup).not.toHaveBeenCalledWith(fakeDb, 'victim-user', expect.anything());
    expect(order).toEqual([
      'begin-job',
      'plan',
      'persist-plan',
      'auth',
      'mark-auth-deleted',
      'firestore',
      'delete-job',
    ]);
  });

  test('a post-Auth failure retries with the exact persisted private scopes', async () => {
    const scopes = { familyGroupId: 'solo-family', profileIds: ['solo-profile'] };
    let storedJob: {
      state: 'planning' | 'planned' | 'auth_deleted';
      scopes: { familyGroupId?: string; profileIds: string[] };
    } | null = null;
    let tokenVerification = 0;
    const cleanup = jest.fn()
      .mockRejectedValueOnce(new Error('temporary Firestore failure'))
      .mockResolvedValueOnce(undefined);
    const { handler, dependencies } = makeHandler({
      verifyToken: jest.fn(async () => ({
        sub: 'authenticated-user',
        auth_time: tokenVerification++ === 0 ? nowSeconds - 30 : nowSeconds - 3_600,
      })),
      loadJob: jest.fn(async () => storedJob),
      beginJob: jest.fn(async () => {
        if (storedJob) return storedJob;
        storedJob = { state: 'planning', scopes: { profileIds: [] } };
        return { state: 'planning', scopes: { profileIds: [] } };
      }),
      plan: jest.fn(async () => scopes),
      persistPlan: jest.fn(async () => {
        storedJob = { state: 'planned', scopes };
        return scopes;
      }),
      markAuthDeleted: jest.fn(async () => {
        if (storedJob) storedJob.state = 'auth_deleted';
      }),
      cleanup,
      deleteJob: jest.fn(async () => { storedJob = null; }),
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await handler(request('POST', {}))).status).toBe(500);
    expect(storedJob).toEqual({ state: 'auth_deleted', scopes });
    expect((await handler(request('POST', {}))).status).toBe(200);

    expect(dependencies.plan).toHaveBeenCalledTimes(1);
    expect(dependencies.persistPlan).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteAuthUser).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenNthCalledWith(1, fakeDb, 'authenticated-user', scopes);
    expect(cleanup).toHaveBeenNthCalledWith(2, fakeDb, 'authenticated-user', scopes);
    expect(dependencies.deleteJob).toHaveBeenCalledTimes(1);
    expect(storedJob).toBeNull();
    errorSpy.mockRestore();
  });

  test('membership changes abort before Auth deletion', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const changed = Object.assign(new Error('changed'), { code: 'SHARED_SCOPE_CHANGED' });
    const { handler, dependencies } = makeHandler({
      plan: jest.fn(async () => { throw changed; }),
    });
    const response = await handler(request('POST', {}));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'SHARED_SCOPE_CHANGED' }));
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
    expect(dependencies.cleanup).not.toHaveBeenCalled();
    expect(dependencies.cancelPlanning).toHaveBeenCalledWith(fakeDb, 'authenticated-user');
    errorSpy.mockRestore();
  });

  test('does not reset aiUsage when Auth deletion fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, dependencies } = makeHandler({
      deleteAuthUser: jest.fn(async () => { throw new Error('auth unavailable'); }),
    });
    expect((await handler(request('POST', {}))).status).toBe(500);
    expect(dependencies.cleanup).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
