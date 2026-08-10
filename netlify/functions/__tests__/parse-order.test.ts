const { AiPlanUnavailableError } = require('../_shared/aiQuota');
const {
  config,
  createModernParseOrderHandler,
  createParseOrderHandler,
} = require('../parse-order');

const validEvent = (overrides: Record<string, unknown> = {}) => ({
  httpMethod: 'POST',
  headers: { Authorization: 'Bearer token' },
  body: JSON.stringify({ text: 'Agendá a Ana', clients: [], todayIso: '2026-08-04' }),
  ...overrides,
});

const makeHandler = (overrides: Record<string, unknown> = {}) => {
  const dependencies = {
    readEnvironment: jest.fn((name: string) => name === 'OPENAI_API_KEY' ? 'configured' : undefined),
    authenticate: jest.fn(async () => ({ sub: 'authenticated-user' })),
    getFirestore: jest.fn(() => ({ id: 'db' })),
    assertAccountActive: jest.fn(async () => undefined),
    resolvePlan: jest.fn(async () => 'free'),
    reserveUsage: jest.fn(async () => ({
      allowed: true,
      count: 1,
      limit: 10,
      period: '2026-08',
      plan: 'free',
    })),
    parse: jest.fn(async () => ({
      tool: 'report_no_action',
      input: { message: 'Nada para hacer' },
    })),
    now: jest.fn(() => new Date('2026-08-04T12:00:00Z')),
    fetchImpl: jest.fn(),
    ...overrides,
  };
  return { handler: createParseOrderHandler(dependencies), dependencies };
};

