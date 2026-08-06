import { useCallback, useMemo, useRef } from 'react';
import { reportError } from '../lib/crashReporting';
import { db } from '../config/firebase';
import { Transfer, Client } from '../types';
import { useTransfersQuery } from './queries/useTransfersQuery';
import { dataScopeFields } from '../utils/dataScope';
import {
  buildClientIdentityIndex,
  getRelatedClientReference,
  getRelatedRecordStableClientId,
  getStableClientId,
} from '../utils/clientIdentity';

interface UseTransfersProps {
  userId: string;
  groupId?: string;
  clients?: Client[];
  scopeReadVersion?: number;
}

export const useTransfers = ({
  userId,
  groupId,
  clients = [],
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

  const identityIndex = useMemo(() => buildClientIdentityIndex(clients), [clients]);

  // Resolve current stable ids and exact legacy document ids without using
  // editable contact fields.
  const getClientTransfers = useCallback(
    (clientId: string): Transfer[] => {
      const stableId = getRelatedRecordStableClientId(clientId, identityIndex);
      return transfersRef.current.filter(
        (transfer) => getRelatedRecordStableClientId(transfer, identityIndex) === stableId,
      );
    },
    [identityIndex],
  );

  const hasPendingTransfer = useCallback(
    (clientId: string): boolean => {
      const stableId = getRelatedRecordStableClientId(clientId, identityIndex);
      return transfersRef.current.some(
        (transfer) => getRelatedRecordStableClientId(transfer, identityIndex) === stableId,
      );
    },
    [identityIndex],
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
