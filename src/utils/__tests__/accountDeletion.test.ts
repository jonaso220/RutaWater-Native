import {
  isRecentAuthentication,
  selectDeterministicSuccessor,
} from '../accountDeletion';

describe('account deletion planning', () => {
  test('chooses the same eligible successor regardless of member order', () => {
    expect(selectDeterministicSuccessor(['owner', 'zeta', 'alpha'], 'owner')).toBe('alpha');
    expect(selectDeterministicSuccessor(['zeta', 'owner', 'alpha', 'alpha'], 'owner')).toBe('alpha');
  });

  test('returns null when deleting the only membership', () => {
    expect(selectDeterministicSuccessor(['owner'], 'owner')).toBeNull();
  });

  test('requires a recent, valid authentication timestamp', () => {
    const now = Date.parse('2026-08-04T20:00:00.000Z');
    expect(isRecentAuthentication('2026-08-04T19:57:00.000Z', now)).toBe(true);
    expect(isRecentAuthentication('2026-08-04T19:55:00.000Z', now)).toBe(false);
    expect(isRecentAuthentication('invalid', now)).toBe(false);
    expect(isRecentAuthentication('2026-08-04T20:01:00.000Z', now)).toBe(false);
  });
});
