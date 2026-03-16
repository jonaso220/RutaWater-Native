import { Platform } from 'react-native';

// RevenueCat public SDK API keys (safe to embed — not secrets)
export const REVENUECAT_API_KEY_IOS = 'appl_jblkeYYOWmUvXGfASJfjLVdYcXp';
export const REVENUECAT_API_KEY_ANDROID = ''; // TODO: Add when Google Play Console is ready

export const REVENUECAT_API_KEY =
  Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;

// RevenueCat entitlement identifier (must match RevenueCat dashboard)
export const ENTITLEMENT_ID = 'premium';

// Free tier limit
export const FREE_CLIENT_LIMIT = 60;

// Product identifiers (must match App Store Connect & RevenueCat)
export const PRODUCT_ID_MONTHLY = 'rw_premium_monthly';
export const PRODUCT_ID_ANNUAL = 'rw_premium_annual';

// Promo codes that grant free premium (add codes here)
export const PROMO_CODES: Record<string, string> = {
  RUTAFAMILIA: 'lifetime',   // Para familia
  RUTAAMIGOS: 'lifetime',    // Para amigos
  RUTAVIP2026: 'lifetime',   // VIP
};
