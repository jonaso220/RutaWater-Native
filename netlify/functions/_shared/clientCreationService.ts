import {
  FieldValue,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

export const FREE_CLIENT_LIMIT = 60;
export const MAX_CLIENT_CREATE_BATCH = 100;

const VALID_FREQUENCIES = new Set([
  'weekly',
  'biweekly',
  'triweekly',
  'monthly',
  'once',
  'on_demand',
]);
const DATE_FIELDS = new Set([
  'lastVisited',
  'lastDeliveredAt',
  'previousDeliveredAt',
  'completedAt',
]);
const ALLOWED_FIELDS = new Set([
  'customerId',
  'name',
  'phone',
  'address',
  'addresses',
  'notes',
  'lat',
  'lng',
  'mapsLink',
  'freq',
  'visitDay',
  'visitDays',
  'specificDate',
  'products',
  'listOrder',
  'listOrders',
  'isCompleted',
  'isStarred',
  'isPinned',
  'isNote',
  'alarm',
  'alarmDay',
  'alarmScheduledFor',
  'lastVisited',
  'lastDeliveredAt',
  'previousDeliveredAt',
  'doneFor',
  'completedAt',
  'relationships',
  'sameHousehold',
  'backupSourceId',
  'isInactive',
]);

export type ClientCreationPlan = 'free' | 'monthly' | 'annual';

export class ClientCreationError extends Error {
  constructor(
    public readonly code:
      | 'ACCOUNT_WRITE_BLOCKED'
      | 'CLIENT_CREATE_INPUT_INVALID'
      | 'CLIENT_CREATE_SCOPE_DENIED'
      | 'CLIENT_LIMIT_REACHED'
      | 'PREMIUM_REQUIRED',
  ) {
    super(code);
    this.name = 'ClientCreationError';
  }
}

export interface ClientCreateItem {
  id: string;
  data: Record<string, unknown>;
}

export interface ClientCreateResult {
  ids: string[];
  created: number;
  limit: number | null;
  count: number | null;
}

interface CreateClientDocumentsInput {
  db: Firestore;
  uid: string;
  plan: ClientCreationPlan;
  items: ClientCreateItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const validDocumentId = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 500
  && value !== '.'
  && value !== '..'
  && !value.includes('/');

const cloneBoundedValue = (value: unknown, depth = 0): unknown => {
  if (depth > 5) throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 5_000) throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
    return value.map((entry) => cloneBoundedValue(entry, depth + 1));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 500) throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
    return Object.fromEntries(entries.map(([key, entry]) => {
      if (!key || key.length > 200 || key.includes('.')) {
        throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
      }
      return [key, cloneBoundedValue(entry, depth + 1)];
    }));
  }
  throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
};

const parseOptionalDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  return new Date(millis);
};

