const ENTITLEMENT_ID = 'premium';
const PRODUCT_ID_MONTHLY = 'rw_premium_monthly';
const PRODUCT_ID_ANNUAL = 'rw_premium_annual';

// Son claves publicas del SDK (las mismas que ya viajan en la app). RevenueCat
// permite consultar Customer Info con una public API key. Mantener overrides
// por entorno facilita rotarlas sin convertirlas en secretos ni pagar webhooks.
const DEFAULT_REVENUECAT_API_KEYS = Object.freeze({
  ios: 'appl_jblkeYYOWmUvXGfASJfjLVdYcXp',
  android: 'goog_aKsCjpPqkzKinXhwufRpskMPshE',
});
const REVENUECAT_TIMEOUT_MS = 4000;

class PlanUnavailableError extends Error {
  constructor(message = 'No se pudo verificar el plan de RevenueCat.') {
    super(message);
    this.name = 'PlanUnavailableError';
  }
}

const activeUntil = (entitlement) => {
  if (!entitlement || typeof entitlement !== 'object') return null;
  const grace = entitlement.grace_period_expires_date;
  const expiration = entitlement.expires_date;
  if (grace && (!expiration || Date.parse(grace) > Date.parse(expiration))) return grace;
  return expiration ?? null;
};

const planFromRevenueCatPayload = (payload, nowMillis = Date.now()) => {
  const entitlement = payload?.subscriber?.entitlements?.[ENTITLEMENT_ID];
  if (!entitlement) return 'free';

  const until = activeUntil(entitlement);
  if (until !== null) {
    const expiresAt = Date.parse(until);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMillis) return 'free';
  }

  // En Google Play RevenueCat puede devolver `subscriptionId:basePlanId`.
  // El contrato de la app usa el subscriptionId, por eso se elimina el sufijo.
  const productIdentifier = typeof entitlement.product_identifier === 'string'
    ? entitlement.product_identifier.split(':', 1)[0]
    : '';
  if (productIdentifier === PRODUCT_ID_ANNUAL) return 'annual';
  if (productIdentifier === PRODUCT_ID_MONTHLY) return 'monthly';

  // Un entitlement Premium vigente nunca debe perder acceso por un producto
  // nuevo o renombrado. Se lo trata como el plan Premium mensual hasta reconocerlo.
  return 'monthly';
};

const configuredRevenueCatKeys = (readEnvironment) => {
  const ios = readEnvironment?.('REVENUECAT_API_KEY_IOS')
    || DEFAULT_REVENUECAT_API_KEYS.ios;
  const android = readEnvironment?.('REVENUECAT_API_KEY_ANDROID')
    || DEFAULT_REVENUECAT_API_KEYS.android;
  return [...new Set([ios, android])];
};

const fetchWithTimeout = async (fetchImpl, url, init, timeoutMs) => {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('RevenueCat timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchRevenueCatPlan = async ({
  uid,
  readEnvironment,
  fetchImpl = fetch,
  nowMillis = Date.now(),
  timeoutMs = REVENUECAT_TIMEOUT_MS,
}) => {
  const keys = configuredRevenueCatKeys(readEnvironment);
  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`;

  const settled = await Promise.allSettled(keys.map(async (apiKey) => {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    }, timeoutMs);
    if (!response.ok) {
      throw new Error(`RevenueCat HTTP ${response.status}`);
    }
    return planFromRevenueCatPayload(await response.json(), nowMillis);
  }));

  const plans = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value);

  if (plans.includes('annual')) return 'annual';
  if (plans.includes('monthly')) return 'monthly';

  // Solo declarar Free cuando todas las apps respondieron. Si una plataforma
  // falla, no degradamos por error a una persona que podria ser suscriptora.
  if (plans.length === keys.length) return 'free';
  throw new PlanUnavailableError();
};

const promoIsActive = (data, nowMillis) => {
  if (data?.active !== true) return false;
  if (!data.expiresAt) return true;
  const expiresAt = typeof data.expiresAt.toMillis === 'function'
    ? data.expiresAt.toMillis()
    : Date.parse(data.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > nowMillis;
};

const resolveSubscriptionPlan = async ({
  db,
  uid,
  readEnvironment,
  fetchImpl = fetch,
  nowMillis = Date.now(),
}) => {
  const promo = await db.collection('premiumOverrides').doc(uid).get();
  if (promo.exists && promoIsActive(promo.data(), nowMillis)) return 'annual';

  return fetchRevenueCatPlan({ uid, readEnvironment, fetchImpl, nowMillis });
};

module.exports = {
  PlanUnavailableError,
  REVENUECAT_TIMEOUT_MS,
  fetchRevenueCatPlan,
  planFromRevenueCatPayload,
  resolveSubscriptionPlan,
};
