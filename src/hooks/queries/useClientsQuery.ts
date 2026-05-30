import { useEffect, useMemo } from 'react';
import { reportError } from '../../lib/crashReporting';
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
          const prev = queryClient.getQueryData<Client[]>(queryKey);
          // First snapshot (or cache cleared): build the full list.
          if (!prev) {
            queryClient.setQueryData<Client[]>(
              queryKey,
              snapshot.docs.map((doc) => withDefaults(doc.id, doc.data())),
            );
            return;
          }
          // Incremental update: rebuild ONLY the documents that actually
          // changed and reuse the existing object reference for everything
          // else. Without this, every snapshot (including the local echo of
          // our own reorder write, and any write from another device) handed
          // a brand-new object to all 100+ clients, defeating the React.memo
          // on ClientCard and re-rendering the entire list at once — the
          // source of the card "jitter" when moving a client far down the list.
          const changes = snapshot.docChanges();
          if (changes.length === 0) return; // doc set identical; keep same reference
          const byId = new Map(prev.map((c) => [c.id, c]));
          changes.forEach((change) => {
            if (change.type === 'removed') {
              byId.delete(change.doc.id);
            } else {
              byId.set(change.doc.id, withDefaults(change.doc.id, change.doc.data()));
            }
          });
          queryClient.setQueryData<Client[]>(queryKey, Array.from(byId.values()));
        },
        (error) => {
          reportError(error, 'Error loading clients');
          // Parity with the legacy hook: on a Firestore error before any
          // data has loaded, surface an empty array so consumers exit the
          // `isPending` state (the old code did setLoading(false)+empty).
          // If real data already arrived, leave the existing cache intact.
          if (queryClient.getQueryData<Client[]>(queryKey) === undefined) {
            queryClient.setQueryData<Client[]>(queryKey, []);
          }
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
