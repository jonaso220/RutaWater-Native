import { recoverProfileIndex } from '../profileIndexRecovery';

const response = (status: number, payload: unknown = { status: 'ok', profileIds: [] }) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn(async () => payload),
}) as unknown as Response;

describe('profile index recovery request', () => {
  test('returns a sanitized, deduplicated index', async () => {
    const user = {
      uid: 'user-1',
      getIdToken: jest.fn(async () => 'token'),
    };
    const fetchImpl = jest.fn(async () => response(200, {
      status: 'ok',
      profileIds: ['route-a', '', 'route-a', 'route-b', 7],
      profileIndexVersion: 1,
    })) as unknown as typeof fetch;

    await expect(recoverProfileIndex({
      user,
      expectedUid: 'user-1',
      endpoint: 'https://api.test/sync-profile-ids',
      fetchImpl,
    })).resolves.toEqual({
      profileIds: ['route-a', 'route-b'],
      profileIndexVersion: 1,
    });
    expect(user.getIdToken).toHaveBeenCalledWith(false);
  });

  test('refreshes the Firebase token once after a 401', async () => {
    const user = {
      uid: 'user-1',
      getIdToken: jest.fn(async (forceRefresh = false) => forceRefresh ? 'fresh' : 'cached'),
    };
    const fetchImpl = (jest.fn()
      .mockResolvedValueOnce(response(401, { status: 'error' }))
      .mockResolvedValueOnce(response(200, { status: 'ok', profileIds: ['route-a'] }))) as unknown as typeof fetch;

    await expect(recoverProfileIndex({
      user,
      expectedUid: 'user-1',
      endpoint: 'https://api.test/sync-profile-ids',
      fetchImpl,
    })).resolves.toEqual({ profileIds: ['route-a'], profileIndexVersion: 1 });
    expect(user.getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(user.getIdToken).toHaveBeenNthCalledWith(2, true);
  });

  test.each([
    [500, 'PROFILE_INDEX_HTTP_500'],
    [404, 'PROFILE_INDEX_HTTP_404'],
  ])('classifies HTTP %s without exposing a response body', async (status, code) => {
    const user = { uid: 'user-1', getIdToken: jest.fn(async () => 'token') };
    const fetchImpl = (jest.fn(async () => response(status, { private: 'details' }))) as unknown as typeof fetch;
    await expect(recoverProfileIndex({
      user,
      expectedUid: 'user-1',
      endpoint: 'https://api.test/sync-profile-ids',
      fetchImpl,
    })).rejects.toThrow(code);
  });

  test('rejects invalid payloads and stale authenticated users', async () => {
    const user = { uid: 'user-1', getIdToken: jest.fn(async () => 'token') };
    const fetchImpl = (jest.fn(async () => response(200, { status: 'ok', profileIds: 'bad' }))) as unknown as typeof fetch;
    await expect(recoverProfileIndex({
      user,
      expectedUid: 'user-1',
      endpoint: 'https://api.test/sync-profile-ids',
      fetchImpl,
    })).rejects.toThrow('PROFILE_INDEX_INVALID_RESPONSE');
    await expect(recoverProfileIndex({
      user,
      expectedUid: 'user-2',
      endpoint: 'https://api.test/sync-profile-ids',
      fetchImpl,
    })).rejects.toThrow('PROFILE_INDEX_AUTH_CHANGED');
  });

  test('classifies aborted and network requests', async () => {
    const user = { uid: 'user-1', getIdToken: jest.fn(async () => 'token') };
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = (jest.fn()
      .mockRejectedValueOnce(aborted)
      .mockRejectedValueOnce(new Error('socket detail'))) as unknown as typeof fetch;
    const input = {
      user,
      expectedUid: 'user-1',
      endpoint: 'https://api.test/sync-profile-ids',
      fetchImpl,
    };
    await expect(recoverProfileIndex(input)).rejects.toThrow('PROFILE_INDEX_TIMEOUT');
    await expect(recoverProfileIndex(input)).rejects.toThrow('PROFILE_INDEX_NETWORK_FAILED');
  });
});
