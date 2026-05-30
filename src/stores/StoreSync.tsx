import React, { useEffect, useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useClients } from '../hooks/useClients';
import { useDebts } from '../hooks/useDebts';
import { useTransfers } from '../hooks/useTransfers';
import { useDailyLoads } from '../hooks/useDailyLoads';
import { useSubscription } from '../hooks/useSubscription';
import { usePromoCode } from '../hooks/usePromoCode';
import { useAiUsage } from '../hooks/useAiUsage';
import { useClientsAutoCleanup } from '../hooks/useClientsAutoCleanup';
import { useProductCatalog } from '../hooks/useProductCatalog';
import { useProfiles } from '../hooks/useProfiles';
import { ALL_DAYS } from '../constants/products';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { useClientsStore } from './clientsStore';
import { useDebtsStore } from './debtsStore';
import { useTransfersStore } from './transfersStore';
import { useDailyLoadsStore } from './dailyLoadsStore';
import { useSubscriptionStore } from './subscriptionStore';
import { useProductCatalogStore } from './productCatalogStore';
import { useProfileStore } from './profileStore';
import { queryClient } from '../lib/queryClient';

/**
 * StoreSync bridges the existing React hooks (which manage Firebase listeners)
 * with Zustand stores. This gives us selective subscriptions without rewriting
 * the proven hook logic.
 */
