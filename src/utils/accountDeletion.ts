export const RECENT_AUTH_MAX_AGE_MS = 4 * 60 * 1000;

/**
 * Selects a stable successor so a retry always promotes the same member.
 * The current owner is excluded even if it appears more than once.
 */
export const selectDeterministicSuccessor = (
  memberUids: string[],
  currentOwnerUid: string,
): string | null => {
  const candidates = [...new Set(memberUids)]
    .filter((uid) => uid && uid !== currentOwnerUid)
    .sort((a, b) => a.localeCompare(b));
  return candidates[0] || null;
};

export const isRecentAuthentication = (
  authTime: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = RECENT_AUTH_MAX_AGE_MS,
): boolean => {
  const authTimeMs = Date.parse(authTime);
  if (!Number.isFinite(authTimeMs)) return false;
  const age = nowMs - authTimeMs;
  return age >= 0 && age <= maxAgeMs;
};
