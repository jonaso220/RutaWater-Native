import { useState, useEffect, useCallback } from 'react';
import { db } from '../config/firebase';
import { PROMO_CODES } from '../constants/subscription';

interface PromoState {
  hasPromo: boolean;
  promoLoading: boolean;
  redeemCode: (code: string) => Promise<{ success: boolean; message: string }>;
  removePromo: () => Promise<void>;
}

export const usePromoCode = ({ userId }: { userId: string | undefined }): PromoState => {
  const [hasPromo, setHasPromo] = useState(false);
  const [promoLoading, setPromoLoading] = useState(true);

  // Check if user has a redeemed promo code
  useEffect(() => {
    if (!userId) {
      setHasPromo(false);
      setPromoLoading(false);
      return;
    }

    const unsubscribe = db
      .collection('premiumOverrides')
      .doc(userId)
      .onSnapshot(
        (doc) => {
          if (doc.exists) {
            const data = doc.data();
            setHasPromo(data?.active === true);
          } else {
            setHasPromo(false);
          }
          setPromoLoading(false);
        },
        () => {
          setHasPromo(false);
          setPromoLoading(false);
        },
      );

    return () => unsubscribe();
  }, [userId]);

  const redeemCode = useCallback(
    async (code: string): Promise<{ success: boolean; message: string }> => {
      if (!userId) {
        return { success: false, message: 'Debes iniciar sesion primero.' };
      }

      const normalizedCode = code.trim().toUpperCase();

      if (!PROMO_CODES[normalizedCode]) {
        return { success: false, message: 'Codigo invalido.' };
      }

      try {
        // Check if code was already used by this user
        const existing = await db.collection('premiumOverrides').doc(userId).get();
        if (existing.exists && existing.data()?.active) {
          return { success: false, message: 'Ya tienes premium activado.' };
        }

        await db.collection('premiumOverrides').doc(userId).set({
          active: true,
          code: normalizedCode,
          type: PROMO_CODES[normalizedCode],
          redeemedAt: new Date(),
          userId,
        });

        return { success: true, message: 'Premium activado!' };
      } catch (error) {
        console.error('Promo redeem error:', error);
        return { success: false, message: 'Error al activar el codigo.' };
      }
    },
    [userId],
  );

  const removePromo = useCallback(async () => {
    if (!userId) return;
    try {
      await db.collection('premiumOverrides').doc(userId).update({ active: false });
    } catch (error) {
      console.error('Remove promo error:', error);
    }
  }, [userId]);

  return { hasPromo, promoLoading, redeemCode, removePromo };
};
