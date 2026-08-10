import { isReadySettingsGeneration } from '../settingsScope';

describe('isReadySettingsGeneration', () => {
  test('rejects a queued action from an older retry generation', () => {
    const current = { scopeKey: 'group-a', generation: 2, loaded: true };
    expect(isReadySettingsGeneration('group-a', 1, current)).toBe(false);
    expect(isReadySettingsGeneration('group-a', 2, current)).toBe(true);
  });

  test('rejects unloaded and cross-scope snapshots', () => {
    expect(isReadySettingsGeneration('group-b', 2, {
      scopeKey: 'group-a',
      generation: 2,
      loaded: true,
    })).toBe(false);
    expect(isReadySettingsGeneration('group-a', 2, {
      scopeKey: 'group-a',
      generation: 2,
      loaded: false,
    })).toBe(false);
  });
});
