import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  confirmRecoveryAuthUser,
  createRecoverFamilyGroupHandler,
} from '../recover-family-group';

const fakeDb = {} as Firestore;
const fakeAuth = {} as Auth;

const request = (method: string, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/recover-family-group', {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

const makeHandler = (overrides: Record<string, any> = {}) => {
  const dependencies = {
    readEnvironment: jest.fn(() => undefined),
    verifyToken: jest.fn(async () => ({ sub: 'token-owner' })),
    getAuth: jest.fn(() => fakeAuth),
    getAuthUser: jest.fn(async () => ({
      uid: 'token-owner',
      email: 'canonical@example.com',
      displayName: 'Canonical Owner',
    })),
    getFirestore: jest.fn(() => fakeDb),
    recover: jest.fn(async () => ({
      status: 'recovered',
      groupId: 'legacy-family',
      code: 'LEG234',
    })),
    ...overrides,
  };
  return {
    handler: createRecoverFamilyGroupHandler(dependencies),
    dependencies,
  };
};

describe('recover-family-group Netlify Function', () => {
  test('handles CORS/method before authentication', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('GET'))).status).toBe(405);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('requires a verified token and a live non-disabled Admin Auth user', async () => {
    const invalid = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });
    expect((await invalid.handler(request('POST', 'invalid'))).status).toBe(401);
    expect(invalid.dependencies.getFirestore).not.toHaveBeenCalled();

    const adminAuth = {
      getUser: jest.fn(async () => ({ uid: 'disabled', disabled: true })),
    } as unknown as Auth;
    await expect(confirmRecoveryAuthUser(adminAuth, 'disabled')).rejects.toMatchObject({
      code: 'auth/user-disabled',
    });
  });

  test('uses canonical Auth identity and returns the recovered metadata', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('POST'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      status: 'recovered',
      groupId: 'legacy-family',
      code: 'LEG234',
    });
    expect(dependencies.recover).toHaveBeenCalledWith(fakeDb, {
      uid: 'token-owner',
      email: 'canonical@example.com',
      displayName: 'Canonical Owner',
    });
  });

  test.each(['blocked', 'ambiguous'])('returns a safe conflict for %s recovery', async (status) => {
    const { handler } = makeHandler({
      recover: jest.fn(async () => ({ status })),
    });
    const response = await handler(request('POST'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, status });
  });

  test('hides unexpected backend errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = makeHandler({
      recover: jest.fn(async () => { throw new Error('private group id'); }),
    });
    const response = await handler(request('POST'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, status: 'blocked' });
    errorSpy.mockRestore();
  });
});
