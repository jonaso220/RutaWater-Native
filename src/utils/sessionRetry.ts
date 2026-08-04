export interface SessionRetryPlan {
  attemptCount: number;
  shouldSchedule: boolean;
  delayMs: number;
}

/**
 * Records one failed attempt and plans a bounded exponential retry.
 * `maxAttempts` includes the request that just failed, so maxAttempts=5
 * performs at most five requests before pausing until the caller explicitly
 * resets its session/foreground budget.
 */
export const planSessionRetry = (
  previousAttemptCount: number,
  maxAttempts = 5,
  baseDelayMs = 1_000,
  maxDelayMs = 30_000,
): SessionRetryPlan => {
  const safePrevious = Number.isInteger(previousAttemptCount)
    ? Math.max(0, previousAttemptCount)
    : 0;
  const safeMaximum = Number.isInteger(maxAttempts) ? Math.max(1, maxAttempts) : 1;
  const attemptCount = Math.min(safePrevious + 1, safeMaximum);
  const delayMs = Math.min(
    Math.max(0, maxDelayMs),
    Math.max(0, baseDelayMs) * (2 ** Math.min(safePrevious, 5)),
  );

  return {
    attemptCount,
    shouldSchedule: attemptCount < safeMaximum,
    delayMs,
  };
};
