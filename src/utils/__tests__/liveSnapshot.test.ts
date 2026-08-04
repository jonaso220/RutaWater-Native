import { isLiveSnapshotReady, liveSnapshotGeneration } from '../liveSnapshot';

describe('authoritative live snapshot readiness', () => {
  test('cached data from a revisited scope stays blocked until its new listener emits', () => {
    const scopeA = liveSnapshotGeneration('scope-a', 0);
    const scopeB = liveSnapshotGeneration('scope-b', 0);
    let readyGeneration = scopeA;

    // React Query may already have cached B data, but readiness belongs to the
    // currently attached listener generation, not cache presence/status.
    expect(isLiveSnapshotReady(readyGeneration, scopeB)).toBe(false);
    readyGeneration = scopeB;
    expect(isLiveSnapshotReady(readyGeneration, scopeB)).toBe(true);
  });

  test('a read-version remount also requires a fresh snapshot', () => {
    const oldGeneration = liveSnapshotGeneration('scope-a', 0);
    const newGeneration = liveSnapshotGeneration('scope-a', 1);
    expect(isLiveSnapshotReady(oldGeneration, newGeneration)).toBe(false);
  });
});
