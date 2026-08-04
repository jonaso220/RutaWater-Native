import {
  createPromoCodeDigest,
  isPromoCodeShapeValid,
  isPromoCodeUsable,
  normalizePromoCode,
} from '../promoCode';

describe('promo code helpers', () => {
  test('normalizes without accepting unsupported characters', () => {
    expect(normalizePromoCode('  rw-abc234  ')).toBe('RW-ABC234');
    expect(isPromoCodeShapeValid('RW-ABC234')).toBe(true);
    expect(isPromoCodeShapeValid('RW ABC234')).toBe(false);
    expect(isPromoCodeShapeValid('short')).toBe(false);
  });

  test('creates a stable keyed digest without returning the plain code', () => {
    const code = 'RW-ABCDEFGHJKLMNP';
    const digest = createPromoCodeDigest(code, 'p'.repeat(32));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(code);
    expect(createPromoCodeDigest(code.toLowerCase(), 'p'.repeat(32))).toBe(digest);
  });

  test('requires a strong server pepper', () => {
    expect(() => createPromoCodeDigest('RW-ABCDEFGH', 'weak')).toThrow(/32/);
  });

  test('rejects inactive, expired, malformed, or assigned-to-another-user codes', () => {
    const now = Date.parse('2026-08-04T12:00:00Z');
    expect(isPromoCodeUsable({ active: true, type: 'lifetime', maxUses: 1 }, 'u1', now)).toBe(true);
    expect(isPromoCodeUsable({ active: false, type: 'lifetime', maxUses: 1 }, 'u1', now)).toBe(false);
    expect(isPromoCodeUsable({ active: true, type: 'monthly', maxUses: 1 }, 'u1', now)).toBe(false);
    expect(isPromoCodeUsable({ active: true, type: 'lifetime', maxUses: 0 }, 'u1', now)).toBe(false);
    expect(isPromoCodeUsable({ active: true, type: 'lifetime', maxUses: 1, expiresAt: now }, 'u1', now)).toBe(false);
    expect(isPromoCodeUsable({ active: true, type: 'lifetime', maxUses: 1, assignedUid: 'u2' }, 'u1', now)).toBe(false);
  });
});
