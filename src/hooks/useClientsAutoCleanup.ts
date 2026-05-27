import { useEffect, useRef } from 'react';
import { db } from '../config/firebase';
import { Client } from '../types';

/**
 * One-shot maintenance pass that runs the first time clients are loaded
 * after sign-in. Removes/converts entries that should no longer be
 * active in the directory:
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
 * Guarded by an internal ref so it never runs twice in a single session
 * (e.g. when Firestore pushes a snapshot update). Writes are batched by
 * 450 to stay under Firestore's 500-op limit.
 */
export const useClientsAutoCleanup = (clients: Client[]) => {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (clients.length === 0) return;
    done.current = true;

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
      noteBatch.commit().catch((err) => console.error('Note cleanup error:', err));
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
          batch.update(ref, {
            freq: 'on_demand',
            visitDay: 'Sin Asignar',
            visitDays: [],
            isCompleted: false,
            completedAt: null,
            updatedAt: new Date(),
          });
        }
      });
      batch.commit().catch((err) => console.error('Auto-cleanup error:', err));
    }
  }, [clients]);
};
