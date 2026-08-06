import { useCallback, useRef, useMemo } from 'react';
import { reportError } from '../lib/crashReporting';
import { db } from '../config/firebase';
import { Debt, Client } from '../types';
import { shareInFlightOperation } from '../utils/inFlightOperation';
import { useDebtsQuery } from './queries/useDebtsQuery';
import { dataScopeFields } from '../utils/dataScope';
import {
  buildClientIdentityIndex,
  getRelatedClientReference,
  getRelatedRecordStableClientId,
  getStableClientId,
} from '../utils/clientIdentity';

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
  // Promesas compartidas contra doble-tap: todos los callers esperan el mismo
  // write real, en vez de que el segundo reciba `undefined` como falso éxito.
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());

  const identityIndex = useMemo(() => buildClientIdentityIndex(clients), [clients]);

  // Legacy debts keep only an exact client document id; current debts add the
  // stable customerId while retaining that exact id for old app versions.
  const getClientDebts = useCallback(
    (clientId: string): Debt[] => {
      const stableId = getRelatedRecordStableClientId(clientId, identityIndex);
      return debtsRef.current.filter(
        (debt) => getRelatedRecordStableClientId(debt, identityIndex) === stableId,
      );
    },
    [identityIndex],
  );

  // Pre-cómputo de totales por identidad estable explícita.
  // Antes getClientDebtTotal era O(C+D) por llamada (find sobre clients +
  // filter+reduce sobre todas las deudas) y se invoca una vez por cliente en
  // los bucles de HomeScreen (filtro con_deuda + debtMap) → O(N²) con 600+
  // clientes. Ahora se arma este índice una sola vez por cambio de
  // clients/debts (O(C+D)) y cada total es un lookup O(1).
  const debtTotals = useMemo(() => {
    const totalByStableId = new Map<string, number>();
    debts.forEach((debt) => {
      const stableId = getRelatedRecordStableClientId(debt, identityIndex);
      const amount = Number(debt.amount) || 0;
      totalByStableId.set(stableId, (totalByStableId.get(stableId) || 0) + amount);
    });
    return totalByStableId;
  }, [debts, identityIndex]);

  // O(1) lookup; no depende del nombre ni del teléfono editables.
  const getClientDebtTotal = useCallback(
    (clientId: string): number => {
      const stableId = getRelatedRecordStableClientId(clientId, identityIndex);
      return debtTotals.get(stableId) || 0;
    },
    [debtTotals, identityIndex],
  );

  // Add a new debt (guarded against double-tap)
  const addDebt = useCallback(
    (client: Client, amount: number): Promise<void> => {
      if (!amount || amount <= 0) return Promise.resolve();
      const stableClientId = getStableClientId(client);
      const key = `add-${stableClientId}`;
      return shareInFlightOperation(inFlightRef.current, key, async () => {
        try {
          const scope = dataScopeFields(userId, groupId);
          await db.collection('debts').add({
            ...scope,
            ...getRelatedClientReference(client),
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
      const stableClientId = getRelatedRecordStableClientId(clientId, identityIndex);
      const key = `allpaid-${stableClientId}`;
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
    [identityIndex],
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
