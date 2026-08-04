import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createJoinGroupHandler } from '../join-group';
import { createJoinProfileHandler } from '../join-profile';
import { confirmJoinAuthUser } from '../_shared/joinEndpoint';

const fakeDb = {} as Firestore;
const fakeAuth = {} as Auth;

const factories = [
  ['group', createJoinGroupHandler],
  ['profile', createJoinProfileHandler],
] as const;

const request = (method: string, body?: unknown, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/join', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('shared Firebase Auth confirmation', () => {
  test('accepts active users and rejects disabled users before any Admin write', async () => {
    const activeAuth = {
      getUser: jest.fn(async () => ({ disabled: false })),
    } as unknown as Auth;
    const disabledAuth = {
      getUser: jest.fn(async () => ({ disabled: true })),
    } as unknown as Auth;

    await expect(confirmJoinAuthUser(activeAuth, 'active-user')).resolves.toBeUndefined();
    await expect(confirmJoinAuthUser(disabledAuth, 'disabled-user'))
      .rejects.toThrow('AUTH_USER_DISABLED');
  });
});

describe.each(factories)('join-%s Netlify Function', (_kind, createHandler) => {
  const makeHandler = (overrides: Record<string, any> = {}) => {
    const dependencies = {
      readEnvironment: jest.fn(() => undefined),
      verifyToken: jest.fn(async () => ({ sub: 'token-owner' })),
      getAuth: jest.fn(() => fakeAuth),
      getAuthUser: jest.fn(async () => {}),
      allowAttempt: jest.fn(() => true),
      getFirestore: jest.fn(() => fakeDb),
      join: jest.fn(async () => 'ok' as const),
      logLabel: `join-${_kind}`,
      ...overrides,
    };
    return { handler: createHandler(dependencies), dependencies };
  };

  test('handles preflight and rejects unsupported methods', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('GET'))).status).toBe(405);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('requires a valid Firebase bearer token', async () => {
    const { handler, dependencies } = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });
    const response = await handler(request('POST', { code: 'ABC234' }, 'invalid'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'error' });
    expect(dependencies.join).not.toHaveBeenCalled();
  });

  test('makes malformed and missing codes look not found', async () => {
    const { handler, dependencies } = makeHandler();
    for (const body of [{ code: 'bad' }, {}, { code: 'ABC01I' }]) {
      const response = await handler(request('POST', body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'not_found' });
    }
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
    expect(dependencies.join).not.toHaveBeenCalled();
  });

  test('normalizes the code and trusts only the uid in the token', async () => {
    const join = jest.fn(async () => 'ok' as const);
    const { handler } = makeHandler({ join });
    const response = await handler(request('POST', {
      code: ' abc234 ',
      uid: 'victim',
      userId: 'victim',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(join).toHaveBeenCalledWith({ db: fakeDb, uid: 'token-owner', code: 'ABC234' });
    expect(join).not.toHaveBeenCalledWith(expect.objectContaining({ uid: 'victim' }));
  });

  test('rejects a still-signed token after its Firebase Auth user was deleted', async () => {
    const { handler, dependencies } = makeHandler({
      getAuthUser: jest.fn(async () => {
        throw Object.assign(new Error('deleted'), { code: 'auth/user-not-found' });
      }),
    });
    const response = await handler(request('POST', { code: 'ABC234' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'error' });
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
    expect(dependencies.join).not.toHaveBeenCalled();
  });

  test('rate-limits authenticated code guessing before opening Firestore', async () => {
    const { handler, dependencies } = makeHandler({ allowAttempt: jest.fn(() => false) });
    const response = await handler(request('POST', { code: 'ABC234' }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ status: 'error' });
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
    expect(dependencies.join).not.toHaveBeenCalled();
  });

  test.each(['not_found', 'already', 'error'] as const)(
    'returns only the generic %s business result',
    async (status) => {
      const { handler } = makeHandler({ join: jest.fn(async () => status) });
      const response = await handler(request('POST', { code: 'ABC234' }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status });
    },
  );

  test('does not expose backend failures or invite codes', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = makeHandler({
      join: jest.fn(async () => { throw new Error('secret ABC234'); }),
    });
    const response = await handler(request('POST', { code: 'ABC234' }));
    expect(response.status).toBe(500);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({ status: 'error' });
    expect(responseText).not.toContain('ABC234');
    errorSpy.mockRestore();
  });
});
