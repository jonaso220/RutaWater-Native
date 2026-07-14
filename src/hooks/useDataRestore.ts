import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import RNFS from 'react-native-fs';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';
import { useTranslation } from 'react-i18next';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { useClientsStore } from '../stores/clientsStore';
import { useDebtsStore } from '../stores/debtsStore';
import { useTransfersStore } from '../stores/transfersStore';
import { ValidatedBackup, validateBackup } from '../utils/backupRestore';

interface UseDataRestoreArgs {
  userId: string;
  groupId?: string;
  profileName: string;
}

interface WriteOperation {
  ref: any;
  data: Record<string, any>;
}

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const BATCH_SIZE = 400;

const localPathFromUri = (uri: string): string => {
  const path = uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const sourceId = (record: any): string =>
  typeof record?.backupSourceId === 'string' ? record.backupSourceId : '';

const indexCurrentRecords = (records: any[]): Map<string, any> => {
  const index = new Map<string, any>();
  records.forEach((record) => {
    if (record?.id) index.set(record.id, record);
    const restoredId = sourceId(record);
    if (restoredId) index.set(restoredId, record);
  });
  return index;
};

const commitOperations = async (operations: WriteOperation[]) => {
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    operations.slice(offset, offset + BATCH_SIZE).forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true });
    });
    await batch.commit();
  }
};

