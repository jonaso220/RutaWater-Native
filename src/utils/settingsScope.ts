export interface ReadySettingsGeneration {
  scopeKey: string;
  generation: number;
  loaded: boolean;
}

export const isReadySettingsGeneration = (
  expectedScopeKey: string,
  expectedGeneration: number,
  snapshot: ReadySettingsGeneration,
): boolean => Boolean(
  expectedScopeKey
  && expectedGeneration > 0
  && snapshot.loaded
  && snapshot.scopeKey === expectedScopeKey
  && snapshot.generation === expectedGeneration
);
