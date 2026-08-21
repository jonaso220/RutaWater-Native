import { normalizePhone, normalizePhoneForComparison } from '../helpers';

describe('normalizePhone', () => {
  test('strips the local 0 after +598 (WhatsApp paste)', () => {
    expect(normalizePhone('+598 099 123 456')).toBe('59899123456');
    expect(normalizePhone('+598 09 912 3456')).toBe('59899123456');
    expect(normalizePhone('598 099 123 456')).toBe('59899123456');
    expect(normalizePhone('598099123456')).toBe('59899123456');
    expect(normalizePhone('+598099123456')).toBe('59899123456');
  });

  test('leaves a correct E.164 Uruguay mobile alone', () => {
    expect(normalizePhone('+598 99 123 456')).toBe('59899123456');
    expect(normalizePhone('59899123456')).toBe('59899123456');
    expect(normalizePhone('598 99 123 456')).toBe('59899123456');
  });

  test('local formats still get 598 and drop the trunk 0', () => {
    expect(normalizePhone('099 123 456')).toBe('59899123456');
    expect(normalizePhone('099123456')).toBe('59899123456');
    expect(normalizePhone('99123456')).toBe('59899123456');
    expect(normalizePhone('098 979 011')).toBe('59898979011');
  });

  test('Uruguay landline with trunk 0 after 598', () => {
    expect(normalizePhone('+598 02 401 2345')).toBe('59824012345');
    expect(normalizePhone('59824012345')).toBe('59824012345');
  });

  test('does not rewrite other country codes', () => {
    expect(normalizePhone('+54 11 5555 1234')).toBe('541155551234');
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671');
  });

  test('empty / non-digits', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone('abc')).toBe('');
  });
});

describe('normalizePhone vs normalizePhoneForComparison', () => {
  test('WhatsApp +598 0… and local 09… compare as the same mobile', () => {
    const variants = [
      '+598 099 123 456',
      '598099123456',
      '099123456',
      '99123456',
      '+598 99 123 456',
    ];
    const keys = variants.map(normalizePhoneForComparison);
    expect(new Set(keys)).toEqual(new Set(['99123456']));
    const dial = variants.map(normalizePhone);
    expect(new Set(dial)).toEqual(new Set(['59899123456']));
  });
});
