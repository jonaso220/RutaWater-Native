import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Client } from '../types';
import { enqueueVisitCommand } from '../services/visitCompletion';
import { createUndoCommand, VisitCommand } from '../utils/visitCompletion';
import i18n from '../i18n';

export interface UndoEntry {
  client: Client;
  command: VisitCommand;
  timer: ReturnType<typeof setTimeout>;
  sectionDay: string;
}

interface PushArgs {
  client: Client;
  command: VisitCommand;
  sectionDay: string;
  ttl?: number;
}

/** Undo withdraws this member's exact confirmation, never a blind snapshot. */
export const useUndoQueue = () => {
  const [queue, setQueue] = useState<UndoEntry[]>([]);
  const queueRef = useRef(queue);
  const undoingRef = useRef(new Set<string>());
  queueRef.current = queue;

  useEffect(() => () => {
    queueRef.current.forEach((entry) => clearTimeout(entry.timer));
  }, []);

  const push = useCallback(({ client, command, sectionDay, ttl = 5000 }: PushArgs) => {
    const timer = setTimeout(() => {
      setQueue((prev) => prev.filter((entry) => entry.client.id !== client.id));
    }, ttl);
    setQueue((prev) => {
      const existing = prev.find((entry) => entry.client.id === client.id);
      if (existing) clearTimeout(existing.timer);
      const entry = { client: existing?.client || client,
        command: existing?.command || command, sectionDay, timer };
      return [...prev.filter((item) => item.client.id !== client.id), entry];
    });
  }, []);

  const undoMostRecent = useCallback(async () => {
    const entry = queueRef.current[queueRef.current.length - 1];
    if (!entry || undoingRef.current.has(entry.command.id)) return;
    undoingRef.current.add(entry.command.id);
    try {
      const ok = await enqueueVisitCommand(entry.client.id, createUndoCommand(entry.command));
      if (!ok) {
        Alert.alert(i18n.t('error'), i18n.t('editModal.saveError'));
        return;
      }
      clearTimeout(entry.timer);
      setQueue((prev) => prev.filter((item) => item.command.id !== entry.command.id));
    } finally {
      undoingRef.current.delete(entry.command.id);
    }
  }, []);

  return { queue, push, undoMostRecent };
};
