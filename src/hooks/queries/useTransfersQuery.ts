import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../config/firebase';
import { Transfer } from '../../types';

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
            const dateA = (a.createdAt as any)?.seconds || 0;
            const dateB = (b.createdAt as any)?.seconds || 0;
            return dateB - dateA;
          });
          queryClient.setQueryData<Transfer[]>(queryKey, loaded);
        },
        (error) => {
          console.error('Error loading transfers:', error);
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
