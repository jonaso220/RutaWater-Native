import { useCallback, useEffect, useRef, useState } from 'react';
import { Client } from '../types';
import { useClientsStore } from '../stores/clientsStore';

export interface UndoEntry {
  client: Client;
  previousData: Record<string, any>;
  timer: ReturnType<typeof setTimeout>;
  // The day-name the client was shown under when marked done. Used by the
  // banner to disambiguate when undoing a client from a different tab.
  sectionDay: string;
}

interface PushArgs {
  client: Client;
  previousData: Record<string, any>;
  sectionDay: string;
  ttl?: number;
}

/**
 * Manages the queue of recently-marked-done clients that the user can still
 * undo. Each entry carries its own timeout so multiple completions in quick
 * succession all remain undoable (an earlier single-slot version would
 * cancel the previous entry's timer, losing its undo).
 *
 * The hook also owns the cleanup of pending timers on unmount.
 */
export const useUndoQueue = () => {
  const undoComplete = useClientsStore((s) => s.undoComplete);
  const updateClient = useClientsStore((s) => s.updateClient);

  const [queue, setQueue] = useState<UndoEntry[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    return () => {
      queueRef.current.forEach((entry) => clearTimeout(entry.timer));
    };
  }, []);

  const push = useCallback(({ client, previousData, sectionDay, ttl = 5000 }: PushArgs) => {
    const clientId = client.id;
    const timer = setTimeout(() => {
      setQueue((prev) => prev.filter((e) => e.client.id !== clientId));
    }, ttl);
    const entry: UndoEntry = { client, previousData, sectionDay, timer };
    setQueue((prev) => {
      // Replace any prior entry for the same client (and cancel its timer)
      // — guards against accidental re-marks racing with the server echo.
      const existing = prev.find((e) => e.client.id === clientId);
      if (existing) clearTimeout(existing.timer);
      const filtered = prev.filter((e) => e.client.id !== clientId);
      return [...filtered, entry];
    });
  }, []);

  const undoMostRecent = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const entry = q[q.length - 1];
    clearTimeout(entry.timer);

    const { client, previousData } = entry;
    if (client.freq === 'once') {
      undoComplete(client.id);
    } else {
      updateClient(client.id, {
        lastVisited: previousData.lastVisited,
        doneFor: previousData.doneFor ?? '',
        specificDate: previousData.specificDate,
        alarm: previousData.alarm,
        isStarred: previousData.isStarred,
      } as any);
    }

    setQueue((prev) => prev.filter((e) => e.client.id !== client.id));
  }, [undoComplete, updateClient]);

  return { queue, push, undoMostRecent };
};
