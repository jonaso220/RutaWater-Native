import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  confirmCreateGroupAuthUser,
  createCreateGroupHandler,
} from '../create-group';
import { GroupCreationError } from '../_shared/groupCreationService';

const fakeDb = {} as Firestore;
const fakeAuth = {} as Auth;

const request = (method: string, body?: unknown, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/create-group', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const makeHandler = (overrides: Record<string, any> = {}) => {
  const dependencies = {
    readEnvironment: jest.fn(() => undefined),
    verifyToken: jest.fn(async () => ({ sub: 'token-owner' })),
    getAuth: jest.fn(() => fakeAuth),
    getAuthUser: jest.fn(async () => ({
      uid: 'token-owner',
      email: 'canonical@example.com',
      displayName: 'Canonical Name',
    })),
    getFirestore: jest.fn(() => fakeDb),
    resolvePlan: jest.fn(async () => 'monthly' as const),
    createGroup: jest.fn(async () => ({
      groupId: 'group_1234567890abcdef1234567890abcdef',
      code: 'ABC234',
    })),
    ...overrides,
  };
  return { handler: createCreateGroupHandler(dependencies), dependencies };
};

describe('create-group Netlify Function', () => {
  test('handles CORS before auth and rejects unsupported methods', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('GET'))).status).toBe(405);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('requires a verified Firebase bearer token', async () => {
    const { handler, dependencies } = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });

    expect((await handler(request('POST', {}, 'invalid'))).status).toBe(401);
    expect(dependencies.getAuth).not.toHaveBeenCalled();
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
    expect(dependencies.createGroup).not.toHaveBeenCalled();
  });

  test('checks that the Admin Auth account still exists before opening Firestore', async () => {
    const { handler, dependencies } = makeHandler({
      getAuthUser: jest.fn(async () => {
        throw Object.assign(new Error('deleted'), { code: 'auth/user-not-found' });
      }),
    });

    const response = await handler(request('POST', {}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, code: 'UNAUTHORIZED' });
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
    expect(dependencies.createGroup).not.toHaveBeenCalled();
  });

  test('rejects a disabled Firebase Auth account', async () => {
    const adminAuth = {
      getUser: jest.fn(async () => ({
        uid: 'disabled-user',
        disabled: true,
      })),
    } as unknown as Auth;

    await expect(confirmCreateGroupAuthUser(adminAuth, 'disabled-user')).rejects.toMatchObject({
      code: 'auth/user-disabled',
    });
  });

  test('uses only canonical Admin Auth identity and ignores spoofed body fields', async () => {
    const createGroup = jest.fn(async () => ({
      groupId: 'group_1234567890abcdef1234567890abcdef',
      code: 'ABC234',
    }));
    const { handler } = makeHandler({ createGroup });
    const response = await handler(request('POST', {
      uid: 'victim',
      userId: 'victim',
      email: 'spoof@example.com',
      code: 'HACKED',
      groupId: 'foreign-group',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      groupId: 'group_1234567890abcdef1234567890abcdef',
      code: 'ABC234',
    });
    expect(createGroup).toHaveBeenCalledWith({
      db: fakeDb,
      identity: {
        uid: 'token-owner',
        email: 'canonical@example.com',
        displayName: 'Canonical Name',
      },
    });
  });

  test('rejects Free group creation before starting migration', async () => {
    const { handler, dependencies } = makeHandler({
      resolvePlan: jest.fn(async () => 'free' as const),
    });
    const response = await handler(request('POST', {}));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, code: 'PREMIUM_REQUIRED' });
    expect(dependencies.createGroup).not.toHaveBeenCalled();
  });

  test('does not open Firestore when Admin Auth configuration or lookup fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const missingConfig = makeHandler({
      getAuth: jest.fn(() => { throw new Error('missing service account'); }),
    });
    const unavailableAuth = makeHandler({
      getAuthUser: jest.fn(async () => { throw new Error('network unavailable'); }),
    });

    expect((await missingConfig.handler(request('POST', {}))).status).toBe(500);
    expect((await unavailableAuth.handler(request('POST', {}))).status).toBe(500);
    expect(missingConfig.dependencies.getFirestore).not.toHaveBeenCalled();
    expect(unavailableAuth.dependencies.getFirestore).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('returns stable conflict/retry codes without exposing internal state', async () => {
    const already = makeHandler({
      createGroup: jest.fn(async () => {
        throw new GroupCreationError('ALREADY_IN_GROUP', 'private membership detail');
      }),
    });
    const retry = makeHandler({
      createGroup: jest.fn(async () => {
        throw new GroupCreationError('RETRY_REQUIRED', 'private migration detail');
      }),
    });

    const alreadyResponse = await already.handler(request('POST', {}));
    const retryResponse = await retry.handler(request('POST', {}));
    expect(alreadyResponse.status).toBe(409);
    expect(await alreadyResponse.json()).toEqual({ success: false, code: 'ALREADY_IN_GROUP' });
    expect(retryResponse.status).toBe(202);
    expect(await retryResponse.json()).toEqual({
      success: false,
      code: 'RETRY_REQUIRED',
      retryAfterMs: 750,
    });
  });

  test('returns a clear free-budget rejection without hiding it as a server error', async () => {
    const overLimit = makeHandler({
      createGroup: jest.fn(async () => {
        throw new GroupCreationError('FREE_MIGRATION_LIMIT', 'private count');
      }),
    });
    const response = await overLimit.handler(request('POST', {}));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      success: false,
      code: 'FREE_MIGRATION_LIMIT',
    });
  });

  test('hides unexpected backend errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = makeHandler({
      createGroup: jest.fn(async () => { throw new Error('private Firestore path'); }),
    });
    const response = await handler(request('POST', {}));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'SERVER_ERROR' });
    errorSpy.mockRestore();
  });
});
