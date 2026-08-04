import { useEffect } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { getAiLimit, getCurrentPeriod } from '../constants/ai';

interface AiUsageDoc {
  count: number;
  period: string; // "YYYY-MM"
  limit?: number;
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
 * El backend es el único que consume cupo y hace el reset mensual. Este hook
 * queda deliberadamente en modo lectura para que un cliente modificado no
 * pueda autorizarse a sí mismo ni competir con otros dispositivos.
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
      });
      return;
    }

    useAiUsageStore.setState({ loading: true, limit });

    const unsubscribe = docRef(userId).onSnapshot(
      (snap) => {
        const data = snap.data() as AiUsageDoc | undefined;
        const hasServerUsage = !!data
          && typeof data.period === 'string'
          && /^\d{4}-\d{2}$/.test(data.period)
          && Number.isSafeInteger(data.count)
          && data.count >= 0;
        const serverLimit = hasServerUsage
          && Number.isSafeInteger(data.limit)
          && data.limit! > 0
          ? data.limit!
          : limit;
        useAiUsageStore.setState({
          count: hasServerUsage ? data.count : 0,
          period: hasServerUsage ? data.period : getCurrentPeriod(),
          limit: serverLimit,
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
};
