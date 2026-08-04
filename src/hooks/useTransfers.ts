import { useCallback, useMemo, useRef } from 'react';
import { reportError } from '../lib/crashReporting';
import { db } from '../config/firebase';
import { Transfer, Client } from '../types';
import { getClientMatchKey } from '../utils/helpers';
import { useTransfersQuery } from './queries/useTransfersQuery';
import { dataScopeFields } from '../utils/dataScope';

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
  const clientsRef = useRef<Client[]>(clients);
  clientsRef.current = clients;
  const busyRef = useRef<Set<string>>(new Set());

  // Índice: matchKey -> clientIds del mismo cliente humano
  const matchIndex = useMemo(() => {
    const map: Record<string, string[]> = {};
    clients.forEach((c) => {
      if (!c || c.isNote) return;
      const key = getClientMatchKey(c.name || '', c.phone || '', c.id);
      if (!map[key]) map[key] = [];
      map[key].push(c.id);
    });
    return map;
  }, [clients]);

  const getMatchingIds = useCallback(
    (clientId: string): string[] => {
      const client = clientsRef.current.find((c) => c.id === clientId);
      if (!client) return [clientId];
      const key = getClientMatchKey(client.name || '', client.phone || '', client.id);
      const ids = matchIndex[key];
      return ids && ids.length > 0 ? ids : [clientId];
    },
    [matchIndex],
  );

  // Agrega transferencias de todas las instancias duplicadas del mismo cliente humano
  const getClientTransfers = useCallback(
    (clientId: string): Transfer[] => {
      const ids = new Set(getMatchingIds(clientId));
      return transfersRef.current.filter((t) => ids.has(t.clientId));
    },
    [getMatchingIds],
  );

  const hasPendingTransfer = useCallback(
    (clientId: string): boolean => {
      const ids = new Set(getMatchingIds(clientId));
      return transfersRef.current.some((t) => ids.has(t.clientId));
    },
    [getMatchingIds],
  );

  const addTransfer = useCallback(
    async (client: Client) => {
      const key = `add-${client.id}`;
      if (busyRef.current.has(key)) return false;
      busyRef.current.add(key);
      try {
        // Usa el ref sincrónico para evitar carrera con el listener
        const matchingIds = new Set(getMatchingIds(client.id));
        const existing = transfersRef.current.find((t) => matchingIds.has(t.clientId));
        if (existing) return false;

        const scope = dataScopeFields(userId, groupId);
        await db.collection('transfers').add({
          ...scope,
          clientId: client.id,
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
    [groupId, userId, getMatchingIds],
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
