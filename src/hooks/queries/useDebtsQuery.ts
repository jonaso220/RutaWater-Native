import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../config/firebase';
import { Debt } from '../../types';

interface UseDebtsQueryArgs {
  userId: string;
  groupId?: string;
}

export const debtsQueryKey = (scopeKey: string) => ['debts', scopeKey] as const;

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
export const useDebtsQuery = ({ userId, groupId }: UseDebtsQueryArgs) => {
  const queryClient = useQueryClient();
  const scopeKey = groupId || userId;
  const queryKey = useMemo(() => debtsQueryKey(scopeKey), [scopeKey]);

  useEffect(() => {
    if (!userId) return;
    const scopeField = groupId ? 'groupId' : 'userId';
    const scopeValue = groupId || userId;
    const unsubscribe = db
      .collection('debts')
      .where(scopeField, '==', scopeValue)
      .onSnapshot(
        (snapshot) => {
          const loaded: Debt[] = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Debt[];
          loaded.sort((a, b) => {
            const dateA = (a.createdAt as any)?.seconds || 0;
            const dateB = (b.createdAt as any)?.seconds || 0;
            return dateB - dateA;
          });
          queryClient.setQueryData<Debt[]>(queryKey, loaded);
        },
        (error) => {
          console.error('Error loading debts:', error);
          // Parity: surface empty state on first-error so consumers don't
          // hang in isPending. See useClientsQuery for the rationale.
          if (queryClient.getQueryData<Debt[]>(queryKey) === undefined) {
            queryClient.setQueryData<Debt[]>(queryKey, []);
          }
        },
      );
    return () => unsubscribe();
  }, [userId, groupId, queryClient, queryKey]);

  return useQuery<Debt[]>({
    queryKey,
    queryFn: () => new Promise<Debt[]>(() => {}),
    enabled: !!userId,
  });
};
