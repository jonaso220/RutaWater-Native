import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { Debt, Client } from '../types';

interface UseDebtsProps {
  userId: string;
  groupId?: string;
}

export const useDebts = ({ userId, groupId }: UseDebtsProps) => {
  const [debts, setDebts] = useState<Debt[]>([]);

  // Real-time listener on debts collection
  useEffect(() => {
    if (!userId) return;

    const scopeField = groupId ? 'groupId' : 'userId';
    const scopeValue = groupId || userId;

    const unsubscribe = db
      .collection('debts')
      .where(scopeField, '==', scopeValue)
      .onSnapshot(
        (snapshot) => {
          const loaded: Debt[] = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Debt[];
          loaded.sort((a, b) => {
            const dateA = (a.createdAt as any)?.seconds || 0;
            const dateB = (b.createdAt as any)?.seconds || 0;
            return dateB - dateA;
          });
          setDebts(loaded);
        },
        (error) => {
          console.error('Error loading debts:', error);
        },
      );

    return () => unsubscribe();
  }, [userId, groupId]);

  // Get debts for a specific client
  const getClientDebts = (clientId: string): Debt[] => {
    return debts.filter((d) => d.clientId === clientId);
  };

  // Get total debt for a specific client
  const getClientDebtTotal = (clientId: string): number => {
    return getClientDebts(clientId).reduce((sum, d) => sum + (d.amount || 0), 0);
  };

  // Add a new debt
  const addDebt = async (client: Client, amount: number) => {
    if (!amount || amount <= 0) return;
    try {
      const scope = groupId
        ? { groupId, userId }
        : { userId };

      await db.collection('debts').add({
        ...scope,
        clientId: client.id,
        clientName: client.name,
        clientAddress: client.address || '',
        amount,
        createdAt: new Date(),
        paid: false,
      });
      // Mark client as having debt
      await db.collection('clients').doc(client.id).update({ hasDebt: true });
    } catch (e) {
      console.error('Error adding debt:', e);
    }
  };

  // Mark a debt as paid (delete it)
  const markDebtPaid = async (debt: Debt) => {
    try {
      await db.collection('debts').doc(debt.id).delete();
      // Check if any remaining debts for this client
      const remaining = debts.filter(
        (d) => d.clientId === debt.clientId && d.id !== debt.id,
      );
      if (remaining.length === 0) {
        await db
          .collection('clients')
          .doc(debt.clientId)
          .update({ hasDebt: false });
      }
    } catch (e) {
      console.error('Error marking debt paid:', e);
    }
  };

  // Edit debt amount
  const editDebt = async (debtId: string, newAmount: number) => {
    if (!newAmount || newAmount <= 0) return;
    try {
      await db.collection('debts').doc(debtId).update({ amount: newAmount });
    } catch (e) {
      console.error('Error editing debt:', e);
    }
  };

  return {
    debts,
    getClientDebts,
    getClientDebtTotal,
    addDebt,
    markDebtPaid,
    editDebt,
  };
};
