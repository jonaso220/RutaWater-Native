import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../lib/crashReporting';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../config/firebase';
import { Debt } from '../../types';
import { parseDate } from '../../utils/helpers';
import { belongsToProfileScope } from '../../utils/profileScope';
import { dataScopeCacheKey, dataScopeQuery } from '../../utils/dataScope';
import { isLiveSnapshotReady, liveSnapshotGeneration } from '../../utils/liveSnapshot';

interface UseDebtsQueryArgs {
  userId: string;
  groupId?: string;
  scopeReadVersion?: number;
}

export const debtsQueryKey = (scopeKey: string, scopeReadVersion = 0) =>
  dataScopeCacheKey('debts', scopeKey, scopeReadVersion);

/**
 * Live debts query backed by a perpetual Firestore listener.
 *
 * Mirrors the pattern used by useClientsQuery: the listener pushes each
 * snapshot into the cache via setQueryData, and the queryFn is a
 * never-resolving promise (setQueryData transitions the query to
 * 'success' on first snapshot).
 *
 * Data is sorted by createdAt desc to match the legacy useDebts hook.
 */
export const useDebtsQuery = ({
  userId,
  groupId,
  scopeReadVersion = 0,
}: UseDebtsQueryArgs) => {
  const queryClient = useQueryClient();
  const scopeKey = groupId || userId;
  const queryKey = useMemo(
    () => debtsQueryKey(scopeKey, scopeReadVersion),
    [scopeKey, scopeReadVersion],
  );
  const generation = liveSnapshotGeneration(scopeKey, scopeReadVersion);
  const [readyGeneration, setReadyGeneration] = useState('');

  useEffect(() => {
    if (!userId) return;
    const { field: scopeField, value: scopeValue, additionalFilter } = dataScopeQuery(
      userId,
      groupId,
      scopeReadVersion,
    );
    let scopedQuery = db
      .collection('debts')
      .where(scopeField, '==', scopeValue);
    if (additionalFilter) {
      scopedQuery = scopedQuery.where(
        additionalFilter.field,
        '==',
        additionalFilter.value,
      );
    }
    const unsubscribe = scopedQuery.onSnapshot(
        (snapshot) => {
          const loaded: Debt[] = snapshot.docs
            .filter((doc) => belongsToProfileScope(doc.data(), userId, groupId))
            .map((doc) => ({
              id: doc.id,
              ...doc.data(),
            })) as Debt[];
          loaded.sort((a, b) => {
            const dateA = parseDate(a.createdAt)?.getTime() || 0;
            const dateB = parseDate(b.createdAt)?.getTime() || 0;
            return dateB - dateA;
          });
          queryClient.setQueryData<Debt[]>(queryKey, loaded);
          setReadyGeneration(generation);
        },
        (error) => {
          reportError(error, 'Error loading debts');
          // A listener error terminates this generation. Never expose an old
          // cached snapshot as if it had been authorized by the new listener.
          queryClient.setQueryData<Debt[]>(queryKey, []);
          setReadyGeneration(generation);
        },
      );
    return () => unsubscribe();
  }, [userId, groupId, scopeReadVersion, queryClient, queryKey, generation]);

  const query = useQuery<Debt[]>({
    queryKey,
    queryFn: () => new Promise<Debt[]>(() => {}),
    enabled: !!userId,
  });
  return {
    ...query,
    snapshotReady: isLiveSnapshotReady(readyGeneration, generation),
  };
};