export const StoreSync: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, groupData } = useAuthContext();
  const userId = user?.uid || '';
  const groupId = groupData?.groupId;

  // --- Profiles / Repartos ---
  // The active profile decides the scope value used for clients/debts/transfers.
  // Reparto 1 (primary) resolves to the user's real group (or userId) → no change.
  // A custom profile resolves to its own id, isolating its data.
  const profilesHook = useProfiles(userId, groupId, user?.displayName, user?.email);
  const effectiveGroupId = profilesHook.activeProfile.scopeGroupId;

  // --- Subscription ---
  const subscription = useSubscription({ userId: user?.uid });
  const promo = usePromoCode({ userId: user?.uid });

  const isPremium = subscription.isPremium || promo.hasPromo;
  const subLoading = subscription.loading || promo.promoLoading;

  // --- AI usage (parseo de pedidos con Claude) ---
  // Promo cuenta como plan anual (más generoso). Resto: lo que diga RevenueCat.
  const aiPlan: 'free' | 'monthly' | 'annual' = promo.hasPromo
    ? 'annual'
    : (subscription.currentPlan as 'free' | 'monthly' | 'annual');
  useAiUsage({ userId: user?.uid, plan: aiPlan });

  useEffect(() => {
    useSubscriptionStore.setState({
      ...subscription,
      isPremium,
      loading: subLoading,
      hasPromo: promo.hasPromo,
      promoLoading: promo.promoLoading,
      redeemCode: promo.redeemCode,
      removePromo: promo.removePromo,
    });
  }, [subscription.isPremium, subscription.loading, subscription.packages, subscription.currentPlan, subscription.expirationDate, subscription.isTrialActive, promo.hasPromo, promo.promoLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Clients ---
  const clientsHook = useClients({ userId, groupId: effectiveGroupId });

  const dayCounts = useMemo(() => {
    // Single pass over clients (one bucket-increment per assigned day) instead
    // of 7 × getVisibleClients(day) — each of which filtered AND sorted the
    // whole 600+ client array just to read .length. Matches getAllDayClients'
    // filter: skip on_demand/completed; count each day in visitDays ∪ visitDay.
    const counts: Record<string, number> = {};
    ALL_DAYS.forEach((day) => { counts[day] = 0; });
    clientsHook.clients.forEach((c) => {
      if (c.freq === 'on_demand' || c.isCompleted) return;
      const days = new Set<string>();
      if (Array.isArray(c.visitDays)) c.visitDays.forEach((d) => days.add(d));
      if (c.visitDay) days.add(c.visitDay);
      days.forEach((d) => { if (counts[d] !== undefined) counts[d] += 1; });
    });
    return counts;
  }, [clientsHook.clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const clientCount = useMemo(
    () => clientsHook.clients.filter((c) => c.name && !c.isNote).length,
    [clientsHook.clients],
  );
  const canAddClient = isPremium || clientCount < FREE_CLIENT_LIMIT;

  useClientsAutoCleanup(clientsHook.clients);

  useEffect(() => {
    useClientsStore.setState({
      ...clientsHook,
      dayCounts,
      canAddClient,
      clientCount,
    });
  }, [clientsHook.clients, clientsHook.loading, dayCounts, canAddClient, clientCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Debts ---
  // Pasamos clients para que getClientDebtTotal agrupe duplicados (mismo cliente del directorio añadido varias veces)
  const debtsHook = useDebts({ userId, groupId: effectiveGroupId, clients: clientsHook.clients });

  useEffect(() => {
    useDebtsStore.setState({
      debts: debtsHook.debts,
      getClientDebts: debtsHook.getClientDebts,
      getClientDebtTotal: debtsHook.getClientDebtTotal,
      addDebt: debtsHook.addDebt,
      markDebtPaid: debtsHook.markDebtPaid,
      editDebt: debtsHook.editDebt,
      markAllDebtsPaid: debtsHook.markAllDebtsPaid,
    });
  }, [debtsHook.debts, debtsHook.getClientDebts, debtsHook.getClientDebtTotal, debtsHook.addDebt, debtsHook.markDebtPaid, debtsHook.editDebt, debtsHook.markAllDebtsPaid]);

  // --- Transfers ---
  // Pasamos clients para agrupar transferencias de instancias duplicadas del mismo cliente humano
  const transfersHook = useTransfers({ userId, groupId: effectiveGroupId, clients: clientsHook.clients });

  useEffect(() => {
    useTransfersStore.setState({
      transfers: transfersHook.transfers,
      getClientTransfers: transfersHook.getClientTransfers,
      hasPendingTransfer: transfersHook.hasPendingTransfer,
      addTransfer: transfersHook.addTransfer,
      markTransferReviewed: transfersHook.markTransferReviewed,
    });
  }, [transfersHook.transfers, transfersHook.getClientTransfers, transfersHook.hasPendingTransfer, transfersHook.addTransfer, transfersHook.markTransferReviewed]);

  // --- Daily Loads ---
  const dailyLoadsHook = useDailyLoads({ userId });

  useEffect(() => {
    useDailyLoadsStore.setState({
      dailyLoad: dailyLoadsHook.dailyLoad,
      loadForDay: dailyLoadsHook.loadForDay,
      saveDailyLoad: dailyLoadsHook.saveDailyLoad,
    });
  }, [dailyLoadsHook.dailyLoad, dailyLoadsHook.loadForDay, dailyLoadsHook.saveDailyLoad]);

  // --- Product catalog (editable: rename / hide / add) ---
  const catalog = useProductCatalog(userId, groupId);

  useEffect(() => {
    useProductCatalogStore.setState({
      products: catalog.products,
      allProducts: catalog.allProducts,
      customProducts: catalog.customProducts,
      hidden: catalog.hidden,
      productNames: catalog.productNames,
      loaded: catalog.loaded,
      renameProduct: catalog.renameProduct,
      setProductEmoji: catalog.setProductEmoji,
      setProductHidden: catalog.setProductHidden,
      addProduct: catalog.addProduct,
      removeCustomProduct: catalog.removeCustomProduct,
      moveProduct: catalog.moveProduct,
    });
  }, [catalog.products, catalog.allProducts, catalog.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Profiles store bridge ---
  useEffect(() => {
    useProfileStore.setState({
      profiles: profilesHook.profiles,
      activeProfileId: profilesHook.activeProfileId,
      activeProfile: profilesHook.activeProfile,
      loaded: profilesHook.loaded,
      setActiveProfile: profilesHook.setActiveProfile,
      createProfile: profilesHook.createProfile,
      renameProfile: profilesHook.renameProfile,
      deleteProfile: profilesHook.deleteProfile,
      joinProfile: profilesHook.joinProfile,
      leaveProfile: profilesHook.leaveProfile,
      removeMember: profilesHook.removeMember,
    });
  }, [profilesHook.profiles, profilesHook.activeProfileId, profilesHook.activeProfile, profilesHook.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all stores on unmount (sign out) to prevent stale references.
  // Also clear the TanStack Query cache so a different user signing in
  // during the same app session can't see the previous user's clients,
  // debts, or transfers leftover under the prior scope key.
  useEffect(() => {
    return () => {
      useClientsStore.setState(useClientsStore.getInitialState());
      useDebtsStore.setState(useDebtsStore.getInitialState());
      useTransfersStore.setState(useTransfersStore.getInitialState());
      useDailyLoadsStore.setState(useDailyLoadsStore.getInitialState());
      useSubscriptionStore.setState(useSubscriptionStore.getInitialState());
      useProductCatalogStore.setState(useProductCatalogStore.getInitialState());
      useProfileStore.setState(useProfileStore.getInitialState());
      queryClient.clear();
    };
  }, []);

  return <>{children}</>;
};
