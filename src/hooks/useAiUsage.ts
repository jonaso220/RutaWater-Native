import { useEffect, useCallback } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { getAiLimit, getCurrentPeriod } from '../constants/ai';

interface AiUsageDoc {
  count: number;
  period: string; // "YYYY-MM"
  lastUsedAt: any; // FieldValue.serverTimestamp() / Timestamp
}

const docRef = (userId: string) =>
  firestore().collection('aiUsage').doc(userId);

interface Args {
  userId: string | undefined;
  plan: 'free' | 'monthly' | 'annual';
}

/**
 * Sincroniza el contador mensual de parseos de IA con Firestore.
 * El reset se hace de forma "lazy" cuando el período cambia.
 */
export const useAiUsage = ({ userId, plan }: Args) => {
  const limit = getAiLimit(plan);

  // Suscribirse en vivo al doc del user
  useEffect(() => {
    if (!userId) {
      useAiUsageStore.setState({
        count: 0,
        period: getCurrentPeriod(),
        limit,
        loading: false,
        tryConsume: async () => false,
      });
      return;
    }

    useAiUsageStore.setState({ loading: true, limit });

    const unsubscribe = docRef(userId).onSnapshot(
      (snap) => {
        const data = snap.data() as AiUsageDoc | undefined;
        const currentPeriod = getCurrentPeriod();
        const sameP = data?.period === currentPeriod;
        useAiUsageStore.setState({
          count: sameP ? data!.count : 0,
          period: currentPeriod,
          limit,
          loading: false,
        });
      },
      (err) => {
        console.warn('[aiUsage] snapshot error:', err);
        useAiUsageStore.setState({ loading: false });
      },
    );

    return unsubscribe;
  }, [userId, limit]);

  // Consumir 1 parseo en una transacción para evitar bypass en multi-device
  const tryConsume = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const ref = docRef(userId);
    const period = getCurrentPeriod();

    try {
      const allowed = await firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as AiUsageDoc | undefined;
        const samePeriod = data?.period === period;
        const currentCount = samePeriod ? data!.count : 0;

        if (currentCount >= limit) return false;

        tx.set(
          ref,
          {
            count: currentCount + 1,
            period,
            lastUsedAt: firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return true;
      });
      return allowed;
    } catch (err) {
      console.warn('[aiUsage] tryConsume tx error:', err);
      return false;
    }
  }, [userId, limit]);

  // Inyectar tryConsume en el store cuando userId/plan cambia
  useEffect(() => {
    useAiUsageStore.setState({ tryConsume });
  }, [tryConsume]);
};
