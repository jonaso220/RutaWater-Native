import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../config/firebase';
import { Debt, Client } from '../types';

interface UseDebtsProps {
  userId: string;
  groupId?: string;
}

export const useDebts = ({ userId, groupId }: UseDebtsProps) => {
  const [debts, setDebts] = useState<Debt[]>([]);
  // Ref sincrónico para evitar closures stale en operaciones rápidas
  const debtsRef = useRef<Debt[]>(debts);
  debtsRef.current = debts;
  // Guard contra doble-tap en operaciones de escritura
  const busyRef = useRef<Set<string>>(new Set());

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
  const getClientDebts = useCallback((clientId: string): Debt[] => {
    return debtsRef.current.filter((d) => d.clientId === clientId);
  }, []);

  // Get total debt for a specific client
  const getClientDebtTotal = useCallback((clientId: string): number => {
    return debtsRef.current
      .filter((d) => d.clientId === clientId)
      .reduce((sum, d) => sum + (d.amount || 0), 0);
  }, []);

  // Add a new debt (guarded against double-tap)
  const addDebt = useCallback(async (client: Client, amount: number) => {
    if (!amount || amount <= 0) return;
    const key = `add-${client.id}`;
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
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
      await db.collection('clients').doc(client.id).update({ hasDebt: true });
    } catch (e) {
      console.error('Error adding debt:', e);
    } finally {
      busyRef.current.delete(key);
    }
  }, [groupId, userId]);

  // Mark a debt as paid (guarded + uses ref to avoid stale closure)
  const markDebtPaid = useCallback(async (debt: Debt) => {
    const key = `paid-${debt.id}`;
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    try {
      await db.collection('debts').doc(debt.id).delete();
      // Leer del ref sincrónico para tener datos actualizados
      const remaining = debtsRef.current.filter(
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
    } finally {
      busyRef.current.delete(key);
    }
  }, []);

  // Edit debt amount (guarded)
  const editDebt = useCallback(async (debtId: string, newAmount: number) => {
    if (!newAmount || newAmount <= 0) return;
    const key = `edit-${debtId}`;
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    try {
      await db.collection('debts').doc(debtId).update({ amount: newAmount });
    } catch (e) {
      console.error('Error editing debt:', e);
    } finally {
      busyRef.current.delete(key);
    }
  }, []);

  // Mark ALL debts for a client as paid (guarded, batch atómico)
  const markAllDebtsPaid = useCallback(async (clientId: string, debtIds: string[]) => {
    const key = `allpaid-${clientId}`;
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    try {
      const batch = db.batch();
      debtIds.forEach((id) => batch.delete(db.collection('debts').doc(id)));
      batch.update(db.collection('clients').doc(clientId), { hasDebt: false });
      await batch.commit();
    } catch (e) {
      console.error('Error marking all debts paid:', e);
    } finally {
      busyRef.current.delete(key);
    }
  }, []);

  return {
    debts,
    getClientDebts,
    getClientDebtTotal,
    addDebt,
    markDebtPaid,
    editDebt,
    markAllDebtsPaid,
  };
};
