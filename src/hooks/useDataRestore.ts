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
import { ValidatedBackup, validateBackup } from '../utils/backupRestore';
import {
  buildBackupRestorePlan,
  CurrentRestoreRecord,
  RestoreCollection,
  RestoreWriteOperation,
} from '../utils/backupRestorePlan';
import { dataScopeQuery } from '../utils/dataScope';
import { belongsToProfileScope } from '../utils/profileScope';

interface UseDataRestoreArgs {
  userId: string;
  groupId?: string;
  profileName: string;
  scopeReadVersion?: number;
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

const commitOperations = async (operations: RestoreWriteOperation[]) => {
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    operations.slice(offset, offset + BATCH_SIZE).forEach(({ collection, id, data }) => {
      batch.set(db.collection(collection).doc(id), data, { merge: true });
    });
    await batch.commit();
  }
};

const loadCurrentScopeRecords = async (
  collection: RestoreCollection,
  userId: string,
  groupId: string | undefined,
  scopeReadVersion: number,
): Promise<CurrentRestoreRecord[]> => {
  const { field, value, additionalFilter } = dataScopeQuery(
    userId,
    groupId,
    scopeReadVersion,
  );
  const baseQuery = db.collection(collection).where(field, '==', value);
  const scopedQuery = additionalFilter
    ? baseQuery.where(additionalFilter.field, '==', additionalFilter.value)
    : baseQuery;
  const snapshot = await scopedQuery.get();
  return snapshot.docs
    .filter((doc) => belongsToProfileScope(doc.data(), userId, groupId))
    .map((doc) => ({ id: doc.id, ...doc.data() }) as CurrentRestoreRecord);
};

export const useDataRestore = ({
  userId,
  groupId,
  profileName,
  scopeReadVersion = 0,
}: UseDataRestoreArgs) => {
  const { t } = useTranslation();
  const [selecting, setSelecting] = useState(false);
  const [writing, setWriting] = useState(false);

  const restoreBackup = useCallback(async (backup: ValidatedBackup) => {
    if (writing) return;
    setWriting(true);
    try {
      // The active stores can still contain the previous route for a moment
      // after switching profiles. Read the authoritative scope immediately
      // before planning so an old cache can never redirect or overwrite a
      // record in the newly selected route. If any read fails, no write starts.
      const [currentClients, currentDebts, currentTransfers] = await Promise.all([
        loadCurrentScopeRecords('clients', userId, groupId, scopeReadVersion),
        loadCurrentScopeRecords('debts', userId, groupId, scopeReadVersion),
        loadCurrentScopeRecords('transfers', userId, groupId, scopeReadVersion),
      ]);
      const operations = buildBackupRestorePlan({
        backup,
        scope: groupId ? { userId, groupId } : { userId },
        currentClients,
        currentDebts,
        currentTransfers,
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
  }, [groupId, scopeReadVersion, t, userId, writing]);

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
