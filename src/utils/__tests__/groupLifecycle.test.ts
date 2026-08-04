import {
  MAX_ATOMIC_GROUP_MEMBERS,
  canDissolveGroupAtomically,
} from '../groupLifecycle';

describe('atomic family-group dissolution limits', () => {
  test('reserves four writes for profile, settings, group, and invite-code cleanup', () => {
    expect(MAX_ATOMIC_GROUP_MEMBERS).toBe(496);
    expect(canDissolveGroupAtomically(496)).toBe(true);
    expect(canDissolveGroupAtomically(497)).toBe(false);
  });

  test('requires a real member set', () => {
    expect(canDissolveGroupAtomically(0)).toBe(false);
    expect(canDissolveGroupAtomically(-1)).toBe(false);
    expect(canDissolveGroupAtomically(1.5)).toBe(false);
  });
});
