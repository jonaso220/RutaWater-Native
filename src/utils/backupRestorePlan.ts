import type { ValidatedBackup } from './backupRestore';
import { dataScopeFields } from './dataScope';

export type RestoreCollection = 'clients' | 'debts' | 'transfers';

export interface CurrentRestoreRecord {
  id: string;
  backupSourceId?: string;
  clientId?: string;
  userId?: string;
  groupId?: string;
}

export interface RestoreScope {
  userId: string;
  groupId?: string;
}

export interface RestoreWriteOperation {
  collection: RestoreCollection;
  id: string;
  data: Record<string, any>;
}

interface RestorePlanInput {
  backup: ValidatedBackup;
  scope: RestoreScope;
  currentClients: CurrentRestoreRecord[];
  currentDebts: CurrentRestoreRecord[];
  currentTransfers: CurrentRestoreRecord[];
  now?: Date;
}

const sourceId = (record: CurrentRestoreRecord): string =>
  typeof record.backupSourceId === 'string' ? record.backupSourceId : '';

interface CurrentRecordIndex {
  byDocumentId: Map<string, CurrentRestoreRecord>;
  byBackupSourceId: Map<string, CurrentRestoreRecord>;
}

const indexCurrentRecords = (
  records: CurrentRestoreRecord[],
): CurrentRecordIndex => {
  const byDocumentId = new Map<string, CurrentRestoreRecord>();
  const byBackupSourceId = new Map<string, CurrentRestoreRecord>();
  records.forEach((record) => {
    if (record.id) byDocumentId.set(record.id, record);
    const restoredId = sourceId(record);
    // A malformed/legacy scope may contain more than one restored copy. Keep
    // the first stable fallback, but never let a backupSourceId shadow an
    // actual Firestore document id.
    if (restoredId && !byBackupSourceId.has(restoredId)) {
      byBackupSourceId.set(restoredId, record);
    }
  });
  return { byDocumentId, byBackupSourceId };
};

const findCurrentRecord = (
  index: CurrentRecordIndex,
  backupId: string,
): CurrentRestoreRecord | undefined =>
  index.byDocumentId.get(backupId) ?? index.byBackupSourceId.get(backupId);

/**
 * Stable destination id for a backup record in one active data scope.
 *
 * The length prefix makes the `(scope, sourceId)` tuple unambiguous without a
 * lossy hash. Both values are already valid Firestore document-id components:
 * scope ids originate in Firestore/Auth, and backup source ids reject `/`.
 * Reusing the same id is what makes a retry safe even before live listeners
 * have observed the batches that committed in the previous attempt.
 */
export const deterministicRestoreDocumentId = (
  collection: RestoreCollection,
  scopeKey: string,
  backupSourceId: string,
): string => `rwrestore-v1-${collection}-${scopeKey.length}-${scopeKey}-${backupSourceId}`;

const scopeForNewRecord = (existing: CurrentRestoreRecord | undefined, scope: RestoreScope) =>
  existing ? {} : dataScopeFields(scope.userId, scope.groupId);

export const buildBackupRestorePlan = ({
  backup,
  scope,
  currentClients,
  currentDebts,
  currentTransfers,
  now = new Date(),
}: RestorePlanInput): RestoreWriteOperation[] => {
  const scopeKey = scope.groupId || scope.userId;
  const indexedClients = indexCurrentRecords(currentClients);
  const indexedDebts = indexCurrentRecords(currentDebts);
  const indexedTransfers = indexCurrentRecords(currentTransfers);
  const clientIdMap = new Map<string, string>();
  const clientExistingMap = new Map<string, CurrentRestoreRecord | undefined>();

  backup.clients.forEach((client) => {
    const existing = findCurrentRecord(indexedClients, client.id);
    const destinationId = existing?.id || deterministicRestoreDocumentId(
      'clients',
      scopeKey,
      client.id,
    );
    clientIdMap.set(client.id, destinationId);
    clientExistingMap.set(client.id, existing);
  });

  // customerId can be a logical identity whose original document no longer
  // exists. Every agenda for it must converge on one stable destination id.
  const customerIdMap = new Map<string, string>();
  backup.clients.forEach((client) => {
    if (customerIdMap.has(client.customerId)) return;
    customerIdMap.set(
      client.customerId,
      clientIdMap.get(client.customerId)
        || findCurrentRecord(indexedClients, client.customerId)?.id
        || clientIdMap.get(client.id)!,
    );
  });

  const resolveClientId = (oldId: string, existingRecord?: CurrentRestoreRecord): string =>
    clientIdMap.get(oldId)
      || findCurrentRecord(indexedClients, oldId)?.id
      || (typeof existingRecord?.clientId === 'string' && existingRecord.clientId
        ? existingRecord.clientId
        : deterministicRestoreDocumentId('clients', scopeKey, oldId));

  const operations: RestoreWriteOperation[] = [];
  backup.clients.forEach((client) => {
    const relationships: Record<string, string> = {};
    const sameHousehold: Record<string, boolean> = {};
    Object.entries(client.relationships).forEach(([oldRelatedId, type]) => {
      const relatedId = clientIdMap.get(oldRelatedId)
        || findCurrentRecord(indexedClients, oldRelatedId)?.id;
      if (!relatedId) return;
      relationships[relatedId] = type;
      // Missing legacy values intentionally remain absent so the compatible
      // default (same household) continues to apply.
      if (typeof client.sameHousehold[oldRelatedId] === 'boolean') {
        sameHousehold[relatedId] = client.sameHousehold[oldRelatedId];
      }
    });

    const { id, customerId, isNote, ...clientData } = client;
    const existing = clientExistingMap.get(id);
    operations.push({
      collection: 'clients',
      id: clientIdMap.get(id)!,
      data: {
        ...clientData,
        customerId: customerIdMap.get(customerId) || clientIdMap.get(id)!,
        relationships,
        sameHousehold,
        // Existing shared documents may have been created by another member.
        // Omitting scope fields preserves their canonical attribution byte for
        // byte; merge writes retain the current userId/groupId.
        ...scopeForNewRecord(existing, scope),
        // `isNote` controls the narrow member-delete permission and is
        // immutable for an existing document. Only a newly restored record
        // receives the value from the backup.
        ...(existing ? {} : { isNote }),
        backupSourceId: id,
        updatedAt: now,
      },
    });
  });

  backup.debts.forEach((debt) => {
    const existing = findCurrentRecord(indexedDebts, debt.id);
    const { id, clientId, ...debtData } = debt;
    operations.push({
      collection: 'debts',
      id: existing?.id || deterministicRestoreDocumentId('debts', scopeKey, id),
      data: {
        ...debtData,
        clientId: resolveClientId(clientId, existing),
        ...scopeForNewRecord(existing, scope),
        backupSourceId: id,
      },
    });
  });

  backup.transfers.forEach((transfer) => {
    const existing = findCurrentRecord(indexedTransfers, transfer.id);
    const { id, clientId, ...transferData } = transfer;
    operations.push({
      collection: 'transfers',
      id: existing?.id || deterministicRestoreDocumentId('transfers', scopeKey, id),
      data: {
        ...transferData,
        clientId: resolveClientId(clientId, existing),
        ...scopeForNewRecord(existing, scope),
        backupSourceId: id,
      },
    });
  });

  return operations;
};
