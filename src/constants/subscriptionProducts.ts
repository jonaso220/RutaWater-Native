// Contrato puro con App Store Connect, Google Play y RevenueCat. Separado de
// `subscription.ts` para que la lógica de precios pueda probarse sin cargar el
// módulo nativo `react-native`.
export const ENTITLEMENT_ID = 'premium';
export const PRODUCT_ID_MONTHLY = 'rw_premium_monthly';
export const PRODUCT_ID_ANNUAL = 'rw_premium_annual';
