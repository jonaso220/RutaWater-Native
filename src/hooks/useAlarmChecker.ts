import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, Vibration } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import auth from '@react-native-firebase/auth';
import { useClientsStore } from '../stores/clientsStore';
import { useProfileStore } from '../stores/profileStore';
import {
  cancelAlarmsThenMutate,
  cancelClientAlarm,
  cancelForeignScheduledAlarms,
  cancelScheduledAlarmsForOwner,
  ClientAlarmSnapshot,
  getAlarmPermissionIssue,
  getScheduledClientAlarms,
  runSerializedAlarmMutation,
  scheduleClientAlarm,
} from '../services/notifications';
import { hapticWarning } from '../utils/haptics';
import {
  getAlarmReconciliationAction,
  getAlarmReconciliationSignature,
  isAlarmScopeReady,
  shouldPresentDeliveredAlarm,
} from '../utils/alarmReconciliation';
import { alarmScheduleFields } from '../utils/helpers';

export interface AlarmData {
  clientId: string;
  name: string;
  address: string;
  time: string;
}

/**
 * Listens for delivered local notifications from notifee while the app is
 * foregrounded. iOS suppresses the system banner in this case, so we render
 * our own in-app banner and vibrate.
 */
export const useAlarmChecker = () => {
  const profilesLoaded = useProfileStore((s) => s.loaded);
  const activeProfileScope = useProfileStore((s) => s.activeProfile?.scopeGroupId);
  const [activeAlarm, setActiveAlarm] = useState<AlarmData | null>(null);

  useEffect(() => {
    let previousUserId = auth().currentUser?.uid;
    return auth().onAuthStateChanged((user) => {
      const nextUserId = user?.uid;
      if (previousUserId && previousUserId !== nextUserId) {
        setActiveAlarm(null);
        Vibration.cancel();
        void cancelScheduledAlarmsForOwner(previousUserId, true).catch(() => {});
      }
      previousUserId = nextUserId;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
      if (type !== EventType.DELIVERED) return;
      const data = detail.notification?.data as
        | {
          clientId?: string;
          alarmTime?: string;
          clientName?: string;
          clientAddress?: string;
          alarmOwnerUid?: string;
          alarmScopeKey?: string;
        }
        | undefined;
      if (!data?.clientId) return;
      const clientState = useClientsStore.getState();
      if (!shouldPresentDeliveredAlarm(
        {
          clientId: data.clientId,
          ownerUid: data.alarmOwnerUid,
          scopeKey: data.alarmScopeKey,
        },
        auth().currentUser?.uid,
        clientState.scopeKey,
        new Set(clientState.clients.map((client) => client.id)),
      )) return;
      setActiveAlarm({
        clientId: data.clientId,
        name: data.clientName || detail.notification?.title || 'Cliente',
        address: data.clientAddress || '',
        time: data.alarmTime || '',
      });
      hapticWarning();
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    });
    return unsubscribe;
  }, []);

  // Reconciliación de alarmas "fantasma": el trigger de notifee es one-shot y
  // vive solo en el dispositivo que lo programó. Si un cliente tiene el campo
  // `alarm` seteado pero acá no hay trigger pendiente (ya sonó con la app
  // cerrada, o lo programó otro dispositivo del reparto), la campana quedaba
  // encendida para siempre sin que nada fuera a sonar. Al abrir/volver a la
  // app: re-armamos el trigger para la próxima ocurrencia del día del cliente
  // (la alarma pasa a repetirse por ciclo y suena en cada dispositivo), y para
  // pedidos 'once' con fecha ya pasada apagamos el campo.
  const reconciling = useRef(false);
  const reconcilePending = useRef(false);
  const reconcileAlarms = useCallback(async () => {
    if (reconciling.current) {
      reconcilePending.current = true;
      return;
    }
    reconciling.current = true;
    try {
      do {
        reconcilePending.current = false;
        await (async () => {
      const { clients, loading, scopeKey, updateClient } = useClientsStore.getState();
      const profileState = useProfileStore.getState();
      const currentUserId = auth().currentUser?.uid;
      const activeScopeKey = profileState.activeProfile?.scopeGroupId || currentUserId;
      if (
        !profileState.loaded
        || !currentUserId
        || !activeScopeKey
        || !isAlarmScopeReady(loading, scopeKey, activeScopeKey)
      ) return;
      await cancelForeignScheduledAlarms(
        currentUserId,
        new Set(clients.map((client) => client.id)),
      ).catch(() => {});
      const scheduled = await getScheduledClientAlarms();
      const canonicalClients = clients;
      const canonicalIds = new Set(canonicalClients.map((client) => client.id));
      let canScheduleOnDevice: boolean | null = null;

      for (const c of canonicalClients) {
        const localAlarm = scheduled.get(c.id);
        const action = getAlarmReconciliationAction(c, localAlarm, currentUserId);
        if (action === 'keep') continue;

        if (action === 'schedule') {
          if (canScheduleOnDevice === null) {
            canScheduleOnDevice = await getAlarmPermissionIssue()
              .then((issue) => issue === null)
              .catch(() => false);
          }
          // Permission checks are device-local. Missing access or a native
          // settings error must not mutate the shared Firestore alarm.
          if (!canScheduleOnDevice) continue;

          await runSerializedAlarmMutation(c.id, async () => {
            // The candidate was computed before waiting for the keyed queue.
            // Re-read both shared and native state so an intervening save/remove
            // cannot be overwritten by stale reconciliation data.
            const latest = useClientsStore.getState().clients.find((client) => client.id === c.id);
            if (!latest?.alarm) return;
            const latestScheduled = await getScheduledClientAlarms();
            if (getAlarmReconciliationAction(
              latest,
              latestScheduled.get(latest.id),
              currentUserId,
            ) !== 'schedule') {
              return;
            }
            const targetDay = latest.alarmDay
              || (latest.visitDays && latest.visitDays.length > 0 ? latest.visitDays[0] : undefined)
              || latest.visitDay;
            await scheduleClientAlarm(
              latest.id,
              latest.name || '',
              latest.address || '',
              latest.alarm,
              {
                ...alarmScheduleFields(latest, targetDay),
                scopeKey: latest.groupId || latest.userId || activeScopeKey,
                ownerUid: currentUserId,
                permissionAlreadyChecked: true,
              },
            );
          });
          // A valid shared alarm remains in Firestore even if this device could
          // not schedule it (missing exact-alarm access, denied notifications,
          // or a transient native failure). It can be retried on foreground.
          continue;
        }

        if (action === 'cancel') {
          try {
            await runSerializedAlarmMutation(c.id, async () => {
              const latest = useClientsStore.getState().clients.find((client) => client.id === c.id);
              if (!latest) return;
              const latestScheduled = await getScheduledClientAlarms();
              if (getAlarmReconciliationAction(
                latest,
                latestScheduled.get(c.id),
                currentUserId,
              ) === 'cancel') {
                await cancelClientAlarm(c.id);
              }
            });
          } catch {
            // Native state remains retryable on the next foreground pass.
          }
          continue;
        }

        // Only intrinsically invalid/expired alarm data is cleared. Device
        // permission or scheduling failures never reach this branch.
        try {
          await cancelAlarmsThenMutate(
            () => {
              const latest = useClientsStore.getState().clients.find((client) => client.id === c.id);
              if (!latest?.alarm || getAlarmReconciliationAction(latest, false) !== 'clear') {
                return [];
              }
              const previousAlarm: ClientAlarmSnapshot = {
                clientId: latest.id,
                clientName: latest.name || '',
                address: latest.address || '',
                time: latest.alarm,
                ...alarmScheduleFields(latest, latest.alarmDay
                  || (latest.visitDays && latest.visitDays.length > 0
                    ? latest.visitDays[0]
                    : undefined) || latest.visitDay),
              };
              previousAlarm.scopeKey = latest.groupId || latest.userId || activeScopeKey;
              previousAlarm.ownerUid = currentUserId;
              return [previousAlarm];
            },
            async (snapshots) => {
              // Empty means a newer valid alarm won while this reconciliation
              // was queued; leave both Firestore and its trigger untouched.
              if (snapshots.length === 0) return;
              const updated = await updateClient(c.id, { alarm: '', alarmDay: '' } as any);
              if (!updated) throw new Error('ALARM_CLEAR_PERSIST_FAILED');
            },
            [c.id],
          );
        } catch {
          // Keep Firestore/UI unchanged while the local trigger may still
          // exist. A later foreground reconciliation can retry cancellation.
          continue;
        }
      }

      // A remote deletion no longer appears in the active query. Only clean up
      // orphan triggers carrying this exact scope; legacy unscoped triggers are
      // intentionally left alone because they may belong to another profile.
      for (const [clientId, localAlarm] of scheduled) {
        if (localAlarm.scopeKey !== activeScopeKey || canonicalIds.has(clientId)) continue;
        try {
          await runSerializedAlarmMutation(clientId, async () => {
            if (useClientsStore.getState().clients.some((client) => client.id === clientId)) return;
            const latestScheduled = (await getScheduledClientAlarms()).get(clientId);
            if (latestScheduled?.scopeKey === activeScopeKey) {
              await cancelClientAlarm(clientId);
            }
          });
        } catch {
          // Retry after the next foreground event.
        }
      }
        })();
      } while (reconcilePending.current);
    } finally {
      reconciling.current = false;
    }
  }, []);

  useEffect(() => {
    // Al montar (arranque con datos ya cargados o apenas lleguen) y en cada
    // cambio remoto relevante mientras sigue en foreground.
    let lastSignature: string | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const readyForActiveScope = (state: ReturnType<typeof useClientsStore.getState>) => {
      const activeScopeKey = activeProfileScope || auth().currentUser?.uid;
      return !!activeScopeKey
        && profilesLoaded
        && isAlarmScopeReady(state.loading, state.scopeKey, activeScopeKey);
    };
    const requestReconciliation = (
      state: ReturnType<typeof useClientsStore.getState>,
      immediate = false,
    ) => {
      const activeScopeKey = activeProfileScope || auth().currentUser?.uid;
      if (!activeScopeKey || !readyForActiveScope(state)) return;
      const signature = getAlarmReconciliationSignature(state.clients, activeScopeKey);
      if (!immediate && signature === lastSignature) return;
      lastSignature = signature;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (immediate) {
        debounceTimer = null;
        void reconcileAlarms();
      } else {
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void reconcileAlarms();
        }, 120);
      }
    };
    const unsubStore = useClientsStore.subscribe((s) => {
      requestReconciliation(s);
    });
    requestReconciliation(useClientsStore.getState(), true);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestReconciliation(useClientsStore.getState(), true);
    });
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubStore();
      appStateSub.remove();
    };
  }, [activeProfileScope, profilesLoaded, reconcileAlarms]);

  const dismissAlarm = useCallback(() => {
    // "Entendido" only dismisses the delivered foreground banner. The
    // canonical recurring alarm remains active and reconciliation rearms it.
    Vibration.cancel();
    setActiveAlarm(null);
  }, []);

  return { activeAlarm, dismissAlarm };
};
