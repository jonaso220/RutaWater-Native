export const liveSnapshotGeneration = (scopeKey: string, readVersion: number): string =>
  `${scopeKey}:${readVersion}`;

export const isLiveSnapshotReady = (
  readyGeneration: string,
  currentGeneration: string,
): boolean => readyGeneration === currentGeneration;
