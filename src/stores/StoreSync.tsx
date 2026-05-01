import React, { useEffect, useMemo, useRef } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useClients } from '../hooks/useClients';
import { useDebts } from '../hooks/useDebts';
import { useTransfers } from '../hooks/useTransfers';
import { useDailyLoads } from '../hooks/useDailyLoads';
import { useSubscription } from '../hooks/useSubscription';
import { usePromoCode } from '../hooks/usePromoCode';
import { useAiUsage } from '../hooks/useAiUsage';
import { ALL_DAYS } from '../constants/products';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { db } from '../config/firebase';
import { useClientsStore } from './clientsStore';
import { useDebtsStore } from './debtsStore';
import { useTransfersStore } from './transfersStore';
import { useDailyLoadsStore } from './dailyLoadsStore';
import { useSubscriptionStore } from './subscriptionStore';

/**
 * StoreSync bridges the existing React hooks (which manage Firebase listeners)
 * with Zustand stores. This gives us selective subscriptions without rewriting
 * the proven hook logic.
 */
export const StoreSync: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, groupData } = useAuthContext();
  const userId = user?.uid || '';
  const groupId = groupData?.groupId;

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
  const clientsHook = useClients({ userId, groupId });

  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ALL_DAYS.forEach((day) => {
      counts[day] = clientsHook.getVisibleClients(day).length;
    });
    return counts;
  }, [clientsHook.clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const clientCount = useMemo(
    () => clientsHook.clients.filter((c) => c.name && !c.isNote).length,
    [clientsHook.clients],
  );
  const canAddClient = isPremium || clientCount < FREE_CLIENT_LIMIT;

  // Auto-cleanup: expired completed 'once' clients + stale notes
  const cleanupDoneRef = useRef(false);
  useEffect(() => {
    if (cleanupDoneRef.current) return;
    if (clientsHook.clients.length === 0) return;
    cleanupDoneRef.current = true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Delete notes that are completed or have a past date (keep today's active notes)
    const staleNotes = clientsHook.clients.filter((c) => {
      if (!c.isNote) return false;
      if (c.isCompleted) return true;
      if (c.specificDate && new Date(c.specificDate + 'T23:59:59') < today) return true;
      return false;
    });
    if (staleNotes.length > 0) {
      const noteBatch = db.batch();
      staleNotes.forEach((c) => noteBatch.delete(db.collection('clients').doc(c.id)));
      noteBatch.commit().catch((err) => console.error('Note cleanup error:', err));
    }

    const expiredCompleted = clientsHook.clients.filter((c) =>
      c.isCompleted &&
      c.freq === 'once' &&
      c.specificDate &&
      new Date(c.specificDate + 'T12:00:00') < today,
    );

    if (expiredCompleted.length === 0) return;

    const batchSize = 450;
    for (let i = 0; i < expiredCompleted.length; i += batchSize) {
      const chunk = expiredCompleted.slice(i, i + batchSize);
      const batch = db.batch();
      chunk.forEach((c) => {
        const ref = db.collection('clients').doc(c.id);
        if (c.isNote) {
          batch.delete(ref);
        } else {
          batch.update(ref, {
            freq: 'on_demand',
            visitDay: 'Sin Asignar',
            visitDays: [],
            isCompleted: false,
            completedAt: null,
            updatedAt: new Date(),
          });
        }
      });
      batch.commit().catch((err) => console.error('Auto-cleanup error:', err));
    }
  }, [clientsHook.clients]);

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
  const debtsHook = useDebts({ userId, groupId, clients: clientsHook.clients });

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
  const transfersHook = useTransfers({ userId, groupId, clients: clientsHook.clients });

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

  // Reset all stores on unmount (sign out) to prevent stale references
  useEffect(() => {
    return () => {
      useClientsStore.setState(useClientsStore.getInitialState());
      useDebtsStore.setState(useDebtsStore.getInitialState());
      useTransfersStore.setState(useTransfersStore.getInitialState());
      useDailyLoadsStore.setState(useDailyLoadsStore.getInitialState());
      useSubscriptionStore.setState(useSubscriptionStore.getInitialState());
    };
  }, []);

  return <>{children}</>;
};
