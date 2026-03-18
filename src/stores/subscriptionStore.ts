import { create } from 'zustand';
import { SubscriptionState } from '../hooks/useSubscription';

export interface FullSubscriptionState extends SubscriptionState {
  hasPromo: boolean;
  promoLoading: boolean;
  redeemCode: (code: string) => Promise<{ success: boolean; message: string }>;
  removePromo: () => Promise<void>;
}

const noop = async () => ({} as any);

export const useSubscriptionStore = create<FullSubscriptionState>()(() => ({
  isPremium: false,
  loading: true,
  packages: [],
  currentPlan: 'free',
  expirationDate: null,
  isTrialActive: false,
  purchasePackage: noop,
  restorePurchases: async () => false,
  hasPromo: false,
  promoLoading: true,
  redeemCode: async () => ({ success: false, message: '' }),
  removePromo: async () => {},
}));
