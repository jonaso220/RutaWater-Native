import type { Firestore } from 'firebase-admin/firestore';
import { createRedeemPromoHandler } from '../redeem-promo';

const pepper = 'p'.repeat(32);
const fakeDb = {} as Firestore;

const makeHandler = (overrides: Record<string, any> = {}) => {
  const dependencies = {
    readEnvironment: jest.fn((name: string) => name === 'PROMO_CODE_PEPPER' ? pepper : undefined),
    verifyToken: jest.fn(async () => ({ sub: 'authenticated-user' })),
    getFirestore: jest.fn(() => fakeDb),
    redeem: jest.fn(async () => 'redeemed' as const),
    ...overrides,
  };
  return { handler: createRedeemPromoHandler(dependencies), dependencies };
};

const request = (method: string, body?: unknown, token = 'valid-token') =>
  new Request('https://rutawater-api.netlify.app/api/redeem-promo', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('redeem-promo Netlify Function', () => {
  test('handles CORS preflight without authentication', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('OPTIONS'));
    expect(response.status).toBe(204);
    expect(dependencies.verifyToken).not.toHaveBeenCalled();
  });

  test('rejects unsupported methods', async () => {
    const { handler } = makeHandler();
    const response = await handler(request('GET'));
    expect(response.status).toBe(405);
  });

  test('requires a valid Firebase bearer token', async () => {
    const { handler } = makeHandler({
      verifyToken: jest.fn(async () => { throw new Error('invalid'); }),
    });
    const response = await handler(request('POST', { code: 'RW-ABCDEFGH' }, 'invalid'));
    expect(response.status).toBe(401);
  });

  test('rejects malformed codes before opening Firestore', async () => {
    const { handler, dependencies } = makeHandler();
    const response = await handler(request('POST', { code: 'short' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: false, status: 'invalid' });
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
  });

  test('uses only the uid from the verified token', async () => {
    const redeem = jest.fn(async () => 'redeemed' as const);
    const { handler } = makeHandler({
      verifyToken: jest.fn(async () => ({ sub: 'token-owner' })),
      redeem,
    });
    const response = await handler(request('POST', {
      code: 'RW-ABCDEFGHJKLMNP',
      userId: 'victim-user',
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: 'redeemed' });
    expect(redeem).toHaveBeenCalledWith(expect.objectContaining({ uid: 'token-owner' }));
    expect(redeem).not.toHaveBeenCalledWith(expect.objectContaining({ uid: 'victim-user' }));
  });

  test('does not echo the promo code in its response', async () => {
    const { handler } = makeHandler();
    const code = 'RW-ABCDEFGHJKLMNP';
    const response = await handler(request('POST', { code }));
    expect(await response.text()).not.toContain(code);
  });

  test('returns an idempotent success for an existing Premium', async () => {
    const { handler } = makeHandler({ redeem: jest.fn(async () => 'already_active' as const) });
    const response = await handler(request('POST', { code: 'RW-ABCDEFGHJKLMNP' }));
    expect(await response.json()).toEqual({ success: true, status: 'already_active' });
  });

  test('does not expose backend configuration errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = makeHandler({ readEnvironment: jest.fn(() => undefined) });
    const response = await handler(request('POST', { code: 'RW-ABCDEFGHJKLMNP' }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo procesar el canje.' });
    errorSpy.mockRestore();
  });
});