const sanitizeClientData = (
  item: ClientCreateItem,
  uid: string,
): { groupId?: string; data: DocumentData } => {
  if (!validDocumentId(item.id) || !isRecord(item.data)) {
    throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  }
  const rawGroupId = item.data.groupId;
  const groupId = rawGroupId === undefined || rawGroupId === null
    ? undefined
    : (validDocumentId(rawGroupId)
      ? rawGroupId
      : (() => { throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID'); })());
  const name = item.data.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  }
  if (
    item.data.isNote === true
    || typeof item.data.freq !== 'string'
    || !VALID_FREQUENCIES.has(item.data.freq)
  ) {
    throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  }

  const sanitized: DocumentData = {};
  Object.entries(item.data).forEach(([key, value]) => {
    if (!ALLOWED_FIELDS.has(key) || value === undefined) return;
    if (DATE_FIELDS.has(key)) {
      sanitized[key] = parseOptionalDate(value);
    } else {
      sanitized[key] = cloneBoundedValue(value);
    }
  });

  sanitized.name = name.trim();
  sanitized.isNote = false;
  sanitized.userId = uid;
  sanitized.customerId = typeof sanitized.customerId === 'string' && sanitized.customerId
    ? sanitized.customerId
    : item.id;
  if (groupId) sanitized.groupId = groupId;
  sanitized.scopeKey = groupId ? `scope:${groupId}` : `user:${uid}`;
  sanitized.createdAt = FieldValue.serverTimestamp();
  sanitized.updatedAt = FieldValue.serverTimestamp();
  sanitized.creationVersion = 1;
  return { groupId, data: sanitized };
};

const accountCanWrite = (data: DocumentData | undefined): boolean => {
  const state = data?.accountState;
  return state === undefined || state === null || state === 'active';
};

const assertWritableScope = async (
  transaction: Transaction,
  db: Firestore,
  uid: string,
  userData: DocumentData,
  groupId?: string,
): Promise<void> => {
  if (!groupId) {
    if (typeof userData.pendingGroupId === 'string' && userData.pendingGroupId.trim()) {
      throw new ClientCreationError('CLIENT_CREATE_SCOPE_DENIED');
    }
    return;
  }

  if (userData.groupId === groupId) {
    const group = await transaction.get(db.collection('groups').doc(groupId));
    const lifecycleState = group.data()?.lifecycleState;
    if (!group.exists || (lifecycleState !== undefined && lifecycleState !== 'active')) {
      throw new ClientCreationError('CLIENT_CREATE_SCOPE_DENIED');
    }
    return;
  }

  const profile = await transaction.get(db.collection('profiles').doc(groupId));
  const profileData = profile.data() || {};
  const lifecycleState = profileData.lifecycleState;
  const members = Array.isArray(profileData.memberUids) ? profileData.memberUids : [];
  if (
    !profile.exists
    || (lifecycleState !== undefined && lifecycleState !== 'active')
    || !members.includes(uid)
  ) {
    throw new ClientCreationError('CLIENT_CREATE_SCOPE_DENIED');
  }
};

export const createClientDocuments = async ({
  db,
  uid,
  plan,
  items,
}: CreateClientDocumentsInput): Promise<ClientCreateResult> => {
  if (!uid || !Array.isArray(items) || items.length < 1 || items.length > MAX_CLIENT_CREATE_BATCH) {
    throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  }
  const sanitized = items.map((item) => ({ id: item.id, ...sanitizeClientData(item, uid) }));
  if (new Set(sanitized.map((item) => item.id)).size !== sanitized.length) {
    throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  }
  const scopeIds = new Set(sanitized.map((item) => item.groupId || ''));
  if (scopeIds.size !== 1) throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
  const groupId = sanitized[0].groupId;
  const isPremium = plan === 'monthly' || plan === 'annual';
  if (!isPremium && items.length > 1) {
    throw new ClientCreationError('PREMIUM_REQUIRED');
  }

  return db.runTransaction(async (transaction) => {
    const userRef = db.collection('users').doc(uid);
    const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);
    const clientRefs = sanitized.map((item) => db.collection('clients').doc(item.id));
    const [user, deletionJob, ...existingClients] = await Promise.all([
      transaction.get(userRef),
      transaction.get(deletionJobRef),
      ...clientRefs.map((ref) => transaction.get(ref)),
    ]);
    const userData = user.data() || {};
    if (deletionJob.exists || !accountCanWrite(userData)) {
      throw new ClientCreationError('ACCOUNT_WRITE_BLOCKED');
    }
    await assertWritableScope(transaction, db, uid, userData, groupId);

    const newIndexes: number[] = [];
    existingClients.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        newIndexes.push(index);
        return;
      }
      const existing = snapshot.data() || {};
      const existingGroupId = typeof existing.groupId === 'string' && existing.groupId
        ? existing.groupId
        : undefined;
      if (
        existing.userId !== uid
        || existing.isNote === true
        || existingGroupId !== groupId
      ) {
        throw new ClientCreationError('CLIENT_CREATE_INPUT_INVALID');
      }
    });

    let currentCount: number | null = null;
    if (!isPremium && newIndexes.length > 0) {
      const owned = await transaction.get(
        db.collection('clients').where('userId', '==', uid),
      );
      currentCount = owned.docs.filter((doc) => doc.data().isNote !== true).length;
      if (currentCount + newIndexes.length > FREE_CLIENT_LIMIT) {
        throw new ClientCreationError('CLIENT_LIMIT_REACHED');
      }
    }

    newIndexes.forEach((index) => {
      transaction.create(clientRefs[index], sanitized[index].data);
    });
    transaction.set(userRef, { clientCreateVersion: 1 }, { merge: true });

    return {
      ids: sanitized.map((item) => item.id),
      created: newIndexes.length,
      limit: isPremium ? null : FREE_CLIENT_LIMIT,
      count: isPremium ? null : (currentCount ?? 0) + newIndexes.length,
    };
  });
};
