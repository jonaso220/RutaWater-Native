import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';
import { REVENUECAT_API_KEY } from '../constants/subscription';

export interface RevenueCatSession {
  customerInfo: CustomerInfo;
  generation: number;
}

let configurePromise: Promise<void> | null = null;
let transitionQueue: Promise<void> = Promise.resolve();
let desiredUserId: string | null = null;
let sessionGeneration = 0;
// `undefined` means the native SDK may have restored an identity from a prior
// app session. It must be explicitly isolated before the next Firebase UID is
// identified. `null` is a confirmed anonymous RevenueCat session.
let actualUserId: string | null | undefined;

const ensureConfigured = (): Promise<void> => {
  if (!configurePromise) {
    configurePromise = (async () => {
      if (await Purchases.isConfigured()) return;
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      Purchases.configure({ apiKey: REVENUECAT_API_KEY });
    })().catch((error) => {
      // A transient native initialization failure must be retryable.
      configurePromise = null;
      throw error;
    });
  }
  return configurePromise;
};

const isAlreadyAnonymousError = (error: unknown): boolean => (
  typeof error === 'object'
  && error !== null
  && String((error as { code?: unknown }).code)
    === String(PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR)
);

const logOutNativeSession = async (): Promise<void> => {
  try {
    await Purchases.logOut();
    actualUserId = null;
  } catch (error) {
    if (isAlreadyAnonymousError(error)) {
      actualUserId = null;
      return;
    }
    // A network/configuration/backend failure does not prove isolation. Keep
    // the known/unknown identity so a later identify retries this logout and
    // never aliases the next Firebase user onto the previous RevenueCat user.
    throw error;
  }
};

/**
 * Serializes native RevenueCat identity changes. The SDK is a process-wide
 * singleton, while React hooks are mounted per Firebase session; without this
 * queue a late logIn(A) can overwrite a newer logIn(B) or logOut request.
 */
export const identifyRevenueCatUser = async (
  userId: string,
): Promise<RevenueCatSession | null> => {
  const generation = ++sessionGeneration;
  desiredUserId = userId;
  let result: RevenueCatSession | null = null;

  const transition = transitionQueue.then(async () => {
    if (generation !== sessionGeneration || desiredUserId !== userId) return;
    await ensureConfigured();
    if (generation !== sessionGeneration || desiredUserId !== userId) return;

    let customerInfo: CustomerInfo;
    if (actualUserId === userId) {
      customerInfo = await Purchases.getCustomerInfo();
    } else {
      if (actualUserId !== null) {
        await logOutNativeSession();
        if (generation !== sessionGeneration || desiredUserId !== userId) return;
      }
      ({ customerInfo } = await Purchases.logIn(userId));
      actualUserId = userId;
    }

    if (generation !== sessionGeneration || desiredUserId !== userId) return;
    result = { customerInfo, generation };
  });
  transitionQueue = transition.catch(() => {});
  await transition;
  return result;
};

export const isRevenueCatSessionCurrent = (
  userId: string,
  generation: number,
): boolean => (
  desiredUserId === userId
  && actualUserId === userId
  && sessionGeneration === generation
);

export const logoutRevenueCatSession = async (expectedUserId?: string): Promise<void> => {
  // A hook cleanup only invalidates the identity it mounted for. An explicit
  // sign-out (no expected UID) always invalidates the current desired session.
  if (!expectedUserId || desiredUserId === expectedUserId) {
    ++sessionGeneration;
    desiredUserId = null;
  }

  const transition = transitionQueue.then(async () => {
    if (!configurePromise && !(await Purchases.isConfigured())) {
      actualUserId = null;
      return;
    }
    await ensureConfigured();
    // A stale cleanup for A must not sign out a newer, confirmed B session.
    // Conversely, if cleanup A was queued before identify B, the queue still
    // removes A first, even though B is now the desired identity.
    if (expectedUserId && actualUserId !== undefined && actualUserId !== expectedUserId) return;
    if (actualUserId === null) return;
    await logOutNativeSession();
  });
  transitionQueue = transition.catch(() => {});
  await transition;
};

/** Test-only state reset for the process-wide native singleton coordinator. */
export const __resetRevenueCatSessionForTests = (): void => {
  configurePromise = null;
  transitionQueue = Promise.resolve();
  desiredUserId = null;
  sessionGeneration = 0;
  actualUserId = undefined;
};
