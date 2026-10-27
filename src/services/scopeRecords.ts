import { db } from '../config/firebase';
import type { CurrentRestoreRecord, RestoreCollection } from '../utils/backupRestorePlan';
import { dataScopeQuery } from '../utils/dataScope';
import { belongsToProfileScope } from '../utils/profileScope';

/** Every document of a collection in the active data scope, read from the server. */
export const loadCurrentScopeRecords = async (
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
