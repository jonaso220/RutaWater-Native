export type WriteOutcome = 'acknowledged' | 'pending' | 'failed';

/**
 * Firestore applies a write to the local cache (and every listener) at once,
 * but its promise only settles when the server acknowledges it — never while
 * offline. Waiting that long keeps editors spinning on a weak connection even
 * though the change is already visible and queued.
 *
 * Resolves with the real outcome when the write settles within `graceMs`
 * (online rejections such as permission errors arrive well within it), or
 * with 'pending' once the grace period elapses. A pending write stays queued
 * in the Firestore SDK and syncs when the connection returns.
 */
export const awaitWriteWithinGrace = (
  write: Promise<unknown>,
  graceMs: number,
): Promise<WriteOutcome> => new Promise((resolve) => {
  let settled = false;
  const finish = (outcome: WriteOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(outcome);
  };
  const timer = setTimeout(() => finish('pending'), graceMs);
  write.then(() => finish('acknowledged'), () => finish('failed'));
});
