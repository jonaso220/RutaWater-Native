import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createReportAppVersionHandler } from '../report-app-version';

const fakeAuth = {} as Auth;
const fakeDb = {} as Firestore;
const PEPPER = 'compatibility-pepper-abcdefghijklmnopqrstuvwxyz';

const validBody = {
  platform: 'ios',
  appVersion: '1.50',
  buildNumber: '55',
  installationId: 'cdefghijklmnopqrstuvwx',
};

const request = (method: string, body: unknown = validBody, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/report-app-version', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

const makeHandler = (overrides: Record<string, any> = {}) => {
  const env: Record<string, string | undefined> = {
    DATA_SCOPE_COMPATIBILITY_POLICY_VERSION: '1',
    DATA_SCOPE_MINIMUM_IOS_BUILD: '55',
    DATA_SCOPE_MINIMUM_ANDROID_BUILD: '22',
    DATA_SCOPE_COMPATIBILITY_MAX_AGE_DAYS: '30',
    APP_COMPATIBILITY_ID_PEPPER: PEPPER,
  };
  const dependencies = {
    readEnvironment: jest.fn((name: string) => env[name]),
    verifyToken: jest.fn(async () => ({ sub: 'token-owner' })),
    getAuth: jest.fn(() => fakeAuth),
    getAuthUser: jest.fn(async () => {}),
    getFirestore: jest.fn(() => fakeDb),
    record: jest.fn(async () => ({
      accepted: true,
      compatibilityStatus: 'compatible',
    })),
    ...overrides,
  };
  return {
    handler: createReportAppVersionHandler(dependencies),
    dependencies,
    env,
  };
};

describe('report-app-version Netlify Function', () => {
  test('handles preflight and rejects unsupported methods before auth', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('OPTIONS'))).status).toBe(204);
    expect((await handler(request('GET'))).status).toBe(405);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('requires a valid token and a still-existing Auth user', async () => {
    const invalid = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });
    expect((await invalid.handler(request('POST'))).status).toBe(401);
    expect(invalid.dependencies.record).not.toHaveBeenCalled();

    const deleted = makeHandler({
      getAuthUser: jest.fn(async () => {
        throw Object.assign(new Error('deleted'), { code: 'auth/user-not-found' });
      }),
    });
    expect((await deleted.handler(request('POST'))).status).toBe(401);
    expect(deleted.dependencies.record).not.toHaveBeenCalled();
  });

  test('reports Admin Auth infrastructure failures as server errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const unavailable = makeHandler({
      getAuth: jest.fn(() => { throw new Error('module unavailable'); }),
    });
    expect((await unavailable.handler(request('POST'))).status).toBe(500);
    expect(unavailable.dependencies.record).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('rejects malformed evidence and a missing server policy without writes', async () => {
    const malformed = makeHandler();
    expect((await malformed.handler(request('POST', {
      ...validBody,
      installationId: 'too-short',
    }))).status).toBe(400);
    expect(malformed.dependencies.getFirestore).not.toHaveBeenCalled();

    const unconfigured = makeHandler({
      readEnvironment: jest.fn((name: string) => (
        name === 'APP_COMPATIBILITY_ID_PEPPER' ? PEPPER : undefined
      )),
    });
    expect((await unconfigured.handler(request('POST'))).status).toBe(503);
    expect(unconfigured.dependencies.getFirestore).not.toHaveBeenCalled();
  });

  test('derives uid only from the token and never returns installation evidence', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('POST', {
      ...validBody,
      uid: 'victim',
      compatible: true,
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      status: 'ok',
      policyVersion: 1,
      compatible: true,
    });
    expect(dependencies.record).toHaveBeenCalledWith(
      fakeDb,
      'token-owner',
      {
        platform: 'ios',
        appVersion: '1.50',
        buildNumber: 55,
        installationId: 'cdefghijklmnopqrstuvwx',
      },
      {
        policyVersion: 1,
        minimumBuilds: { ios: 55, android: 22 },
        evidenceMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
      },
      PEPPER,
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('token-owner');
    expect(serialized).not.toContain(validBody.installationId);
  });

  test('fails closed when the installation cap is reached', async () => {
    const { handler } = makeHandler({
      record: jest.fn(async () => ({
        accepted: false,
        compatibilityStatus: 'overflow',
      })),
    });
    const response = await handler(request('POST'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: 'error',
      code: 'INSTALLATION_LIMIT_REACHED',
    });
  });
});
