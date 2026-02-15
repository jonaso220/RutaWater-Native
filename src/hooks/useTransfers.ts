import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { Transfer, Client } from '../types';

interface UseTransfersProps {
  userId: string;
  groupId?: string;
}

export const useTransfers = ({ userId, groupId }: UseTransfersProps) => {
  const [transfers, setTransfers] = useState<Transfer[]>([]);

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

  const getClientTransfers = (clientId: string): Transfer[] => {
    return transfers.filter((t) => t.clientId === clientId);
  };

  const hasPendingTransfer = (clientId: string): boolean => {
    return transfers.some((t) => t.clientId === clientId);
  };

  const addTransfer = async (client: Client) => {
    const existing = transfers.find((t) => t.clientId === client.id);
    if (existing) return false; // Ya tiene transferencia pendiente

    try {
      const scope = groupId ? { groupId, userId } : { userId };
      await db.collection('transfers').add({
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
      await db
        .collection('clients')
        .doc(client.id)
        .update({ hasPendingTransfer: true });
      return true;
    } catch (e) {
      console.error('Error adding transfer:', e);
      return false;
    }
  };

  const markTransferReviewed = async (transfer: Transfer) => {
    try {
      await db.collection('transfers').doc(transfer.id).delete();
      const remaining = transfers.filter(
        (t) => t.clientId === transfer.clientId && t.id !== transfer.id,
      );
      if (remaining.length === 0) {
        await db
          .collection('clients')
          .doc(transfer.clientId)
          .update({ hasPendingTransfer: false });
      }
    } catch (e) {
      console.error('Error reviewing transfer:', e);
    }
  };

  return {
    transfers,
    getClientTransfers,
    hasPendingTransfer,
    addTransfer,
    markTransferReviewed,
  };
};
