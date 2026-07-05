import { useEffect, useMemo } from 'react';
import { reportError } from '../../lib/crashReporting';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../config/firebase';
import { Transfer } from '../../types';
import { parseDate } from '../../utils/helpers';

interface UseTransfersQueryArgs {
  userId: string;
  groupId?: string;
}

export const transfersQueryKey = (scopeKey: string) => ['transfers', scopeKey] as const;

/**
 * Live transfers query backed by a perpetual Firestore listener.
 * Same pattern as useClientsQuery / useDebtsQuery.
 */
export const useTransfersQuery = ({ userId, groupId }: UseTransfersQueryArgs) => {
  const queryClient = useQueryClient();
  const scopeKey = groupId || userId;
  const queryKey = useMemo(() => transfersQueryKey(scopeKey), [scopeKey]);

  useEffect(() => {
    if (!userId) return;
    const scopeField = groupId ? 'groupId' : 'userId';
    const scopeValue = groupId || userId;
    const unsubscribe = db
      .collection('transfers')
      .where(scopeField, '==', scopeValue)
      .onSnapshot(
        (snapshot) => {
          const loaded: Transfer[] = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Transfer[];
          loaded.sort((a, b) => {
            const dateA = parseDate(a.createdAt)?.getTime() || 0;
            const dateB = parseDate(b.createdAt)?.getTime() || 0;
            return dateB - dateA;
          });
          queryClient.setQueryData<Transfer[]>(queryKey, loaded);
        },
        (error) => {
          reportError(error, 'Error loading transfers');
          // Parity: surface empty state on first-error so consumers don't
          // hang in isPending. See useClientsQuery for the rationale.
          if (queryClient.getQueryData<Transfer[]>(queryKey) === undefined) {
            queryClient.setQueryData<Transfer[]>(queryKey, []);
          }
        },
      );
    return () => unsubscribe();
  }, [userId, groupId, queryClient, queryKey]);

  return useQuery<Transfer[]>({
    queryKey,
    queryFn: () => new Promise<Transfer[]>(() => {}),
    enabled: !!userId,
  });
};
