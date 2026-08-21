import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import auth from '@react-native-firebase/auth';
import { Client } from '../types';
import { useClientsStore } from '../stores/clientsStore';
import {
  cancelClientAlarm,
  persistAlarmOrRollbackTrigger,
  runSerializedAlarmMutation,
  scheduleClientAlarm,
} from '../services/notifications';
import { alarmScheduleFields } from '../utils/helpers';
import i18n from '../i18n';

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
  const updateClient = useClientsStore((s) => s.updateClient);

  const [queue, setQueue] = useState<UndoEntry[]>([]);
  const queueRef = useRef(queue);
  const undoingRef = useRef(false);
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
      // IMPORTANTE: se conserva el previousData ORIGINAL. Un segundo "Listo"
      // rápido llega con el snapshot ya completado (lastVisited/doneFor
      // nuevos); si lo tomáramos como "estado previo", deshacer no
      // desharía nada.
      const existing = prev.find((e) => e.client.id === clientId);
      if (existing) clearTimeout(existing.timer);
      const merged: UndoEntry = existing
        ? { ...entry, client: existing.client, previousData: existing.previousData }
        : entry;
      const filtered = prev.filter((e) => e.client.id !== clientId);
      return [...filtered, merged];
    });
  }, []);

  const undoMostRecent = useCallback(async () => {
    if (undoingRef.current) return;
    const q = queueRef.current;
    if (q.length === 0) return;
    const entry = q[q.length - 1];
    const { client, previousData } = entry;
    const previousAlarm = previousData.alarm || '';
    const restoreData: Record<string, any> = client.freq === 'once'
      ? {
      // No alcanza con undoComplete: markAsDone también borró alarm/isStarred
      // y hay que devolverlos, igual que en la rama periódica.
        isCompleted: previousData.isCompleted ?? false,
        completedAt: previousData.completedAt ?? null,
        lastDeliveredAt: previousData.lastDeliveredAt ?? null,
        previousDeliveredAt: previousData.previousDeliveredAt ?? null,
        // El campo se activa recién después de crear el trigger local.
        alarm: '',
        alarmDay: '',
        isStarred: previousData.isStarred ?? false,
        updatedAt: new Date(),
      }
      : {
        lastVisited: previousData.lastVisited,
        lastDeliveredAt: previousData.lastDeliveredAt ?? null,
        doneFor: previousData.doneFor ?? '',
        specificDate: previousData.specificDate,
        alarm: '',
        alarmDay: '',
        isStarred: previousData.isStarred,
      };

    undoingRef.current = true;
    try {
      const restored = await runSerializedAlarmMutation(client.id, async () => {
        const coreRestored = await updateClient(client.id, restoreData as any);
        if (!coreRestored) return false;

        // Serialize trigger creation before exposing the restored bell. If the
        // second write fails, remove the just-created trigger as compensation.
        if (previousAlarm) {
          const fireAt = await scheduleClientAlarm(
            client.id,
            client.name || '',
            client.address || '',
            previousAlarm,
            {
              ...alarmScheduleFields(
                { ...client, ...restoreData } as Client,
                previousData.alarmDay || entry.sectionDay,
              ),
              scopeKey: client.groupId || client.userId,
              ownerUid: auth().currentUser?.uid,
            },
          );
          if (fireAt) {
            try {
              await persistAlarmOrRollbackTrigger(
                async () => {
                  const alarmPersisted = await updateClient(client.id, {
                    alarm: previousAlarm,
                    alarmDay: previousData.alarmDay || entry.sectionDay,
                  } as any);
                  if (!alarmPersisted) throw new Error('UNDO_ALARM_PERSIST_FAILED');
                },
                () => cancelClientAlarm(client.id),
              );
            } catch {
              Alert.alert(i18n.t('error'), i18n.t('home.alarmFailed'));
            }
          } else {
            Alert.alert(i18n.t('error'), i18n.t('home.alarmFailed'));
          }
        }
        return true;
      });
      if (!restored) {
        Alert.alert(i18n.t('error'), i18n.t('editModal.saveError'));
        return;
      }

      clearTimeout(entry.timer);
      setQueue((prev) => prev.filter((e) => e.client.id !== client.id));
    } finally {
      undoingRef.current = false;
    }
  }, [updateClient]);

  return { queue, push, undoMostRecent };
};
