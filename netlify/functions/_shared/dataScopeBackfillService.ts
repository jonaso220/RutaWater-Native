import {
  DocumentReference,
  FieldPath,
  FieldValue,
  Firestore,
} from 'firebase-admin/firestore';
import {
  canonicalDataScopeKeyForRecord,
  normalizableBlankGroupScope,
} from '../../../src/utils/dataScope';

export const DATA_SCOPE_COLLECTIONS = ['clients', 'debts', 'transfers'] as const;
export type DataScopeCollection = typeof DATA_SCOPE_COLLECTIONS[number];

const DEFAULT_PAGE_SIZE = 300;
const MAX_PAGE_SIZE = 400;

export interface DataScopeBackfillPage {
  collection: DataScopeCollection;
  scanned: number;
  needsUpdate: number;
  updated: number;
  skippedMalformed: number;
  /** Number of distinct unreachable shared-scope references seen on this page. */
  orphanedScopes: number;
  nextCursor: string | null;
}

interface BackfillPageOptions {
  collection: DataScopeCollection;
  cursor?: string;
  pageSize?: number;
  write?: boolean;
}

const chunked = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const getAllChunked = async (
  db: Firestore,
  refs: DocumentReference[],
) => {
  const snapshots = [];
  for (const refsChunk of chunked(refs, 100)) {
    snapshots.push(...await db.getAll(...refsChunk));
  }
  return snapshots;
};

const activeAccount = (data: Record<string, any>): boolean =>
  data.accountState === undefined
  || data.accountState === null
  || data.accountState === 'active';

/**
 * A shared key is safe to certify only while one unambiguous descriptor still
 * exists and at least one principal can actually authorize that scope.
 *
 * Family-group membership is canonical in users/{uid}.groupId. Profile
 * membership is canonical in profiles/{id}.memberUids, including archived
 * profiles whose retained data remains legitimately readable. No descriptor,
 * two colliding descriptors, or an empty membership blocks the rollout; this
 * audit never reassigns or deletes the affected business documents.
 */
const countOrphanedSharedScopes = async (
  db: Firestore,
  scopeIds: string[],
): Promise<number> => {
  const uniqueScopeIds = [...new Set(scopeIds)];
  if (uniqueScopeIds.length === 0) return 0;

  const [groups, profiles, membershipQueries] = await Promise.all([
    getAllChunked(db, uniqueScopeIds.map((id) => db.collection('groups').doc(id))),
    getAllChunked(db, uniqueScopeIds.map((id) => db.collection('profiles').doc(id))),
    Promise.all(chunked(uniqueScopeIds, 10).map((ids) => db
      .collection('users')
      .where('groupId', 'in', ids)
      .get())),
  ]);

  const groupsById = new Map(groups.filter((doc) => doc.exists).map((doc) => [doc.id, doc]));
  const profilesById = new Map(profiles.filter((doc) => doc.exists).map((doc) => [doc.id, doc]));
  const familyScopesWithMember = new Set<string>();
  membershipQueries.forEach((snapshot) => snapshot.docs.forEach((document) => {
    const data = document.data() || {};
    if (typeof data.groupId === 'string' && data.groupId && activeAccount(data)) {
      familyScopesWithMember.add(data.groupId);
    }
  }));

  return uniqueScopeIds.filter((id) => {
    const group = groupsById.get(id);
    const profile = profilesById.get(id);
    // A family group and a private profile sharing an id is ambiguous, even if
    // both happen to expose a member at this instant.
    if (!!group === !!profile) return true;
    if (group) return !familyScopesWithMember.has(id);
    const memberUids = profile?.data()?.memberUids;
    return !Array.isArray(memberUids)
      || !memberUids.some((uid) => typeof uid === 'string' && uid.length > 0);
  }).length;
};

/**
 * Audits or backfills one stable document-id page using Firebase Admin.
 *
 * The write mode transactionally re-reads every candidate and changes only
 * `scopeKey`, derived from the record's current userId/groupId. This prevents a
 * concurrent group migration from being overwritten with a stale scope and
 * leaves every customer/business field byte-for-byte intact.
 */
