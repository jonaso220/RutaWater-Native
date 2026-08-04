import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import { isPromoCodeUsable, PromoCodeDocument } from './promoCode';

export type PromoRedeemStatus = 'redeemed' | 'already_active' | 'invalid';

interface RedeemPromoInput {
  db: Firestore;
  uid: string;
  promoDigest: string;
  nowMillis?: number;
}

export const redeemPromo = async ({
  db,
  uid,
  promoDigest,
  nowMillis = Date.now(),
}: RedeemPromoInput): Promise<PromoRedeemStatus> => {
  if (!uid) throw new Error('UID autenticado requerido.');
  if (!/^[a-f0-9]{64}$/.test(promoDigest)) throw new Error('Digest promocional inválido.');

  const premiumRef = db.collection('premiumOverrides').doc(uid);
  const promoRef = db.collection('promoCodes').doc(promoDigest);
  const redemptionRef = promoRef.collection('redemptions').doc(uid);
  const userRef = db.collection('users').doc(uid);
  const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);

  return db.runTransaction(async (transaction) => {
    // Admin SDK omite las reglas. Este guard transaccional evita que un token
    // aún vigente reactive Premium mientras la cuenta se está eliminando o
    // después de que quedó el tombstone permanente.
    const [userSnapshot, deletionJob] = await Promise.all([
      transaction.get(userRef),
      transaction.get(deletionJobRef),
    ]);
    if (
      deletionJob.exists
      || (userSnapshot.exists && userSnapshot.data()?.accountState !== undefined
        && userSnapshot.data()?.accountState !== 'active')
    ) {
      return 'invalid';
    }

    // Invariante de compatibilidad: un Premium histórico activo no se reescribe
    // ni consume cupo. Su documento queda byte-a-byte igual.
    const existingPremium = await transaction.get(premiumRef);
    if (existingPremium.exists && existingPremium.data()?.active === true) {
      return 'already_active';
    }

    const promoSnapshot = await transaction.get(promoRef);
    if (!promoSnapshot.exists) return 'invalid';

    const promo = promoSnapshot.data() as PromoCodeDocument;
    if (!isPromoCodeUsable(promo, uid, nowMillis)) return 'invalid';

    const redemptionSnapshot = await transaction.get(redemptionRef);
    const alreadyRedeemedByUser = redemptionSnapshot.exists;
    const usedCount = Number.isInteger(promo.usedCount) ? Number(promo.usedCount) : 0;
    const maxUses = Number(promo.maxUses);

    if (!alreadyRedeemedByUser && usedCount >= maxUses) return 'invalid';

    const serverNow = Timestamp.fromMillis(nowMillis);
    if (!alreadyRedeemedByUser) {
      transaction.set(redemptionRef, {
        uid,
        redeemedAt: serverNow,
      });
      transaction.update(promoRef, {
        usedCount: FieldValue.increment(1),
        updatedAt: serverNow,
      });
    }

    // Nunca se persiste el código en claro. merge conserva metadatos legacy
    // únicamente si el usuario había desactivado previamente su beneficio.
    transaction.set(
      premiumRef,
      {
        active: true,
        type: 'lifetime',
        userId: uid,
        promoId: promoDigest,
        source: 'server_promo',
        redeemedAt: serverNow,
      },
      { merge: true },
    );

    return 'redeemed';
  });
};
