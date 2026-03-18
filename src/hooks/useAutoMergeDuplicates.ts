import { useEffect, useRef } from 'react';
import { db } from '../config/firebase';
import { useAuthContext } from '../context/AuthContext';
import { useClientsStore } from '../stores/clientsStore';
import { useDebtsStore } from '../stores/debtsStore';
import { useTransfersStore } from '../stores/transfersStore';

/**
 * Auto-merge duplicate on_demand clients with the same phone number.
 * Keeps the newest, reassigns debts/transfers, deletes duplicates.
 * Runs once when clients load.
 */
export const useAutoMergeDuplicates = () => {
  const { user } = useAuthContext();
  const clients = useClientsStore((s) => s.clients);
  const debts = useDebtsStore((s) => s.debts);
  const transfers = useTransfersStore((s) => s.transfers);
  const mergingRef = useRef(false);

  useEffect(() => {
    if (mergingRef.current || !user || clients.length === 0) return;

    // Group on_demand clients by normalized phone
    const phoneGroups: Record<string, typeof clients> = {};
    clients.forEach((c) => {
      if (!c.phone || c.phone.length < 6) return;
      const key = c.phone.replace(/\D/g, '');
      if (!phoneGroups[key]) phoneGroups[key] = [];
      phoneGroups[key].push(c);
    });

    // Find groups with duplicates where ALL entries are on_demand
    const toMerge = Object.values(phoneGroups).filter((group) => {
      if (group.length < 2) return false;
      return group.every((c) => c.freq === 'on_demand');
    });

    if (toMerge.length === 0) return;

    mergingRef.current = true;

    (async () => {
      try {
        for (const group of toMerge) {
          // Sort by updatedAt descending - keep the newest
          group.sort((a, b) => {
            const ta = (a.updatedAt as any)?.seconds || 0;
            const tb = (b.updatedAt as any)?.seconds || 0;
            return tb - ta;
          });
          const keeper = group[0];
          const duplicates = group.slice(1);

          for (const dup of duplicates) {
            const dupDebts = debts.filter((d) => d.clientId === dup.id);
            const dupTransfers = transfers.filter((t) => t.clientId === dup.id);

            const batch = db.batch();

            // Reassign debts from duplicate to keeper
            for (const d of dupDebts) {
              batch.update(db.collection('debts').doc(d.id), {
                clientId: keeper.id,
                clientName: keeper.name,
                clientAddress: keeper.address || '',
              });
            }

            // Reassign transfers from duplicate to keeper
            for (const t of dupTransfers) {
              batch.update(db.collection('transfers').doc(t.id), {
                clientId: keeper.id,
                clientName: keeper.name,
              });
            }

            // Update keeper's hasDebt if duplicate had debts
            if (dupDebts.length > 0) {
              batch.update(db.collection('clients').doc(keeper.id), { hasDebt: true });
            }

            // Delete the duplicate client
            batch.delete(db.collection('clients').doc(dup.id));

            await batch.commit();
          }
        }
        console.log('Auto-merge: duplicados fusionados correctamente');
      } catch (e) {
        console.error('Error al fusionar duplicados:', e);
      } finally {
        mergingRef.current = false;
      }
    })();
  }, [clients, debts, transfers, user]);
};