export const backfillDataScopePage = async (
  db: Firestore,
  {
    collection,
    cursor,
    pageSize = DEFAULT_PAGE_SIZE,
    write = false,
  }: BackfillPageOptions,
): Promise<DataScopeBackfillPage> => {
  if (!DATA_SCOPE_COLLECTIONS.includes(collection)) {
    throw new Error('DATA_SCOPE_COLLECTION_NOT_ALLOWED');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error('DATA_SCOPE_PAGE_SIZE_INVALID');
  }

  let query = db.collection(collection)
    .orderBy(FieldPath.documentId())
    .limit(pageSize);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  const nextCursor = page.size === pageSize
    ? page.docs[page.docs.length - 1]?.id || null
    : null;

  let needsUpdate = 0;
  let updated = 0;
  let skippedMalformed = 0;
  let orphanedScopes = 0;

  if (!write) {
    page.docs.forEach((document) => {
      const data = document.data();
      if (normalizableBlankGroupScope(data)) {
        needsUpdate += 1;
        return;
      }
      const canonical = canonicalDataScopeKeyForRecord(data);
      if (!canonical) {
        skippedMalformed += 1;
      } else if (data.scopeKey !== canonical) {
        needsUpdate += 1;
      }
    });
    orphanedScopes = await countOrphanedSharedScopes(
      db,
      page.docs
        .map((document) => document.data().groupId)
        .filter((groupId): groupId is string =>
          typeof groupId === 'string' && groupId.trim().length > 0),
    );
  } else if (!page.empty) {
    const result = await db.runTransaction(async (transaction) => {
      const latest = await transaction.getAll(...page.docs.map((document) => document.ref));
      let transactionNeedsUpdate = 0;
      let transactionUpdated = 0;
      let transactionSkipped = 0;

      latest.forEach((document) => {
        if (!document.exists) return;
        const data = document.data() || {};
        const blankGroupRepair = normalizableBlankGroupScope(data);
        if (blankGroupRepair) {
          transactionNeedsUpdate += 1;
          transaction.update(document.ref, {
            groupId: FieldValue.delete(),
            scopeKey: blankGroupRepair.scopeKey,
          });
          transactionUpdated += 1;
          return;
        }
        const canonical = canonicalDataScopeKeyForRecord(data);
        if (!canonical) {
          transactionSkipped += 1;
          return;
        }
        if (data.scopeKey === canonical) return;
        transactionNeedsUpdate += 1;
        transaction.update(document.ref, { scopeKey: canonical });
        transactionUpdated += 1;
      });
      return {
        needsUpdate: transactionNeedsUpdate,
        updated: transactionUpdated,
        skippedMalformed: transactionSkipped,
      };
    });
    needsUpdate = result.needsUpdate;
    updated = result.updated;
    skippedMalformed = result.skippedMalformed;
  }

  return {
    collection,
    scanned: page.size,
    needsUpdate,
    updated,
    skippedMalformed,
    orphanedScopes,
    nextCursor,
  };
};

/** Test/operator helper. Production callers should checkpoint every page. */
export const backfillEntireDataScopeCollection = async (
  db: Firestore,
  collection: DataScopeCollection,
  write = false,
): Promise<Omit<DataScopeBackfillPage, 'nextCursor'>> => {
  let cursor: string | undefined;
  const total = {
    collection,
    scanned: 0,
    needsUpdate: 0,
    updated: 0,
    skippedMalformed: 0,
    orphanedScopes: 0,
  };
  do {
    const page = await backfillDataScopePage(db, {
      collection,
      cursor,
      write,
    });
    total.scanned += page.scanned;
    total.needsUpdate += page.needsUpdate;
    total.updated += page.updated;
    total.skippedMalformed += page.skippedMalformed;
    total.orphanedScopes += page.orphanedScopes;
    cursor = page.nextCursor || undefined;
  } while (cursor);
  return total;
};
