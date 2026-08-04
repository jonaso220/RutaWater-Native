const {
  AiPlanUnavailableError,
  fetchRevenueCatPlan,
  getAiLimit,
  getServerPeriod,
  planFromRevenueCatPayload,
  resolveAiPlan,
} = require('../aiQuota');

const entitlementPayload = (product_identifier: string, expires_date: string | null, extra = {}) => ({
  subscriber: {
    entitlements: {
      premium: { product_identifier, expires_date, grace_period_expires_date: null, ...extra },
    },
  },
});

const response = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: jest.fn(async () => body),
});

describe('AI quota plan resolution', () => {
  const now = Date.parse('2026-08-04T12:00:00Z');

  test('uses server UTC month and fixed plan limits', () => {
    expect(getServerPeriod(new Date('2026-09-01T00:30:00Z'))).toBe('2026-09');
    expect(getAiLimit('free')).toBe(10);
    expect(getAiLimit('monthly')).toBe(300);
    expect(getAiLimit('annual')).toBe(500);
  });

  test('recognizes active monthly, annual, lifetime, expiration, and grace period', () => {
    expect(planFromRevenueCatPayload(
      entitlementPayload('rw_premium_monthly', '2026-09-01T00:00:00Z'), now,
    )).toBe('monthly');
    expect(planFromRevenueCatPayload(
      entitlementPayload('rw_premium_annual', '2026-09-01T00:00:00Z'), now,
    )).toBe('annual');
    expect(planFromRevenueCatPayload(
      entitlementPayload('rw_premium_annual:annual-base', '2026-09-01T00:00:00Z'), now,
    )).toBe('annual');
    expect(planFromRevenueCatPayload(
      entitlementPayload('rw_premium_monthly:monthly-base', '2026-09-01T00:00:00Z'), now,
    )).toBe('monthly');
    expect(planFromRevenueCatPayload(
      entitlementPayload('future_product', null), now,
    )).toBe('monthly');
    expect(planFromRevenueCatPayload(
      entitlementPayload('rw_premium_annual', '2026-08-01T00:00:00Z'), now,
    )).toBe('free');
    expect(planFromRevenueCatPayload(entitlementPayload(
      'rw_premium_monthly',
      '2026-08-01T00:00:00Z',
      { grace_period_expires_date: '2026-08-10T00:00:00Z' },
    ), now)).toBe('monthly');
  });

  test('checks both public app keys and keeps the most generous active plan', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response({ subscriber: { entitlements: {} } }))
      .mockResolvedValueOnce(response(
        entitlementPayload('rw_premium_annual', '2026-09-01T00:00:00Z'),
      ));

    await expect(fetchRevenueCatPlan({
      uid: 'user/with spaces',
      readEnvironment: () => undefined,
      fetchImpl,
      nowMillis: now,
    })).resolves.toBe('annual');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('user%2Fwith%20spaces');
  });

  test('does not downgrade to free when one platform cannot be verified', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response({ subscriber: { entitlements: {} } }))
      .mockRejectedValueOnce(new Error('network'));

    await expect(fetchRevenueCatPlan({
      uid: 'u1',
      readEnvironment: () => undefined,
      fetchImpl,
      nowMillis: now,
    })).rejects.toBeInstanceOf(AiPlanUnavailableError);
  });

  test('overrides each platform key independently and keeps the other default', async () => {
    const fetchImpl = jest.fn(async () => response({ subscriber: { entitlements: {} } }));
    await expect(fetchRevenueCatPlan({
      uid: 'u1',
      readEnvironment: (name: string) => name === 'REVENUECAT_API_KEY_IOS'
        ? 'custom-ios-key'
        : undefined,
      fetchImpl,
      nowMillis: now,
    })).resolves.toBe('free');

    const authorizationHeaders = fetchImpl.mock.calls.map((call) => call[1].headers.Authorization);
    expect(authorizationHeaders).toEqual(expect.arrayContaining([
      'Bearer custom-ios-key',
      'Bearer goog_aKsCjpPqkzKinXhwufRpskMPshE',
    ]));
    expect(authorizationHeaders).not.toContain('Bearer appl_jblkeYYOWmUvXGfASJfjLVdYcXp');
  });

  test('aborts hanging platform requests and fails closed after the timeout', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }));

    const plan = fetchRevenueCatPlan({
      uid: 'u1',
      readEnvironment: () => undefined,
      fetchImpl,
      nowMillis: now,
      timeoutMs: 25,
    });
    const rejection = expect(plan).rejects.toBeInstanceOf(AiPlanUnavailableError);
    await jest.advanceTimersByTimeAsync(25);

    await rejection;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every((call) => call[1].signal.aborted)).toBe(true);
    jest.useRealTimers();
  });

  test('active promo wins without contacting RevenueCat', async () => {
    const fetchImpl = jest.fn();
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({ exists: true, data: () => ({ active: true }) })),
        })),
      })),
    };

    await expect(resolveAiPlan({ db, uid: 'promo-user', fetchImpl, nowMillis: now }))
      .resolves.toBe('annual');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
