import { Platform } from 'react-native';
export {
  ENTITLEMENT_ID,
  PRODUCT_ID_ANNUAL,
  PRODUCT_ID_MONTHLY,
} from './subscriptionProducts';

// RevenueCat public SDK API keys (safe to embed — not secrets)
export const REVENUECAT_API_KEY_IOS = 'appl_jblkeYYOWmUvXGfASJfjLVdYcXp';
export const REVENUECAT_API_KEY_ANDROID = 'goog_aKsCjpPqkzKinXhwufRpskMPshE';

export const REVENUECAT_API_KEY =
  Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;

// Free tier limit
export const FREE_CLIENT_LIMIT = 60;
