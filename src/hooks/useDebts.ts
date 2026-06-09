import { useCallback, useRef, useMemo } from 'react';
import { reportError } from '../lib/crashReporting';
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
      const amt = d.amount || 0;
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
        reportError(e, 'Error adding debt');
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
        // Instancias del mismo cliente humano. Si la deuda quedó huérfana (su
        // clientId ya no está en el directorio), caer a las instancias vivas
        // con el mismo nombre — igual que el agrupado de DebtsSheet — para que
        // hasDebt no quede prendido para siempre en ellas.
        let candidateIds = getMatchingIds(debt.clientId);
        let existingIds = getExistingMatchingIds(debt.clientId);
        if (existingIds.length === 0 && debt.clientName) {
          const norm = (s: string) => (s || '').toLowerCase().trim();
          existingIds = clientsRef.current
            .filter((c) => !c.isNote && norm(c.name || '') === norm(debt.clientName))
            .map((c) => c.id);
          candidateIds = [...new Set([...candidateIds, ...existingIds])];
        }

        await db.collection('debts').doc(debt.id).delete();

        // Releer desde Firestore: la copia local puede no reflejar todavía un
        // pago anterior (dos pagos seguidos del mismo cliente) y dejaría
        // hasDebt prendido para siempre. La query lleva el campo de scope
        // para que las reglas puedan autorizarla.
        if (existingIds.length > 0) {
          const scopeField = groupId ? 'groupId' : 'userId';
          const scopeValue = groupId || userId;
          let remaining = 0;
          for (let i = 0; i < candidateIds.length && remaining === 0; i += 10) {
            const chunk = candidateIds.slice(i, i + 10);
            const snap = await db
              .collection('debts')
              .where(scopeField, '==', scopeValue)
              .where('clientId', 'in', chunk)
              .get();
            remaining += snap.size;
          }
          if (remaining === 0) {
            const batch = db.batch();
            existingIds.forEach((id) => {
              batch.update(db.collection('clients').doc(id), { hasDebt: false });
            });
            await batch.commit();
          }
        }
      } catch (e) {
        reportError(e, 'Error marking debt paid');
      } finally {
        busyRef.current.delete(key);
      }
    },
    [getMatchingIds, getExistingMatchingIds, groupId, userId],
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
      reportError(e, 'Error editing debt');
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
        reportError(e, 'Error marking all debts paid');
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
