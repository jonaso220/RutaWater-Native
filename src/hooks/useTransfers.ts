import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { db } from '../config/firebase';
import { Transfer, Client } from '../types';
import { getClientMatchKey } from '../utils/helpers';

interface UseTransfersProps {
  userId: string;
  groupId?: string;
  clients?: Client[];
}

export const useTransfers = ({ userId, groupId, clients = [] }: UseTransfersProps) => {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
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

  // Solo IDs que existen en el directorio actual (evita rollback por docs borrados)
  const getExistingMatchingIds = useCallback(
    (clientId: string): string[] => {
      const ids = getMatchingIds(clientId);
      const existing = new Set(clientsRef.current.map((c) => c.id));
      return ids.filter((id) => existing.has(id));
    },
    [getMatchingIds],
  );

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
          setTransfers(loaded);
        },
        (error) => {
          console.error('Error loading transfers:', error);
        },
      );

    return () => unsubscribe();
  }, [userId, groupId]);

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

        const scope = groupId ? { groupId, userId } : { userId };
        const batch = db.batch();
        const newRef = db.collection('transfers').doc();
        batch.set(newRef, {
          ...scope,
          clientId: client.id,
          clientName: client.name,
          clientAddress: client.address || '',
          clientLat: client.lat || null,
          clientLng: client.lng || null,
          clientMapsLink: client.mapsLink || null,
          createdAt: new Date(),
          reviewed: false,
        });
        // Marca flag en todas las instancias duplicadas que existan
        const existingIds = getExistingMatchingIds(client.id);
        existingIds.forEach((id) => {
          batch.update(db.collection('clients').doc(id), { hasPendingTransfer: true });
        });
        await batch.commit();
        return true;
      } catch (e) {
        console.error('Error adding transfer:', e);
        return false;
      } finally {
        busyRef.current.delete(key);
      }
    },
    [groupId, userId, getMatchingIds, getExistingMatchingIds],
  );

  const markTransferReviewed = useCallback(
    async (transfer: Transfer) => {
      const key = `review-${transfer.id}`;
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);
      try {
        const matchingIds = new Set(getMatchingIds(transfer.clientId));
        const existingIds = getExistingMatchingIds(transfer.clientId);
        const batch = db.batch();
        batch.delete(db.collection('transfers').doc(transfer.id));
        const remaining = transfersRef.current.filter(
          (t) => matchingIds.has(t.clientId) && t.id !== transfer.id,
        );
        if (remaining.length === 0) {
          existingIds.forEach((id) => {
            batch.update(db.collection('clients').doc(id), { hasPendingTransfer: false });
          });
        }
        await batch.commit();
      } catch (e) {
        console.error('Error reviewing transfer:', e);
      } finally {
        busyRef.current.delete(key);
      }
    },
    [getMatchingIds, getExistingMatchingIds],
  );

  return {
    transfers,
    getClientTransfers,
    hasPendingTransfer,
    addTransfer,
    markTransferReviewed,
  };
};
