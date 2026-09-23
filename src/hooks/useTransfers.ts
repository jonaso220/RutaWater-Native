import { useCallback, useMemo, useRef } from 'react';
import { reportError } from '../lib/crashReporting';
import { db } from '../config/firebase';
import { Transfer, Client } from '../types';
import { useTransfersQuery } from './queries/useTransfersQuery';
import { dataScopeFields } from '../utils/dataScope';
import {
  ClientStableIdIndex,
  getRelatedClientReference,
  getRelatedRecordStableClientId,
  getStableClientId,
} from '../utils/clientIdentity';

interface UseTransfersProps {
  userId: string;
  groupId?: string;
  // Shared with useDebts; built once per client snapshot in StoreSync.
  identityIndex: ClientStableIdIndex;
  scopeReadVersion?: number;
}

export const useTransfers = ({
  userId,
  groupId,
  identityIndex,
  scopeReadVersion = 0,
}: UseTransfersProps) => {
  // Data source: TanStack Query holds the live transfers array via
  // useTransfersQuery's Firestore listener.
  const transfersQuery = useTransfersQuery({ userId, groupId, scopeReadVersion });
  const transfers = useMemo<Transfer[]>(
    () => transfersQuery.snapshotReady ? (transfersQuery.data ?? []) : [],
    [transfersQuery.data, transfersQuery.snapshotReady],
  );
  const transfersRef = useRef<Transfer[]>(transfers);
  transfersRef.current = transfers;
  const busyRef = useRef<Set<string>>(new Set());

  // Resolve current stable ids and exact legacy document ids without using
  // editable contact fields. Grouped once per transfers/ids change so each
  // lookup is O(1); the lookups depend on this map (not on a ref) so memoized
  // consumers such as HomeScreen's transferMap refresh when transfers change.
  const transfersByStableId = useMemo(() => {
    const byStableId = new Map<string, Transfer[]>();
    transfers.forEach((transfer) => {
      const stableId = getRelatedRecordStableClientId(transfer, identityIndex);
      const matches = byStableId.get(stableId);
      if (matches) matches.push(transfer);
      else byStableId.set(stableId, [transfer]);
    });
    return byStableId;
  }, [transfers, identityIndex]);

  const getClientTransfers = useCallback(
    (clientId: string): Transfer[] => {
      const stableId = getRelatedRecordStableClientId(clientId, identityIndex);
      return [...(transfersByStableId.get(stableId) || [])];
    },
    [transfersByStableId, identityIndex],
  );

  const hasPendingTransfer = useCallback(
    (clientId: string): boolean => (
      transfersByStableId.has(getRelatedRecordStableClientId(clientId, identityIndex))
    ),
    [transfersByStableId, identityIndex],
  );

  const addTransfer = useCallback(
    async (client: Client) => {
      const stableClientId = getStableClientId(client);
      const key = `add-${stableClientId}`;
      if (busyRef.current.has(key)) return false;
      busyRef.current.add(key);
      try {
        // Usa el ref sincrónico para evitar carrera con el listener
        const existing = transfersRef.current.find(
          (transfer) => getRelatedRecordStableClientId(transfer, identityIndex) === stableClientId,
        );
        if (existing) return false;

        const scope = dataScopeFields(userId, groupId);
        await db.collection('transfers').add({
          ...scope,
          ...getRelatedClientReference(client),
          clientName: client.name,
          clientAddress: client.address || '',
          clientLat: client.lat || null,
          clientLng: client.lng || null,
          clientMapsLink: client.mapsLink || null,
          createdAt: new Date(),
        });
        return true;
      } catch (e) {
        reportError(e, 'Error adding transfer');
        throw e;
      } finally {
        busyRef.current.delete(key);
      }
    },
    [groupId, identityIndex, userId],
  );

  // Revisar una transferencia BORRA el documento; el estado "tiene transferencia
  // pendiente" se deriva siempre en vivo de la colección (hasPendingTransfer),
  // no de ningún flag persistido.
  const markTransferReviewed = useCallback(
    async (transfer: Transfer) => {
      const key = `review-${transfer.id}`;
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);
      try {
        await db.collection('transfers').doc(transfer.id).delete();
      } catch (e) {
        reportError(e, 'Error reviewing transfer');
        throw e;
      } finally {
        busyRef.current.delete(key);
      }
    },
    [],
  );

  return {
    transfers,
    getClientTransfers,
    hasPendingTransfer,
    addTransfer,
    markTransferReviewed,
  };
};