describe('parse-order quota enforcement', () => {
  afterEach(() => jest.restoreAllMocks());

  test('validates the request before touching Firestore or RevenueCat', async () => {
    const { handler, dependencies } = makeHandler();
    const result = await handler(validEvent({ body: '{bad-json' }));
    expect(result.statusCode).toBe(400);
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
    expect(dependencies.resolvePlan).not.toHaveBeenCalled();
    expect(dependencies.reserveUsage).not.toHaveBeenCalled();
  });

  test('passes a validated custom catalog and locale to the parser', async () => {
    const { handler, dependencies } = makeHandler();
    const catalog = [
      { id: 'custom_1', label: 'Retornable grande', short: 'RetG', hidden: false },
      { id: 'hidden_old', label: 'Producto anterior', short: 'Old', hidden: true },
    ];
    const result = await handler(validEvent({
      body: JSON.stringify({
        text: 'Adicione dois retornáveis',
        clients: [],
        todayIso: '2026-08-04',
        catalog,
        locale: 'pt',
      }),
    }));

    expect(result.statusCode).toBe(200);
    expect(dependencies.parse).toHaveBeenCalledWith(expect.objectContaining({
      productCatalog: catalog,
      locale: 'pt',
    }));
  });

  test.each([
    [{ id: 'dup', label: 'Uno', short: 'U', hidden: false }, { id: 'dup', label: 'Dos', short: 'D', hidden: false }],
    [{ id: 'bad id', label: 'Uno', short: 'U', hidden: false }],
  ])('rejects an invalid catalog before Firestore or quota', async (catalog) => {
    const { handler, dependencies } = makeHandler();
    const result = await handler(validEvent({
      body: JSON.stringify({ text: 'Pedido', clients: [], todayIso: '2026-08-04', catalog }),
    }));
    expect(result.statusCode).toBe(400);
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
    expect(dependencies.reserveUsage).not.toHaveBeenCalled();
    expect(dependencies.parse).not.toHaveBeenCalled();
  });

  test('rejects an unsupported locale and an oversized body before quota', async () => {
    const first = makeHandler();
    const invalidLocale = await first.handler(validEvent({
      body: JSON.stringify({ text: 'Pedido', clients: [], todayIso: '2026-08-04', locale: 'fr' }),
    }));
    expect(invalidLocale.statusCode).toBe(400);
    expect(first.dependencies.reserveUsage).not.toHaveBeenCalled();

    const second = makeHandler();
    const oversized = await second.handler(validEvent({ body: 'x'.repeat(400_001) }));
    expect(oversized.statusCode).toBe(413);
    expect(second.dependencies.getFirestore).not.toHaveBeenCalled();
    expect(second.dependencies.reserveUsage).not.toHaveBeenCalled();
  });

  test('uses only the verified Firebase uid for plan and reservation', async () => {
    const { handler, dependencies } = makeHandler();
    const result = await handler(validEvent({
      body: JSON.stringify({
        text: 'Agendá a Ana',
        clients: [],
        todayIso: '2026-08-04',
        userId: 'victim',
      }),
    }));
    expect(result.statusCode).toBe(200);
    expect(dependencies.resolvePlan).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'authenticated-user',
    }));
    expect(dependencies.assertAccountActive).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'authenticated-user',
    }));
    expect(dependencies.reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'authenticated-user',
    }));
  });

  test('rejects a deleting account before RevenueCat, quota, or the provider', async () => {
    const inactive = Object.assign(new Error('inactive'), { name: 'AiAccountInactiveError' });
    const { handler, dependencies } = makeHandler({
      assertAccountActive: jest.fn(async () => { throw inactive; }),
    });
    const result = await handler(validEvent());
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).code).toBe('ACCOUNT_INACTIVE');
    expect(dependencies.resolvePlan).not.toHaveBeenCalled();
    expect(dependencies.reserveUsage).not.toHaveBeenCalled();
    expect(dependencies.parse).not.toHaveBeenCalled();
  });

  test('returns a structured 429 and never calls the provider at the limit', async () => {
    const { handler, dependencies } = makeHandler({
      reserveUsage: jest.fn(async () => ({
        allowed: false,
        count: 10,
        limit: 10,
        period: '2026-08',
        plan: 'free',
      })),
    });
    const result = await handler(validEvent());
    expect(result.statusCode).toBe(429);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      code: 'AI_LIMIT_REACHED',
      quota: expect.objectContaining({ count: 10, limit: 10 }),
    }));
    expect(dependencies.parse).not.toHaveBeenCalled();
  });

  test('returns quota metadata with a successful provider result', async () => {
    const { handler } = makeHandler();
    const result = await handler(validEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({
      tool: 'report_no_action',
      quota: expect.objectContaining({ count: 1, limit: 10, period: '2026-08' }),
    }));
  });

  test('an attempt sent to the provider remains consumed when the provider fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const parse = jest.fn(async () => { throw new Error('provider failed'); });
    const { handler, dependencies } = makeHandler({ parse });
    const result = await handler(validEvent());
    expect(result.statusCode).toBe(500);
    expect(dependencies.reserveUsage).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test('fails closed without consuming or calling AI when plan verification is unavailable', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, dependencies } = makeHandler({
      resolvePlan: jest.fn(async () => { throw new AiPlanUnavailableError(); }),
    });
    const result = await handler(validEvent());
    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body).code).toBe('AI_PLAN_UNAVAILABLE');
    expect(dependencies.reserveUsage).not.toHaveBeenCalled();
    expect(dependencies.parse).not.toHaveBeenCalled();
  });
});

describe('parse-order modern Netlify adapter', () => {
  test('preserves status, headers and body through the Request/Response contract', async () => {
    const legacyHandler = jest.fn(async () => ({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ status: 'ok' }),
    }));
    const handler = createModernParseOrderHandler(legacyHandler);
    const response = await handler(new Request('https://example.test/api/parse-order', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'pedido' }),
    }));

    expect(config.path).toBe('/api/parse-order');
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      httpMethod: 'POST',
      body: JSON.stringify({ text: 'pedido' }),
      headers: expect.objectContaining({ authorization: 'Bearer token' }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  test('uses a null body for 204 preflight responses', async () => {
    const handler = createModernParseOrderHandler(async () => ({
      statusCode: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '',
    }));
    const response = await handler(new Request('https://example.test/api/parse-order', {
      method: 'OPTIONS',
    }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});
