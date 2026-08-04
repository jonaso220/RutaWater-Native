import {
  createGroupWithRetry,
  DEFAULT_GROUP_CREATION_MAX_ATTEMPTS,
  GroupCreationRequestError,
} from '../groupCreationRetry';

describe('createGroupWithRetry', () => {
  test('backs off across cooperative 202 responses until activation', async () => {
    const attempts = [
      { status: 202, payload: { code: 'RETRY_REQUIRED', retryAfterMs: 100 } },
      { status: 202, payload: { code: 'RETRY_REQUIRED', retryAfterMs: 200 } },
      {
        status: 200,
        payload: { success: true, groupId: 'group-1', code: 'ABC234' },
      },
    ];
    const send = jest.fn(async () => attempts.shift()!);
    const sleep = jest.fn(async () => {});

    await expect(createGroupWithRetry(send, { sleep })).resolves.toEqual({
      success: true,
      groupId: 'group-1',
      code: 'ABC234',
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  test('has a hard retry cap and never loops indefinitely', async () => {
    const send = jest.fn(async () => ({
      status: 202,
      payload: { code: 'RETRY_REQUIRED', retryAfterMs: 1 },
    }));
    await expect(createGroupWithRetry(send, {
      maxAttempts: 3,
      sleep: async () => {},
    })).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' });
    expect(send).toHaveBeenCalledTimes(3);
  });

  test('default cap covers 18 migration pages plus the idempotent success call', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ status: 202, payload: { code: 'RETRY_REQUIRED', retryAfterMs: 1 } });
    for (let page = 1; page < 18; page += 1) {
      send.mockResolvedValueOnce({
        status: 202,
        payload: { code: 'RETRY_REQUIRED', retryAfterMs: 1 },
      });
    }
    send.mockResolvedValueOnce({
      status: 200,
      payload: { success: true, groupId: 'group-8k', code: 'MAX234' },
    });
    const sleep = jest.fn(async () => {});

    await expect(createGroupWithRetry(send, { sleep })).resolves.toEqual({
      success: true,
      groupId: 'group-8k',
      code: 'MAX234',
    });
    expect(DEFAULT_GROUP_CREATION_MAX_ATTEMPTS).toBeGreaterThan(18);
    expect(send).toHaveBeenCalledTimes(19);
    expect(sleep).toHaveBeenCalledTimes(18);
  });

  test('retries a lost network response because the backend may have reserved the group', async () => {
    const send = jest.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({
        status: 200,
        payload: { success: true, groupId: 'group-1', code: 'ABC234' },
      });
    const sleep = jest.fn(async () => {});

    await expect(createGroupWithRetry(send, { sleep })).resolves.toMatchObject({
      groupId: 'group-1',
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  test('retries a 5xx response and accepts the next idempotent success', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ status: 500, payload: { code: 'SERVER_ERROR' } })
      .mockResolvedValueOnce({
        status: 200,
        payload: { success: true, groupId: 'group-1', code: 'ABC234' },
      });
    const sleep = jest.fn(async () => {});

    await expect(createGroupWithRetry(send, { sleep })).resolves.toMatchObject({
      groupId: 'group-1',
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  test('does not retry an explicit permanent client error', async () => {
    const send = jest.fn(async () => {
      throw new GroupCreationRequestError('AUTH_REQUIRED');
    });
    const sleep = jest.fn(async () => {});

    await expect(createGroupWithRetry(send, { sleep })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('surfaces the free-budget code without retrying', async () => {
    const send = jest.fn(async () => ({
      status: 422,
      payload: { code: 'FREE_MIGRATION_LIMIT' },
    }));
    await expect(createGroupWithRetry(send)).rejects.toEqual(
      new GroupCreationRequestError('FREE_MIGRATION_LIMIT'),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
