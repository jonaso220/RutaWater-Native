import crypto from 'crypto';

export const MIN_PROMO_CODE_LENGTH = 8;
export const MAX_PROMO_CODE_LENGTH = 64;
export const MIN_PEPPER_LENGTH = 32;

export interface PromoCodeDocument {
  active?: boolean;
  type?: string;
  maxUses?: number;
  usedCount?: number;
  expiresAt?: unknown;
  assignedUid?: string;
}

export const normalizePromoCode = (value: string): string =>
  value.normalize('NFKC').trim().toUpperCase();

export const isPromoCodeShapeValid = (value: string): boolean => {
  const normalized = normalizePromoCode(value);
  return normalized.length >= MIN_PROMO_CODE_LENGTH
    && normalized.length <= MAX_PROMO_CODE_LENGTH
    && /^[A-Z0-9-]+$/.test(normalized);
};

export const createPromoCodeDigest = (code: string, pepper: string): string => {
  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error('PROMO_CODE_PEPPER debe tener al menos 32 caracteres.');
  }
  return crypto
    .createHmac('sha256', pepper)
    .update(normalizePromoCode(code), 'utf8')
    .digest('hex');
};

const timestampMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === 'function') {
      const millis = toMillis.call(value);
      return typeof millis === 'number' ? millis : null;
    }
  }
  return null;
};

export const isPromoCodeUsable = (
  promo: PromoCodeDocument,
  uid: string,
  nowMillis: number,
): boolean => {
  if (promo.active !== true || promo.type !== 'lifetime') return false;
  if (!Number.isInteger(promo.maxUses) || Number(promo.maxUses) < 1) return false;
  if (promo.assignedUid && promo.assignedUid !== uid) return false;

  const expiration = timestampMillis(promo.expiresAt);
  if (promo.expiresAt && expiration === null) return false;
  if (expiration !== null && expiration <= nowMillis) return false;
  return true;
};
