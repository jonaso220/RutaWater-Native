export interface GroupCreationSuccess {
  success: true;
  groupId: string;
  code: string;
}

export interface GroupCreationAttempt {
  status: number;
  payload: {
    success?: boolean;
    groupId?: string;
    code?: string;
    retryAfterMs?: number;
  };
}

export class GroupCreationRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'GroupCreationRequestError';
  }
}

const defaultSleep = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

// 8,000 attributed documents require up to 18 populated 450-document pages.
// Leave bounded room for collection-completion pages and transient transport
// failures without allowing an unbounded request loop on the phone.
export const DEFAULT_GROUP_CREATION_MAX_ATTEMPTS = 24;

const retryDelayMs = (attempt: number, serverDelayMs?: number): number => {
  const serverDelay = Number(serverDelayMs);
  return Number.isFinite(serverDelay) && serverDelay > 0
    ? Math.min(serverDelay, 5_000)
    : Math.min(500 * (2 ** attempt), 4_000);
};

/** Bounded phone-side continuation for the server's durable migration cursor. */
export const createGroupWithRetry = async (
  sendAttempt: () => Promise<GroupCreationAttempt>,
  options: {
    maxAttempts?: number;
    sleep?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<GroupCreationSuccess> => {
  const maxAttempts = options.maxAttempts ?? DEFAULT_GROUP_CREATION_MAX_ATTEMPTS;
  const sleep = options.sleep || defaultSleep;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: GroupCreationAttempt;
    try {
      response = await sendAttempt();
    } catch (error) {
      // Callers use this typed error for permanent local failures such as a
      // missing authenticated user. Fetch/network failures remain retryable:
      // the server may already have installed pendingGroupId before the
      // response connection was interrupted.
      if (error instanceof GroupCreationRequestError) throw error;
      if (attempt === maxAttempts - 1) break;
      await sleep(retryDelayMs(attempt));
      continue;
    }
    const { payload } = response;
    if (
      response.status >= 200
      && response.status < 300
      && payload.success === true
      && typeof payload.groupId === 'string'
      && payload.groupId
      && typeof payload.code === 'string'
      && payload.code
    ) {
      return {
        success: true,
        groupId: payload.groupId,
        code: payload.code,
      };
    }
    const cooperativeContinuation = response.status === 202
      && payload.code === 'RETRY_REQUIRED';
    const transientServerFailure = response.status >= 500 && response.status < 600;
    if (cooperativeContinuation || transientServerFailure) {
      if (attempt === maxAttempts - 1) break;
      await sleep(retryDelayMs(attempt, payload.retryAfterMs));
      continue;
    }
    throw new GroupCreationRequestError(payload.code || 'CREATE_GROUP_FAILED');
  }
  throw new GroupCreationRequestError('RETRY_EXHAUSTED');
};
