import { useState, useEffect, useCallback } from 'react';
import { reportError } from '../lib/crashReporting';
import i18n from '../i18n';
import { API_ENDPOINTS } from '../config/api';
import { db, fbAuth } from '../config/firebase';

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
        return { success: false, message: i18n.t('settings.promoAuthRequired') };
      }

      try {
        const idToken = await fbAuth.currentUser?.getIdToken();
        if (!idToken) {
          return { success: false, message: i18n.t('settings.promoAuthRequired') };
        }

        const response = await fetch(API_ENDPOINTS.redeemPromo, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: code.trim() }),
        });

        const body = await response.json().catch(() => ({} as any));
        if (!response.ok) {
          throw new Error(body?.error || `HTTP ${response.status}`);
        }

        if (body?.success === true) {
          return {
            success: true,
            message: body.status === 'already_active'
              ? i18n.t('settings.promoAlreadyActive')
              : i18n.t('settings.promoSuccess'),
          };
        }

        return { success: false, message: i18n.t('settings.promoInvalidCode') };
      } catch (error) {
        reportError(error, 'Promo redeem error');
        return { success: false, message: i18n.t('settings.promoRedeemError') };
      }
    },
    [userId],
  );

  const removePromo = useCallback(async () => {
    if (!userId) return;
    try {
      // Las reglas permiten exclusivamente true -> false en el documento propio.
      // Así las versiones ya publicadas pueden quitar Premium, pero ninguna
      // versión del cliente puede concedérselo o reactivarlo.
      await db.collection('premiumOverrides').doc(userId).update({ active: false });
    } catch (error) {
      reportError(error, 'Remove promo error');
      throw error;
    }
  }, [userId]);

  return { hasPromo, promoLoading, redeemCode, removePromo };
};
