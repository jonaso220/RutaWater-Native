import { useState, useEffect, useCallback, useRef } from 'react';
import Purchases, {
  CustomerInfo,
  PurchasesPackage,
  LOG_LEVEL,
} from 'react-native-purchases';
import { REVENUECAT_API_KEY, ENTITLEMENT_ID } from '../constants/subscription';

export interface SubscriptionState {
  isPremium: boolean;
  loading: boolean;
  currentPlan: 'free' | 'monthly' | 'annual';
  expirationDate: string | null;
  isTrialActive: boolean;
  packages: PurchasesPackage[];
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
  const configuredRef = useRef(false);

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
    const init = async () => {
      if (!REVENUECAT_API_KEY || !userId) {
        setLoading(false);
        return;
      }

      try {
        if (!configuredRef.current) {
          Purchases.setLogLevel(LOG_LEVEL.DEBUG);
          Purchases.configure({ apiKey: REVENUECAT_API_KEY });
          configuredRef.current = true;
        }

        // Identify user with Firebase UID
        const { customerInfo } = await Purchases.logIn(userId);
        processCustomerInfo(customerInfo);

        // Load available packages
        const offerings = await Purchases.getOfferings();
        if (offerings.current?.availablePackages) {
          setPackages(offerings.current.availablePackages);
        }
      } catch (error) {
        console.warn('RevenueCat init error (non-fatal):', error);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [userId, processCustomerInfo]);

  // Listen for subscription changes
  useEffect(() => {
    if (!configuredRef.current) return;

    const listener = Purchases.addCustomerInfoUpdateListener((info) => {
      processCustomerInfo(info);
    });

    return () => {
      (listener as any)?.remove?.();
    };
  }, [processCustomerInfo]);

  // Log out from RevenueCat when user logs out
  useEffect(() => {
    if (!userId && configuredRef.current) {
      Purchases.logOut().catch(() => {});
    }
  }, [userId]);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      processCustomerInfo(customerInfo);
      return !!customerInfo.entitlements.active[ENTITLEMENT_ID];
    } catch (error: any) {
      if (error.userCancelled) return false;
      console.error('Purchase error:', error);
      throw error;
    }
  }, [processCustomerInfo]);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const info = await Purchases.restorePurchases();
      processCustomerInfo(info);
      return !!info.entitlements.active[ENTITLEMENT_ID];
    } catch (error) {
      console.error('Restore error:', error);
      throw error;
    }
  }, [processCustomerInfo]);

  return {
    isPremium,
    loading,
    currentPlan,
    expirationDate,
    isTrialActive,
    packages,
    purchasePackage,
    restorePurchases,
  };
};
