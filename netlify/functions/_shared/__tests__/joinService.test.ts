import { normalizeInviteCode } from '../joinService';
import { allowJoinAttempt } from '../joinEndpoint';

describe('join service invite validation', () => {
  test.each([
    [' abc234 ', 'ABC234'],
    ['ABCDEFG', null],
    ['ABC01I', null],
    ['', null],
    [null, null],
  ])('normalizes %p without accepting ambiguous or malformed codes', (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });
});

describe('join endpoint burst limiter', () => {
  test('allows twenty attempts per uid and resets on the next minute', () => {
    const uid = `rate-${Date.now()}`;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(allowJoinAttempt(uid, 1_000)).toBe(true);
    }
    expect(allowJoinAttempt(uid, 1_000)).toBe(false);
    expect(allowJoinAttempt(uid, 61_000)).toBe(true);
  });
});
