import React, { createContext, useContext, useMemo } from 'react';
import { useSubscription, SubscriptionState } from '../hooks/useSubscription';
import { usePromoCode } from '../hooks/usePromoCode';
import { useAuthContext } from './AuthContext';

export interface FullSubscriptionState extends SubscriptionState {
  hasPromo: boolean;
  promoLoading: boolean;
  redeemCode: (code: string) => Promise<{ success: boolean; message: string }>;
  removePromo: () => Promise<void>;
}

const SubscriptionContext = createContext<FullSubscriptionState | null>(null);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuthContext();
  const subscription = useSubscription({ userId: user?.uid });
  const promo = usePromoCode({ userId: user?.uid });

  const value = useMemo<FullSubscriptionState>(() => ({
    ...subscription,
    // Premium if RevenueCat says so OR has an active promo code
    isPremium: subscription.isPremium || promo.hasPromo,
    loading: subscription.loading || promo.promoLoading,
    hasPromo: promo.hasPromo,
    promoLoading: promo.promoLoading,
    redeemCode: promo.redeemCode,
    removePromo: promo.removePromo,
  }), [subscription, promo]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscriptionContext = (): FullSubscriptionState => {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscriptionContext must be used within SubscriptionProvider');
  return ctx;
};
