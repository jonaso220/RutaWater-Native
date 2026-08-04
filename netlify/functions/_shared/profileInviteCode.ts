import { randomBytes } from 'node:crypto';

export const PROFILE_INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROFILE_INVITE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
export const PROFILE_CODE_RESERVATION_VERSION = 'profile_codes_v1';

export const normalizeInviteCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return PROFILE_INVITE_CODE_PATTERN.test(normalized) ? normalized : null;
};

export const generateProfileInviteCode = (): string => {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) code += PROFILE_INVITE_ALPHABET[byte & 31];
  return code;
};

export const generateProfileId = (): string => `profile_${randomBytes(16).toString('hex')}`;
