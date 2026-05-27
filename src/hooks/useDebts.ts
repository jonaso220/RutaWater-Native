import { useCallback, useRef, useMemo } from 'react';
import { db } from '../config/firebase';
import { Debt, Client } from '../types';
import { getClientMatchKey } from '../utils/helpers';
import { useDebtsQuery } from './queries/useDebtsQuery';

interface UseDebtsProps {
  userId: string;
  groupId?: string;
  clients?: Client[];
}

export const useDebts = ({ userId, groupId, clients = [] }: UseDebtsProps) => {
  // Data source: TanStack Query holds the live debts array, fed by a
  // perpetual Firestore listener. See useDebtsQuery for details.
  const debtsQuery = useDebtsQuery({ userId, groupId });
  const debts = useMemo<Debt[]>(() => debtsQuery.data ?? [], [debtsQuery.data]);
  // Ref sincrónico para evitar closures stale en operaciones rápidas
  const debtsRef = useRef<Debt[]>(debts);
  debtsRef.current = debts;
  // Ref con los clientes para que los callbacks no queden stale
  const clientsRef = useRef<Client[]>(clients);
  clientsRef.current = clients;
  // Guard contra doble-tap en operaciones de escritura
  const busyRef = useRef<Set<string>>(new Set());

  // Índice: matchKey -> lista de clientIds del mismo "cliente humano"
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

  // Dado un clientId, devuelve todos los clientIds que representan al mismo cliente humano
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

  // Devuelve solo los clientIds que existen actualmente en el directorio.
  // Evita que batch.update intente escribir sobre docs borrados y haga rollback.
  const getExistingMatchingIds = useCallback(
    (clientId: string): string[] => {
      const ids = getMatchingIds(clientId);
      const existing = new Set(clientsRef.current.map((c) => c.id));
      return ids.filter((id) => existing.has(id));
    },
    [getMatchingIds],
  );

  // Get debts for a specific client (agrega duplicados por nombre+teléfono)
  const getClientDebts = useCallback(
    (clientId: string): Debt[] => {
      const ids = new Set(getMatchingIds(clientId));
      return debtsRef.current.filter((d) => ids.has(d.clientId));
    },
    [getMatchingIds],
  );

  // Get total debt for a specific client (agrega duplicados)
  const getClientDebtTotal = useCallback(
    (clientId: string): number => {
      const ids = new Set(getMatchingIds(clientId));
      return debtsRef.current
        .filter((d) => ids.has(d.clientId))
        .reduce((sum, d) => sum + (d.amount || 0), 0);
    },
    [getMatchingIds],
  );

  // Add a new debt (guarded against double-tap)
  const addDebt = useCallback(
    async (client: Client, amount: number) => {
      if (!amount || amount <= 0) return;
      const key = `add-${client.id}`;
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);
      try {
        const scope = groupId ? { groupId, userId } : { userId };

        const batch = db.batch();
        const newDebtRef = db.collection('debts').doc();
        batch.set(newDebtRef, {
          ...scope,
          clientId: client.id,
          clientName: client.name,
          clientAddress: client.address || '',
          amount,
          createdAt: new Date(),
          paid: false,
        });
        // Marca hasDebt=true en todas las instancias duplicadas (filtrando docs inexistentes)
        const matchingIds = getExistingMatchingIds(client.id);
        matchingIds.forEach((id) => {
          batch.update(db.collection('clients').doc(id), { hasDebt: true });
        });
        await batch.commit();
      } catch (e) {
        console.error('Error adding debt:', e);
      } finally {
        busyRef.current.delete(key);
      }
    },
    [groupId, userId, getMatchingIds],
  );

  // Mark a debt as paid (guarded + uses ref to avoid stale closure)
  const markDebtPaid = useCallback(
    async (debt: Debt) => {
      const key = `paid-${debt.id}`;
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);
      try {
        const matchingIds = new Set(getMatchingIds(debt.clientId));
        const existingIds = getExistingMatchingIds(debt.clientId);
        const batch = db.batch();
        batch.delete(db.collection('debts').doc(debt.id));
        // Si no quedan deudas en NINGUNA instancia duplicada, apaga hasDebt en todas las que existan
        const remaining = debtsRef.current.filter(
          (d) => matchingIds.has(d.clientId) && d.id !== debt.id,
        );
        if (remaining.length === 0) {
          existingIds.forEach((id) => {
            batch.update(db.collection('clients').doc(id), { hasDebt: false });
          });
        }
        await batch.commit();
      } catch (e) {
        console.error('Error marking debt paid:', e);
      } finally {
        busyRef.current.delete(key);
      }
    },
    [getMatchingIds, getExistingMatchingIds],
  );

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
  const markAllDebtsPaid = useCallback(
    async (clientId: string, debtIds: string[]) => {
      const key = `allpaid-${clientId}`;
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);
      try {
        const matchingIds = getExistingMatchingIds(clientId);
        const batch = db.batch();
        debtIds.forEach((id) => batch.delete(db.collection('debts').doc(id)));
        matchingIds.forEach((id) => {
          batch.update(db.collection('clients').doc(id), { hasDebt: false });
        });
        await batch.commit();
      } catch (e) {
        console.error('Error marking all debts paid:', e);
      } finally {
        busyRef.current.delete(key);
      }
    },
    [getExistingMatchingIds],
  );

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
