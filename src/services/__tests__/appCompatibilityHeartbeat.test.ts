export {};

const mockGetInstallationId = jest.fn();
const mockGetVersion = jest.fn();
const mockGetBuildNumber = jest.fn();
let mockCurrentUser: { uid: string } | null = { uid: 'user-1' };

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-firebase/installations', () => ({
  __esModule: true,
  default: () => ({ getId: mockGetInstallationId }),
}));
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getVersion: mockGetVersion,
    getBuildNumber: mockGetBuildNumber,
  },
}));
jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  default: () => ({ currentUser: mockCurrentUser }),
}));
jest.mock('../../config/api', () => ({
  API_ENDPOINTS: { reportAppVersion: 'https://api.test/report-app-version' },
}));

const response = (status = 200, payload: unknown = { status: 'ok' }) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn(async () => payload),
});

const loadReporter = () => require('../appCompatibilityHeartbeat') as typeof import('../appCompatibilityHeartbeat');

describe('app compatibility heartbeat', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockCurrentUser = { uid: 'user-1' };
    mockGetInstallationId.mockResolvedValue('cdefghijklmnopqrstuvwx');
    mockGetVersion.mockReturnValue('1.50');
    mockGetBuildNumber.mockReturnValue('55');
    global.fetch = jest.fn(async () => response()) as jest.Mock;
  });

  test('reports runtime version, build and Firebase Installation ID with auth', async () => {
    const user = { uid: 'user-1', getIdToken: jest.fn(async () => 'id-token') } as any;
    const { reportAppCompatibility } = loadReporter();

    await reportAppCompatibility(user);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/report-app-version',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer id-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'ios',
          appVersion: '1.50',
          buildNumber: 55,
          installationId: 'cdefghijklmnopqrstuvwx',
        }),
      }),
    );
  });

  test('throttles successful reports for the same account and installation', async () => {
    const user = { uid: 'user-1', getIdToken: jest.fn(async () => 'id-token') } as any;
    const { reportAppCompatibility } = loadReporter();

    await reportAppCompatibility(user);
    await reportAppCompatibility(user);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('drops a delayed request after the authenticated account changes', async () => {
    let resolveToken: ((value: string) => void) | undefined;
    const token = new Promise<string>((resolve) => { resolveToken = resolve; });
    const user = { uid: 'user-1', getIdToken: jest.fn(() => token) } as any;
    const { reportAppCompatibility } = loadReporter();
    const pending = reportAppCompatibility(user);

    mockCurrentUser = { uid: 'user-2' };
    resolveToken?.('late-token');
    await pending;

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('does not mark a failed report as successful and retries later', async () => {
    const user = { uid: 'user-1', getIdToken: jest.fn(async () => 'id-token') } as any;
    const { reportAppCompatibility } = loadReporter();
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response());

    await expect(reportAppCompatibility(user)).rejects.toThrow('offline');
    await expect(reportAppCompatibility(user)).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does nothing when the environment has no reporting endpoint', async () => {
    jest.doMock('../../config/api', () => ({
      API_ENDPOINTS: { reportAppVersion: null },
    }));
    const user = { uid: 'user-1', getIdToken: jest.fn(async () => 'id-token') } as any;
    const { reportAppCompatibility } = loadReporter();

    await reportAppCompatibility(user);

    expect(mockGetInstallationId).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
