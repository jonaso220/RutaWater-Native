jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    isConfigured: jest.fn(async () => false),
    setLogLevel: jest.fn(),
    configure: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(async () => ({})),
    getCustomerInfo: jest.fn(),
  },
  LOG_LEVEL: { DEBUG: 'DEBUG' },
  PURCHASES_ERROR_CODE: {
    NETWORK_ERROR: '10',
    LOG_OUT_ANONYMOUS_USER_ERROR: '22',
  },
}));

jest.mock('../../constants/subscription', () => ({
  REVENUECAT_API_KEY: 'public_sdk_key',
}));

import {
  __resetRevenueCatSessionForTests,
  identifyRevenueCatUser,
  isRevenueCatSessionCurrent,
  logoutRevenueCatSession,
} from '../revenueCatSession';

const mockPurchases = jest.requireMock('react-native-purchases').default as {
  isConfigured: jest.Mock;
  setLogLevel: jest.Mock;
  configure: jest.Mock;
  logIn: jest.Mock;
  logOut: jest.Mock;
  getCustomerInfo: jest.Mock;
};

const customerInfo = (id: string) => ({ originalAppUserId: id } as any);

describe('RevenueCat session serialization', () => {
  beforeEach(() => {
    __resetRevenueCatSessionForTests();
    jest.clearAllMocks();
    mockPurchases.isConfigured.mockResolvedValue(false);
    mockPurchases.logOut.mockResolvedValue({} as any);
    mockPurchases.getCustomerInfo.mockResolvedValue(customerInfo('existing'));
  });

  test('a newer Firebase user invalidates a queued older identification', async () => {
    mockPurchases.logIn.mockImplementation(async (id: string) => ({ customerInfo: customerInfo(id) }));

    const first = identifyRevenueCatUser('user-a');
    const second = identifyRevenueCatUser('user-b');
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBeNull();
    expect(secondResult?.customerInfo.originalAppUserId).toBe('user-b');
    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledWith('user-b');
    expect(isRevenueCatSessionCurrent('user-b', secondResult!.generation)).toBe(true);
  });

  test('a late native logIn result cannot overwrite the newer account', async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const firstNativeCall = new Promise<void>((resolve) => { releaseFirst = resolve; });
    mockPurchases.logIn.mockImplementation(async (id: string) => {
      if (id === 'user-a') {
        markStarted();
        await firstNativeCall;
      }
      return { customerInfo: customerInfo(id) };
    });

    const first = identifyRevenueCatUser('user-a');
    await firstStarted;
    const second = identifyRevenueCatUser('user-b');
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBeNull();
    expect(secondResult?.customerInfo.originalAppUserId).toBe('user-b');
    expect(mockPurchases.logIn.mock.calls.map(([id]) => id)).toEqual(['user-a', 'user-b']);
    expect(isRevenueCatSessionCurrent('user-b', secondResult!.generation)).toBe(true);
  });

  test('logout invalidates the active identity before the native transition resolves', async () => {
    mockPurchases.logIn.mockImplementation(async (id: string) => ({ customerInfo: customerInfo(id) }));
    const session = await identifyRevenueCatUser('user-a');
    expect(session).not.toBeNull();
    mockPurchases.logOut.mockClear();

    const logout = logoutRevenueCatSession();
    expect(isRevenueCatSessionCurrent('user-a', session!.generation)).toBe(false);
    await logout;

    expect(mockPurchases.logOut).toHaveBeenCalledTimes(1);
  });

  test('queued cleanup A logs out A before identifying B', async () => {
    const events: string[] = [];
    mockPurchases.logIn.mockImplementation(async (id: string) => {
      events.push(`login:${id}`);
      return { customerInfo: customerInfo(id) };
    });
    mockPurchases.logOut.mockImplementation(async () => {
      events.push('logout');
      return {} as any;
    });

    await identifyRevenueCatUser('user-a');
    events.length = 0;
    const cleanupA = logoutRevenueCatSession('user-a');
    const identifyB = identifyRevenueCatUser('user-b');
    await Promise.all([cleanupA, identifyB]);

    expect(events).toEqual(['logout', 'login:user-b']);
  });

  test('a stale cleanup for A never signs out an already identified B', async () => {
    mockPurchases.logIn.mockImplementation(async (id: string) => ({ customerInfo: customerInfo(id) }));
    await identifyRevenueCatUser('user-b');
    mockPurchases.logOut.mockClear();

    await logoutRevenueCatSession('user-a');

    expect(mockPurchases.logOut).not.toHaveBeenCalled();
  });

  test('a real logout failure blocks B until isolation can be retried', async () => {
    mockPurchases.logIn.mockImplementation(async (id: string) => ({ customerInfo: customerInfo(id) }));
    await identifyRevenueCatUser('user-a');
    mockPurchases.logIn.mockClear();
    const networkError = { code: '10', message: 'offline' };
    mockPurchases.logOut.mockRejectedValue(networkError);

    await expect(identifyRevenueCatUser('user-b')).rejects.toBe(networkError);
    expect(mockPurchases.logIn).not.toHaveBeenCalled();

    mockPurchases.logOut.mockResolvedValue({} as any);
    const session = await identifyRevenueCatUser('user-b');
    expect(session?.customerInfo.originalAppUserId).toBe('user-b');
    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
  });

  test('only anonymous logout error code 22 is treated as isolated', async () => {
    mockPurchases.logOut.mockRejectedValue({ code: '22' });
    mockPurchases.logIn.mockImplementation(async (id: string) => ({ customerInfo: customerInfo(id) }));

    await expect(identifyRevenueCatUser('user-a')).resolves.toMatchObject({
      customerInfo: { originalAppUserId: 'user-a' },
    });
    expect(mockPurchases.logIn).toHaveBeenCalledWith('user-a');
  });
});
