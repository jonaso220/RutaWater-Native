import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../lib/crashReporting';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../config/firebase';
import { Client } from '../../types';
import { withDefaults } from '../../utils/clientDefaults';
import { belongsToProfileScope } from '../../utils/profileScope';
import { dataScopeCacheKey, dataScopeQuery } from '../../utils/dataScope';
import { isLiveSnapshotReady, liveSnapshotGeneration } from '../../utils/liveSnapshot';

interface UseClientsQueryArgs {
  userId: string;
  groupId?: string;
  scopeReadVersion?: number;
}

export const clientsQueryKey = (scopeKey: string, scopeReadVersion = 0) =>
  dataScopeCacheKey('clients', scopeKey, scopeReadVersion);

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
export const useClientsQuery = ({
  userId,
  groupId,
  scopeReadVersion = 0,
}: UseClientsQueryArgs) => {
  const queryClient = useQueryClient();
  const scopeKey = groupId || userId;
  const queryKey = useMemo(
    () => clientsQueryKey(scopeKey, scopeReadVersion),
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
      .collection('clients')
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
          // Build the list from the authoritative snapshot.docs (so membership
          // is always correct — deleted docs are absent), but REUSE the prior
          // object reference for any doc that didn't change. Reusing references
          // keeps the React.memo on ClientCard intact so a single write (our
          // own reorder echo, or another device's edit) only re-renders the
          // card that actually changed — not all 100+ — which keeps reorder
          // updates smooth.
          //
          // We must rebuild from snapshot.docs (not merge docChanges into the
          // old cache) because when this listener RE-SUBSCRIBES — e.g. after
          // switching the active reparto and coming back, with the previous
          // scope's cache still alive (gcTime: Infinity) — the fresh listener
          // reports every doc as "added" and never emits "removed" for docs
          // deleted while it was detached. Merging would resurrect those as
          // ghost clients. Rebuilding from snapshot.docs avoids that.
          // Sin grupo familiar, Reparto 1 consulta por userId. Los repartos
          // personalizados también guardan ese userId, pero tienen groupId y
          // deben quedar fuera para que cada reparto sea realmente aislado.
          const visibleDocs = snapshot.docs.filter((doc) =>
            belongsToProfileScope(doc.data(), userId, groupId),
          );
          const prev = queryClient.getQueryData<Client[]>(queryKey);
          const prevById = new Map((prev ?? []).map((c) => [c.id, c]));
          // Docs added/modified in this snapshot must get a fresh object.
          const changedIds = new Set(
            snapshot
              .docChanges()
              .filter((ch) => ch.type !== 'removed')
              .map((ch) => ch.doc.id),
          );
          const next = visibleDocs.map((doc) => {
            const existing = prevById.get(doc.id);
            return existing && !changedIds.has(doc.id)
              ? existing
              : withDefaults(doc.id, doc.data());
          });
          queryClient.setQueryData<Client[]>(queryKey, next);
          setReadyGeneration(generation);
        },
        (error: any) => {
          reportError(error, 'Error loading clients');
          // Permiso revocado (expulsado del reparto, reparto borrado): el
          // listener muere y NO se recupera. Dejar la caché intacta era una
          // UI congelada con datos viejos donde toda acción fallaba en
          // silencio — vaciar la lista es honesto (pantalla "sin clientes").
          if (String(error?.code || '').includes('permission-denied')) {
            queryClient.setQueryData<Client[]>(queryKey, []);
            setReadyGeneration(generation);
            return;
          }
          // This listener generation did not authorize a fresh snapshot.
          // Empty the keyed cache instead of rendering a revisited stale one.
          queryClient.setQueryData<Client[]>(queryKey, []);
          setReadyGeneration(generation);
        },
      );
    return () => unsubscribe();
  }, [userId, groupId, scopeReadVersion, queryClient, queryKey, generation]);

  const query = useQuery<Client[]>({
    queryKey,
    // The Firestore listener feeds data via setQueryData; this promise is
    // intentionally never resolved. Once the first snapshot arrives,
    // setQueryData transitions the query to 'success'.
    queryFn: () => new Promise<Client[]>(() => {}),
    enabled: !!userId,
  });
  return {
    ...query,
    snapshotReady: isLiveSnapshotReady(readyGeneration, generation),
  };
};
