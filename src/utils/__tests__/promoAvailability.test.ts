import { isDeveloperPromoRedemptionAvailable } from '../promoAvailability';

describe('developer promo redemption availability', () => {
  test('is disabled on iOS', () => {
    expect(isDeveloperPromoRedemptionAvailable('ios')).toBe(false);
  });

  test('remains available on Android', () => {
    expect(isDeveloperPromoRedemptionAvailable('android')).toBe(true);
  });
});