export const useDataRestore = ({ userId, groupId, profileName }: UseDataRestoreArgs) => {
  const { t } = useTranslation();
  const clients = useClientsStore((state) => state.clients);
  const debts = useDebtsStore((state) => state.debts);
  const transfers = useTransfersStore((state) => state.transfers);
  const [selecting, setSelecting] = useState(false);
  const [writing, setWriting] = useState(false);

  const restoreBackup = useCallback(async (backup: ValidatedBackup) => {
    if (writing) return;
    setWriting(true);
    try {
      const scope = groupId ? { userId, groupId } : { userId };
      const clientCollection = db.collection('clients');
      const debtCollection = db.collection('debts');
      const transferCollection = db.collection('transfers');
      const currentClients = indexCurrentRecords(clients);
      const currentDebts = indexCurrentRecords(debts);
      const currentTransfers = indexCurrentRecords(transfers);
      const clientIdMap = new Map<string, string>();
      const clientRefs = new Map<string, any>();

      backup.clients.forEach((client) => {
        const existing = currentClients.get(client.id);
        const ref = existing ? clientCollection.doc(existing.id) : clientCollection.doc();
        clientIdMap.set(client.id, ref.id);
        clientRefs.set(client.id, ref);
      });

      // customerId puede ser una identidad lógica cuyo documento original ya
      // no existe (por ejemplo, después de limpiar un duplicado). Al restaurar,
      // todas sus agendas deben converger al mismo identificador nuevo.
      const customerIdMap = new Map<string, string>();
      backup.clients.forEach((client) => {
        if (customerIdMap.has(client.customerId)) return;
        customerIdMap.set(
          client.customerId,
          clientIdMap.get(client.customerId) ||
            currentClients.get(client.customerId)?.id ||
            clientIdMap.get(client.id)!,
        );
      });

      const orphanClientIds = new Map<string, string>();
      const resolveClientId = (oldId: string, existingRecord?: any): string => {
        const restored = clientIdMap.get(oldId);
        if (restored) return restored;
        const current = currentClients.get(oldId);
        if (current?.id) return current.id;
        if (existingRecord?.clientId) return existingRecord.clientId;
        const prior = orphanClientIds.get(oldId);
        if (prior) return prior;
        const generated = clientCollection.doc().id;
        orphanClientIds.set(oldId, generated);
        return generated;
      };

      const operations: WriteOperation[] = [];
      backup.clients.forEach((client) => {
        const relationships: Record<string, string> = {};
        const sameHousehold: Record<string, boolean> = {};
        Object.entries(client.relationships).forEach(([oldRelatedId, type]) => {
          const relatedId = clientIdMap.get(oldRelatedId) || currentClients.get(oldRelatedId)?.id;
          if (relatedId) {
            relationships[relatedId] = type;
            // Missing values come from legacy backups and intentionally stay
            // absent so the backwards-compatible default (same home) applies.
            if (typeof client.sameHousehold[oldRelatedId] === 'boolean') {
              sameHousehold[relatedId] = client.sameHousehold[oldRelatedId];
            }
          }
        });
        const { id, customerId, ...clientData } = client;
        const restoredCustomerId = customerIdMap.get(customerId) || clientIdMap.get(id)!;
        operations.push({
          ref: clientRefs.get(id),
          data: {
            ...clientData,
            customerId: restoredCustomerId,
            relationships,
            sameHousehold,
            ...scope,
            backupSourceId: id,
            updatedAt: new Date(),
          },
        });
      });

      backup.debts.forEach((debt) => {
        const existing = currentDebts.get(debt.id);
        const ref = existing ? debtCollection.doc(existing.id) : debtCollection.doc();
        const { id, clientId, ...debtData } = debt;
        operations.push({
          ref,
          data: {
            ...debtData,
            clientId: resolveClientId(clientId, existing),
            ...scope,
            backupSourceId: id,
          },
        });
      });

      backup.transfers.forEach((transfer) => {
        const existing = currentTransfers.get(transfer.id);
        const ref = existing ? transferCollection.doc(existing.id) : transferCollection.doc();
        const { id, clientId, ...transferData } = transfer;
        operations.push({
          ref,
          data: {
            ...transferData,
            clientId: resolveClientId(clientId, existing),
            ...scope,
            backupSourceId: id,
          },
        });
      });

      await commitOperations(operations);
      Alert.alert(
        t('settings.restoreCompleteTitle'),
        t('settings.restoreCompleteMsg', {
          clients: backup.clients.length,
          debts: backup.debts.length,
          transfers: backup.transfers.length,
        }),
      );
    } catch (error) {
      reportError(error, 'Error restoring JSON backup');
      Alert.alert(t('error'), t('settings.restoreWriteError'));
    } finally {
      setWriting(false);
    }
  }, [clients, debts, groupId, t, transfers, userId, writing]);

  const handleRestoreJSON = useCallback(async () => {
    if (selecting || writing) return;
    setSelecting(true);
    let copiedPath = '';
    try {
      const [file] = await pick({
        type: types.json,
        mode: 'import',
        allowMultiSelection: false,
      });
      if (file.size !== null && file.size > MAX_BACKUP_BYTES) {
        throw new Error('BACKUP_FILE_TOO_LARGE');
      }

      const [copy] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: file.name || 'RutaWater_Backup.json' }],
        destination: 'cachesDirectory',
      });
      if (copy.status !== 'success') throw new Error('BACKUP_COPY_FAILED');
      copiedPath = localPathFromUri(copy.localUri);
      const stat = await RNFS.stat(copiedPath);
      if (Number(stat.size) > MAX_BACKUP_BYTES) throw new Error('BACKUP_FILE_TOO_LARGE');
      const content = await RNFS.readFile(copiedPath, 'utf8');
      const backup = validateBackup(JSON.parse(content.replace(/^\uFEFF/, '')));

      setSelecting(false);
      Alert.alert(
        t('settings.restoreConfirmTitle'),
        t('settings.restoreConfirmMsg', {
          profile: profileName,
          date: backup.exportDate || t('settings.restoreUnknownDate'),
          clients: backup.clients.length,
          debts: backup.debts.length,
          transfers: backup.transfers.length,
        }),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('settings.restoreAction'),
            onPress: () => void restoreBackup(backup),
          },
        ],
      );
    } catch (error) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) return;
      reportError(error, 'Error selecting JSON backup');
      const message = error instanceof Error && error.message === 'BACKUP_FILE_TOO_LARGE'
        ? t('settings.restoreTooLarge')
        : t('settings.restoreInvalidFile');
      Alert.alert(t('settings.restoreInvalidTitle'), message);
    } finally {
      setSelecting(false);
      if (copiedPath) {
        RNFS.unlink(copiedPath).catch(() => {});
      }
    }
  }, [profileName, restoreBackup, selecting, t, writing]);

  return {
    handleRestoreJSON,
    restoring: selecting || writing,
  };
};
