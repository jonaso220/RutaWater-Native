import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, Vibration } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { useClientsStore } from '../stores/clientsStore';
import { scheduleClientAlarm, getScheduledAlarmClientIds } from '../services/notifications';
import { hapticWarning } from '../utils/haptics';

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
  const saveAlarm = useClientsStore((s) => s.saveAlarm);
  const [activeAlarm, setActiveAlarm] = useState<AlarmData | null>(null);

  useEffect(() => {
    const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
      if (type !== EventType.DELIVERED) return;
      const data = detail.notification?.data as
        | { clientId?: string; alarmTime?: string; clientName?: string; clientAddress?: string }
        | undefined;
      if (!data?.clientId) return;
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
  const reconcileAlarms = useCallback(async () => {
    if (reconciling.current) return;
    reconciling.current = true;
    try {
      const { clients, updateClient } = useClientsStore.getState();
      if (!clients.length) return;
      const withAlarm = clients.filter((c) => c.alarm && !c.isNote);
      if (withAlarm.length === 0) return;
      const scheduled = await getScheduledAlarmClientIds();

      for (const c of withAlarm) {
        if (scheduled.has(c.id)) continue;
        const isActivePeriodic =
          ['weekly', 'biweekly', 'triweekly', 'monthly'].includes(c.freq) && !c.isCompleted;
        const isPendingOnce = c.freq === 'once' && !c.isCompleted && !!c.specificDate;

        if (isActivePeriodic || isPendingOnce) {
          const targetDay =
            (c.visitDays && c.visitDays.length > 0 ? c.visitDays[0] : undefined) || c.visitDay;
          const fireAt = await scheduleClientAlarm(c.id, c.name || '', c.address || '', c.alarm, {
            targetDay,
            specificDate: c.freq === 'once' ? c.specificDate : undefined,
          });
          if (fireAt) continue;
        }
        // Sin próxima ocurrencia programable (pedido puntual vencido, cliente
        // completado/directorio, hora malformada): apagar la campana para que
        // la UI no mienta.
        await updateClient(c.id, { alarm: '' } as any);
      }
    } finally {
      reconciling.current = false;
    }
  }, []);

  useEffect(() => {
    // Al montar (arranque con datos ya cargados o apenas lleguen) y en cada
    // vuelta a foreground.
    let didInitial = false;
    const unsubStore = useClientsStore.subscribe((s) => {
      if (!didInitial && s.clients.length > 0) {
        didInitial = true;
        reconcileAlarms();
      }
    });
    if (useClientsStore.getState().clients.length > 0) {
      didInitial = true;
      reconcileAlarms();
    }
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcileAlarms();
    });
    return () => {
      unsubStore();
      appStateSub.remove();
    };
  }, [reconcileAlarms]);

  const dismissAlarm = useCallback(() => {
    if (activeAlarm) {
      saveAlarm(activeAlarm.clientId, '');
    }
    setActiveAlarm(null);
  }, [activeAlarm, saveAlarm]);

  return { activeAlarm, dismissAlarm };
};
