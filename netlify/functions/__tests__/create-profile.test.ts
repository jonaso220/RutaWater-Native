import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createCreateProfileHandler } from '../create-profile';

const fakeAuth = {} as Auth;
const fakeDb = {} as Firestore;

const request = (method: string, body: unknown = {}, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/create-profile', {
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
    create: jest.fn(async () => ({
      profileId: 'profile_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code: 'ABC234',
      created: true,
    })),
    ...overrides,
  };
  return { handler: createCreateProfileHandler(dependencies), dependencies };
};

describe('create-profile Netlify Function', () => {
  test('handles preflight and rejects unsupported methods', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('GET'))).status).toBe(405);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('uses only the verified token uid and validates bounded input', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('POST', {
      name: '  Ruta Centro  ',
      requestId: 'request_abcdefghijklmnop',
      uid: 'victim',
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      profileId: 'profile_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      code: 'ABC234',
      created: true,
    });
    expect(dependencies.create).toHaveBeenCalledWith(
      fakeDb,
      'token-owner',
      'Ruta Centro',
      'request_abcdefghijklmnop',
    );

    expect((await handler(request('POST', { name: '', requestId: 'short' }))).status).toBe(400);
  });

  test('requires a live Auth user and hides backend details', async () => {
    const unauthorized = makeHandler({
      getAuthUser: jest.fn(async () => {
        throw Object.assign(new Error('deleted'), { code: 'auth/user-not-found' });
      }),
    });
    expect((await unauthorized.handler(request('POST', {
      name: 'Ruta', requestId: 'request_abcdefghijklmnop',
    }))).status).toBe(401);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failed = makeHandler({ create: jest.fn(async () => { throw new Error('private'); }) });
    const response = await failed.handler(request('POST', {
      name: 'Ruta', requestId: 'request_abcdefghijklmnop',
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: 'error' });
    errorSpy.mockRestore();
  });

  test('does not misclassify Auth infrastructure failures as deleted users', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const unavailable = makeHandler({
      getAuth: jest.fn(() => { throw new Error('module unavailable'); }),
    });
    const response = await unavailable.handler(request('POST', {
      name: 'Ruta', requestId: 'request_abcdefghijklmnop',
    }));
    expect(response.status).toBe(500);
    expect(unavailable.dependencies.create).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
