import { useEffect, useRef } from 'react';
import { reportError } from '../lib/crashReporting';
import { db } from '../config/firebase';
import { Client } from '../types';
import { getDirectoryDeliveryHistoryUpdate } from '../utils/recency';

/**
 * One-shot maintenance pass that runs the first time a scope's clients are
 * loaded. Removes/converts entries that should no longer be active in the
 * directory:
 *
 *   1. Notes (`isNote=true`) that are either completed or whose
 *      specificDate is in the past — kept only while they describe
 *      today's work.
 *
 *   2. Completed one-shot clients (`freq === 'once'`, `isCompleted`,
 *      `specificDate` in the past) — flipped back to `on_demand` with
 *      `visitDay: 'Sin Asignar'`, so the client survives in the
 *      directory but no longer occupies a day slot.
 *
 * Runs once per scope (reparto/grupo) per session, and only after the active
 * profile is actually known (`ready`): at boot the cached clients snapshot
 * usually beats the users/{uid} doc, and a session-wide guard used to burn
 * the single pass on Reparto 1's data even when another reparto was active —
 * the active reparto then never got cleaned. Writes are batched by 450 to
 * stay under Firestore's 500-op limit.
 */
export const useClientsAutoCleanup = (clients: Client[], scopeKey: string, ready: boolean) => {
  const doneScopes = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!ready || !scopeKey) return;
    if (doneScopes.current.has(scopeKey)) return;
    if (clients.length === 0) return;
    doneScopes.current.add(scopeKey);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const staleNotes = clients.filter((c) => {
      if (!c.isNote) return false;
      if (c.isCompleted) return true;
      if (c.specificDate && new Date(c.specificDate + 'T23:59:59') < today) return true;
      return false;
    });
    if (staleNotes.length > 0) {
      const noteBatch = db.batch();
      staleNotes.forEach((c) => noteBatch.delete(db.collection('clients').doc(c.id)));
      noteBatch.commit().catch((err) => reportError(err, 'Note cleanup error'));
    }

    const expiredCompleted = clients.filter((c) =>
      c.isCompleted &&
      c.freq === 'once' &&
      c.specificDate &&
      new Date(c.specificDate + 'T12:00:00') < today,
    );
    if (expiredCompleted.length === 0) return;

    const batchSize = 450;
    for (let i = 0; i < expiredCompleted.length; i += batchSize) {
      const chunk = expiredCompleted.slice(i, i + batchSize);
      const batch = db.batch();
      chunk.forEach((c) => {
        const ref = db.collection('clients').doc(c.id);
        if (c.isNote) {
          batch.delete(ref);
        } else {
          const historyUpdate = getDirectoryDeliveryHistoryUpdate(c);
          batch.update(ref, {
            freq: 'on_demand',
            visitDay: 'Sin Asignar',
            visitDays: [],
            isCompleted: false,
            completedAt: null,
            previousDeliveredAt: null,
            ...historyUpdate,
            updatedAt: new Date(),
          });
        }
      });
      batch.commit().catch((err) => reportError(err, 'Auto-cleanup error'));
    }
  }, [clients, scopeKey, ready]);
};
