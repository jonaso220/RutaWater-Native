import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../lib/crashReporting';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../config/firebase';
import { Transfer } from '../../types';
import { sortByCreatedAtDesc } from '../../utils/sortByCreatedAt';
import { belongsToProfileScope } from '../../utils/profileScope';
import { dataScopeCacheKey, dataScopeQuery } from '../../utils/dataScope';
import { isLiveSnapshotReady, liveSnapshotGeneration } from '../../utils/liveSnapshot';

interface UseTransfersQueryArgs {
  userId: string;
  groupId?: string;
  scopeReadVersion?: number;
}

export const transfersQueryKey = (scopeKey: string, scopeReadVersion = 0) =>
  dataScopeCacheKey('transfers', scopeKey, scopeReadVersion);

/**
 * Live transfers query backed by a perpetual Firestore listener.
 * Same pattern as useClientsQuery / useDebtsQuery.
 */
export const useTransfersQuery = ({
  userId,
  groupId,
  scopeReadVersion = 0,
}: UseTransfersQueryArgs) => {
  const queryClient = useQueryClient();
  const scopeKey = groupId || userId;
  const queryKey = useMemo(
    () => transfersQueryKey(scopeKey, scopeReadVersion),
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
      .collection('transfers')
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
          const inScope: Transfer[] = [];
          snapshot.docs.forEach((doc) => {
            const data = doc.data();
            if (belongsToProfileScope(data, userId, groupId)) {
              inScope.push({ id: doc.id, ...data } as Transfer);
            }
          });
          const loaded = sortByCreatedAtDesc(inScope);
          queryClient.setQueryData<Transfer[]>(queryKey, loaded);
          setReadyGeneration(generation);
        },
        (error) => {
          reportError(error, 'Error loading transfers');
          queryClient.setQueryData<Transfer[]>(queryKey, []);
          setReadyGeneration(generation);
        },
      );
    return () => unsubscribe();
  }, [userId, groupId, scopeReadVersion, queryClient, queryKey, generation]);

  const query = useQuery<Transfer[]>({
    queryKey,
    queryFn: () => new Promise<Transfer[]>(() => {}),
    enabled: !!userId,
  });
  return {
    ...query,
    snapshotReady: isLiveSnapshotReady(readyGeneration, generation),
  };
};
