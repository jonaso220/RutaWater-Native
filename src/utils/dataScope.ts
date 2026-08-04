/**
 * Queryable, canonical identity for the business-data scope of a document.
 *
 * `userId` remains immutable attribution (who created the record). It must not
 * be used as an authorization scope once that creator leaves a shared route.
 * `scopeKey` is deliberately prefixed so an Auth UID can never collide with a
 * group/profile document id.
 */
export const DATA_SCOPE_READ_VERSION = 1;

export const personalDataScopeKey = (userId: string): string => `user:${userId}`;

export const sharedDataScopeKey = (groupId: string): string => `scope:${groupId}`;

export const dataScopeKey = (userId: string, groupId?: string | null): string =>
  groupId ? sharedDataScopeKey(groupId) : personalDataScopeKey(userId);

export const dataScopeFields = (
  userId: string,
  groupId?: string | null,
): { userId: string; groupId?: string; scopeKey: string } => ({
  userId,
  ...(groupId ? { groupId } : {}),
  scopeKey: dataScopeKey(userId, groupId),
});

interface DataScopeRecord {
  userId?: unknown;
  groupId?: unknown;
  scopeKey?: unknown;
}

/** Returns null for malformed legacy records that require manual review. */
export const canonicalDataScopeKeyForRecord = (
  record: DataScopeRecord,
): string | null => {
  if (
    typeof record.userId !== 'string'
    || !record.userId
    || record.userId.trim() !== record.userId
  ) return null;
  // An explicitly persisted blank groupId is not the same shape as a personal
  // record in Firestore rules (`groupId == null`). The Admin backfill may
  // normalize this unambiguous legacy shape by deleting the blank field, but a
  // dry audit must never certify it as already canonical.
  if (typeof record.groupId === 'string' && !record.groupId.trim()) return null;
  if (
    record.groupId !== undefined
    && record.groupId !== null
    && typeof record.groupId !== 'string'
  ) return null;
  const groupId = typeof record.groupId === 'string' && record.groupId
    ? record.groupId
    : undefined;
  return dataScopeKey(record.userId, groupId);
};

export const normalizableBlankGroupScope = (
  record: DataScopeRecord,
): { scopeKey: string } | null => (
  typeof record.userId === 'string'
  && record.userId.length > 0
  && record.userId.trim() === record.userId
  && typeof record.groupId === 'string'
  && record.groupId.trim().length === 0
    ? { scopeKey: personalDataScopeKey(record.userId) }
    : null
);

export const hasCanonicalDataScopeKey = (record: DataScopeRecord): boolean => {
  const canonical = canonicalDataScopeKeyForRecord(record);
  return canonical !== null && record.scopeKey === canonical;
};

export const dataScopeQuery = (
  userId: string,
  groupId: string | undefined,
  scopeReadVersion: number,
): {
  field: 'scopeKey' | 'groupId' | 'userId';
  value: string;
  additionalFilter?: { field: 'groupId'; value: string };
} => {
  if (scopeReadVersion >= DATA_SCOPE_READ_VERSION) {
    return {
      field: 'scopeKey',
      value: dataScopeKey(userId, groupId),
      // Firestore rules must be able to prove the canonical membership path
      // from query constraints. Shared reads therefore constrain both fields;
      // personal reads need only the collision-proof user-prefixed scopeKey.
      ...(groupId ? { additionalFilter: { field: 'groupId' as const, value: groupId } } : {}),
    };
  }
  return groupId
    ? { field: 'groupId', value: groupId }
    : { field: 'userId', value: userId };
};

/**
 * Version belongs in the cache key so enabling strict reads cannot render a
 * version-0 snapshot while the first canonical snapshot is still pending.
 */
export const dataScopeCacheKey = (
  collection: 'clients' | 'debts' | 'transfers',
  logicalScopeKey: string,
  scopeReadVersion: number,
) => [collection, logicalScopeKey, `scope-v${scopeReadVersion}`] as const;
