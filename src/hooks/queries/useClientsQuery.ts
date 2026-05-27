import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../config/firebase';
import { Client } from '../../types';
import { withDefaults } from '../../utils/clientDefaults';

interface UseClientsQueryArgs {
  userId: string;
  groupId?: string;
}

export const clientsQueryKey = (scopeKey: string) => ['clients', scopeKey] as const;

/**
 * Live clients query backed by a perpetual Firestore listener.
 *
 * The listener pushes every snapshot into the React Query cache via
 * setQueryData, so consumers see real-time updates without manual refetch.
 * The query never auto-refetches (configured in queryClient.ts).
 *
 * Unused as of commit 2 of the StoreSync → TanStack Query migration. Will
 * replace the listener inside useClients.ts in commit 4.
 */
export const useClientsQuery = ({ userId, groupId }: UseClientsQueryArgs) => {
  const queryClient = useQueryClient();
  const scopeKey = groupId || userId;
  const queryKey = useMemo(() => clientsQueryKey(scopeKey), [scopeKey]);

  useEffect(() => {
    if (!userId) return;
    const scopeField = groupId ? 'groupId' : 'userId';
    const scopeValue = groupId || userId;
    const unsubscribe = db
      .collection('clients')
      .where(scopeField, '==', scopeValue)
      .onSnapshot(
        (snapshot) => {
          const clients = snapshot.docs.map((doc) => withDefaults(doc.id, doc.data()));
          queryClient.setQueryData<Client[]>(queryKey, clients);
        },
        (error) => {
          console.error('Error loading clients:', error);
        },
      );
    return () => unsubscribe();
  }, [userId, groupId, queryClient, queryKey]);

  return useQuery<Client[]>({
    queryKey,
    // The Firestore listener feeds data via setQueryData; this promise is
    // intentionally never resolved. Once the first snapshot arrives,
    // setQueryData transitions the query to 'success'.
    queryFn: () => new Promise<Client[]>(() => {}),
    enabled: !!userId,
  });
};
