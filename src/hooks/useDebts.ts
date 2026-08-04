import { useCallback, useRef, useMemo } from 'react';
import { reportError } from '../lib/crashReporting';
import { db } from '../config/firebase';
import { Debt, Client } from '../types';
import { getClientMatchKey } from '../utils/helpers';
import { shareInFlightOperation } from '../utils/inFlightOperation';
import { useDebtsQuery } from './queries/useDebtsQuery';
import { dataScopeFields } from '../utils/dataScope';

interface UseDebtsProps {
  userId: string;
  groupId?: string;
  clients?: Client[];
  scopeReadVersion?: number;
}

export const useDebts = ({
  userId,
  groupId,
  clients = [],
  scopeReadVersion = 0,
}: UseDebtsProps) => {
  // Data source: TanStack Query holds the live debts array, fed by a
  // perpetual Firestore listener. See useDebtsQuery for details.
  const debtsQuery = useDebtsQuery({ userId, groupId, scopeReadVersion });
  const debts = useMemo<Debt[]>(
    () => debtsQuery.snapshotReady ? (debtsQuery.data ?? []) : [],
    [debtsQuery.data, debtsQuery.snapshotReady],
  );
  // Ref sincrónico para evitar closures stale en operaciones rápidas
  const debtsRef = useRef<Debt[]>(debts);
  debtsRef.current = debts;
  // Ref con los clientes para que los callbacks no queden stale
  const clientsRef = useRef<Client[]>(clients);
  clientsRef.current = clients;
  // Promesas compartidas contra doble-tap: todos los callers esperan el mismo
  // write real, en vez de que el segundo reciba `undefined` como falso éxito.
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());

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

  // Get debts for a specific client (agrega duplicados por nombre+teléfono)
  const getClientDebts = useCallback(
    (clientId: string): Debt[] => {
      const ids = new Set(getMatchingIds(clientId));
      return debtsRef.current.filter((d) => ids.has(d.clientId));
    },
    [getMatchingIds],
  );

  // Pre-cómputo de totales de deuda agregados por "cliente humano" (matchKey).
  // Antes getClientDebtTotal era O(C+D) por llamada (find sobre clients +
  // filter+reduce sobre todas las deudas) y se invoca una vez por cliente en
  // los bucles de HomeScreen (filtro con_deuda + debtMap) → O(N²) con 600+
  // clientes. Ahora se arma este índice una sola vez por cambio de
  // clients/debts (O(C+D)) y cada total es un lookup O(1).
  const debtTotals = useMemo(() => {
    // clientId -> matchKey (misma lógica y exclusiones que matchIndex)
    const keyByClientId: Record<string, string> = {};
    clients.forEach((c) => {
      if (!c || c.isNote) return;
      keyByClientId[c.id] = getClientMatchKey(c.name || '', c.phone || '', c.id);
    });
    // Suma por matchKey (clientes del directorio) y por clientId crudo
    // (fallback para clientes huérfanos fuera del directorio).
    const totalByKey: Record<string, number> = {};
    const totalByClientId: Record<string, number> = {};
    debts.forEach((d) => {
      const amt = Number(d.amount) || 0;
      totalByClientId[d.clientId] = (totalByClientId[d.clientId] || 0) + amt;
      const key = keyByClientId[d.clientId];
      if (key !== undefined) totalByKey[key] = (totalByKey[key] || 0) + amt;
    });
    return { keyByClientId, totalByKey, totalByClientId };
  }, [clients, debts]);

  // Get total debt for a specific client (agrega duplicados). O(1) vía índice.
  const getClientDebtTotal = useCallback(
    (clientId: string): number => {
      const key = debtTotals.keyByClientId[clientId];
      // Cliente en el directorio: total agregado de todas sus instancias.
      if (key !== undefined) return debtTotals.totalByKey[key] || 0;
      // Huérfano (no está en el directorio): equivale al viejo
      // getMatchingIds → [clientId], suma solo sus propias deudas.
      return debtTotals.totalByClientId[clientId] || 0;
    },
    [debtTotals],
  );

  // Add a new debt (guarded against double-tap)
  const addDebt = useCallback(
    (client: Client, amount: number): Promise<void> => {
      if (!amount || amount <= 0) return Promise.resolve();
      const key = `add-${client.id}`;
      return shareInFlightOperation(inFlightRef.current, key, async () => {
        try {
          const scope = dataScopeFields(userId, groupId);
          await db.collection('debts').add({
            ...scope,
            clientId: client.id,
            clientName: client.name,
            clientAddress: client.address || '',
            amount,
            createdAt: new Date(),
          });
        } catch (e) {
          reportError(e, 'Error adding debt');
          throw e;
        }
      });
    },
    [groupId, userId],
  );

  // Mark a debt as paid: pagar BORRA el documento; el estado "tiene deuda"
  // se deriva siempre en vivo de la colección (getClientDebtTotal), no de
  // ningún flag persistido.
  const markDebtPaid = useCallback(
    (debt: Debt): Promise<void> => {
      const key = `paid-${debt.id}`;
      return shareInFlightOperation(inFlightRef.current, key, async () => {
        try {
          await db.collection('debts').doc(debt.id).delete();
        } catch (e) {
          reportError(e, 'Error marking debt paid');
          throw e;
        }
      });
    },
    [],
  );

  // Edit debt amount (guarded)
  const editDebt = useCallback((debtId: string, newAmount: number): Promise<void> => {
    if (!newAmount || newAmount <= 0) return Promise.resolve();
    const key = `edit-${debtId}`;
    return shareInFlightOperation(inFlightRef.current, key, async () => {
      try {
        await db.collection('debts').doc(debtId).update({ amount: newAmount });
      } catch (e) {
        reportError(e, 'Error editing debt');
        throw e;
      }
    });
  }, []);

  // Mark ALL debts for a client as paid (guarded, batch atómico)
  const markAllDebtsPaid = useCallback(
    (clientId: string, debtIds: string[]): Promise<void> => {
      const key = `allpaid-${clientId}`;
      return shareInFlightOperation(inFlightRef.current, key, async () => {
        try {
          const batch = db.batch();
          debtIds.forEach((id) => batch.delete(db.collection('debts').doc(id)));
          await batch.commit();
        } catch (e) {
          reportError(e, 'Error marking all debts paid');
          throw e;
        }
      });
    },
    [],
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
