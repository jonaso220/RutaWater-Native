import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { reportError } from '../lib/crashReporting';
import Purchases, {
  CustomerInfo,
  PurchasesPackage,
} from 'react-native-purchases';
import type { CustomerInfoUpdateListener } from 'react-native-purchases';
import type { INTRO_ELIGIBILITY_STATUS } from 'react-native-purchases';
import { REVENUECAT_API_KEY, ENTITLEMENT_ID } from '../constants/subscription';
import {
  identifyRevenueCatUser,
  isRevenueCatSessionCurrent,
  logoutRevenueCatSession,
} from '../services/revenueCatSession';

export interface SubscriptionState {
  isPremium: boolean;
  loading: boolean;
  currentPlan: 'free' | 'monthly' | 'annual';
  expirationDate: string | null;
  isTrialActive: boolean;
  packages: PurchasesPackage[];
  introEligibility: Record<string, INTRO_ELIGIBILITY_STATUS>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
}

export const useSubscription = ({ userId }: { userId: string | undefined }): SubscriptionState => {
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState<'free' | 'monthly' | 'annual'>('free');
  const [expirationDate, setExpirationDate] = useState<string | null>(null);
  const [isTrialActive, setIsTrialActive] = useState(false);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [introEligibility, setIntroEligibility] = useState<Record<string, INTRO_ELIGIBILITY_STATUS>>({});
  const sessionRef = useRef<{ userId: string; generation: number } | null>(null);

  // Parse customer info into state
  const processCustomerInfo = useCallback((info: CustomerInfo) => {
    const entitlement = info.entitlements.active[ENTITLEMENT_ID];
    const hasPremium = !!entitlement;
    setIsPremium(hasPremium);

    if (hasPremium && entitlement) {
      // Determine plan type from period
      const period = entitlement.periodType;
      if (entitlement.productIdentifier.includes('annual')) {
        setCurrentPlan('annual');
      } else {
        setCurrentPlan('monthly');
      }
      setExpirationDate(entitlement.expirationDate);
      setIsTrialActive(period === 'TRIAL');
    } else {
      setCurrentPlan('free');
      setExpirationDate(null);
      setIsTrialActive(false);
    }
  }, []);

  // Configure RevenueCat and identify user
  useEffect(() => {
    let active = true;
    let customerInfoListener: CustomerInfoUpdateListener | null = null;

    const init = async () => {
      setLoading(true);
      if (!REVENUECAT_API_KEY || !userId) {
        sessionRef.current = null;
        setIsPremium(false);
        setCurrentPlan('free');
        setExpirationDate(null);
        setIsTrialActive(false);
        setPackages([]);
        setIntroEligibility({});
        setLoading(false);
        return;
      }

      // Offerings y elegibilidad pueden depender del App User ID. No mostrar
      // durante el cambio de cuenta datos cacheados de la persona anterior.
      setPackages([]);
      setIntroEligibility({});

      try {
        const session = await identifyRevenueCatUser(userId);
        if (!active || !session || !isRevenueCatSessionCurrent(userId, session.generation)) {
          return;
        }
        sessionRef.current = { userId, generation: session.generation };
        processCustomerInfo(session.customerInfo);

        customerInfoListener = (info) => {
          if (active && isRevenueCatSessionCurrent(userId, session.generation)) {
            processCustomerInfo(info);
          }
        };
        Purchases.addCustomerInfoUpdateListener(customerInfoListener);

        // Load available packages
        const offerings = await Purchases.getOfferings();
        if (!active || !isRevenueCatSessionCurrent(userId, session.generation)) return;
        const availablePackages = offerings.current?.availablePackages || [];
        setPackages(availablePackages);

        // En iOS un producto puede tener trial pero el usuario no ser elegible.
        // RevenueCat recomienda ocultar el claim cuando el estado es unknown.
        if (Platform.OS === 'ios' && availablePackages.length > 0) {
          try {
            const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility(
              availablePackages.map((pkg) => pkg.product.identifier),
            );
            if (!active || !isRevenueCatSessionCurrent(userId, session.generation)) return;
            setIntroEligibility(Object.fromEntries(
              Object.entries(eligibility).map(([id, value]) => [id, value.status]),
            ));
          } catch {
            setIntroEligibility({});
          }
        } else {
          setIntroEligibility({});
        }
      } catch (error) {
        if (active) console.warn('RevenueCat init error (non-fatal):', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void init();
    return () => {
      active = false;
      if (customerInfoListener) {
        Purchases.removeCustomerInfoUpdateListener(customerInfoListener);
      }
      if (sessionRef.current?.userId === userId) sessionRef.current = null;
      // Covers provider-side sign-out/disable events that bypass useAuth.signOut.
      // The expected UID prevents a stale cleanup from signing out a newer
      // Firebase account, while the serialized transition still isolates this
      // account when its cleanup was queued first.
      void logoutRevenueCatSession(userId);
    };
  }, [userId, processCustomerInfo]);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    try {
      const session = sessionRef.current;
      if (!userId || !session || !isRevenueCatSessionCurrent(userId, session.generation)) {
        throw new Error('SUBSCRIPTION_SESSION_CHANGED');
      }
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (!isRevenueCatSessionCurrent(userId, session.generation)) {
        throw new Error('SUBSCRIPTION_SESSION_CHANGED');
      }
      processCustomerInfo(customerInfo);
      if (!customerInfo.entitlements.active[ENTITLEMENT_ID]) {
        // A completed store call without the expected entitlement is not a
        // cancellation and must never fail silently in the paywall.
        throw new Error('PURCHASE_MISSING_ENTITLEMENT');
      }
      return true;
    } catch (error: any) {
      if (error.userCancelled) return false;
      reportError(error, 'Purchase error');
      throw error;
    }
  }, [processCustomerInfo, userId]);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const session = sessionRef.current;
      if (!userId || !session || !isRevenueCatSessionCurrent(userId, session.generation)) {
        throw new Error('SUBSCRIPTION_SESSION_CHANGED');
      }
      const info = await Purchases.restorePurchases();
      if (!isRevenueCatSessionCurrent(userId, session.generation)) {
        throw new Error('SUBSCRIPTION_SESSION_CHANGED');
      }
      processCustomerInfo(info);
      return !!info.entitlements.active[ENTITLEMENT_ID];
    } catch (error) {
      reportError(error, 'Restore error');
      throw error;
    }
  }, [processCustomerInfo, userId]);

  return {
    isPremium,
    loading,
    currentPlan,
    expirationDate,
    isTrialActive,
    packages,
    introEligibility,
    purchasePackage,
    restorePurchases,
  };
};
