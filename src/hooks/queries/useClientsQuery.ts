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
          // Build the list from the authoritative snapshot.docs (so membership
          // is always correct — deleted docs are absent), but REUSE the prior
          // object reference for any doc that didn't change. Reusing references
          // keeps the React.memo on ClientCard intact so a single write (our
          // own reorder echo, or another device's edit) only re-renders the
          // card that actually changed — not all 100+ — which is what fixed
          // the drag "jitter".
          //
          // We must rebuild from snapshot.docs (not merge docChanges into the
          // old cache) because when this listener RE-SUBSCRIBES — e.g. after
          // switching the active reparto and coming back, with the previous
          // scope's cache still alive (gcTime: Infinity) — the fresh listener
          // reports every doc as "added" and never emits "removed" for docs
          // deleted while it was detached. Merging would resurrect those as
          // ghost clients. Rebuilding from snapshot.docs avoids that.
          const prev = queryClient.getQueryData<Client[]>(queryKey);
          const prevById = new Map((prev ?? []).map((c) => [c.id, c]));
          // Docs added/modified in this snapshot must get a fresh object.
          const changedIds = new Set(
            snapshot
              .docChanges()
              .filter((ch) => ch.type !== 'removed')
              .map((ch) => ch.doc.id),
          );
          const next = snapshot.docs.map((doc) => {
            const existing = prevById.get(doc.id);
            return existing && !changedIds.has(doc.id)
              ? existing
              : withDefaults(doc.id, doc.data());
          });
          queryClient.setQueryData<Client[]>(queryKey, next);
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
