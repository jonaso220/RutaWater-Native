export interface ProfileIndexAuthUser {
  uid: string;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export interface RecoveredProfileIndex {
  profileIds: string[];
  profileIndexVersion: number;
}

interface RecoverProfileIndexInput {
  user: ProfileIndexAuthUser;
  expectedUid: string;
  endpoint: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const requestProfileIndex = async (
  input: RecoverProfileIndexInput,
  forceRefresh: boolean,
): Promise<Response> => {
  let token: string;
  try {
    token = await input.user.getIdToken(forceRefresh);
  } catch {
    throw new Error('PROFILE_INDEX_TOKEN_FAILED');
  }
  if (input.user.uid !== input.expectedUid) {
    throw new Error('PROFILE_INDEX_AUTH_CHANGED');
  }
  try {
    return await (input.fetchImpl || fetch)(input.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('PROFILE_INDEX_TIMEOUT');
    }
    throw new Error('PROFILE_INDEX_NETWORK_FAILED');
  }
};

export const recoverProfileIndex = async (
  input: RecoverProfileIndexInput,
): Promise<RecoveredProfileIndex> => {
  if (!input.expectedUid || input.user.uid !== input.expectedUid) {
    throw new Error('PROFILE_INDEX_AUTH_CHANGED');
  }

  let response = await requestProfileIndex(input, false);
  // A cached Firebase token can expire between getIdToken() and the Function.
  // Refresh it once; a second 401 is canonical and left to the caller's retry
  // policy instead of creating an authentication request loop.
  if (response.status === 401) {
    response = await requestProfileIndex(input, true);
  }
  if (!response.ok) {
    throw new Error(`PROFILE_INDEX_HTTP_${response.status}`);
  }

  const payload = await response.json().catch(() => null) as {
    status?: unknown;
    profileIds?: unknown;
    profileIndexVersion?: unknown;
  } | null;
  if (payload?.status !== 'ok' || !Array.isArray(payload.profileIds)) {
    throw new Error('PROFILE_INDEX_INVALID_RESPONSE');
  }
  return {
    profileIds: [...new Set(payload.profileIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ))],
    profileIndexVersion: typeof payload.profileIndexVersion === 'number'
      && payload.profileIndexVersion >= 1
      ? payload.profileIndexVersion
      : 1,
  };
};
