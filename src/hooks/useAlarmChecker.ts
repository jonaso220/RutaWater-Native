import { useEffect, useState, useCallback } from 'react';
import { Vibration } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { useClientsStore } from '../stores/clientsStore';

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
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    });
    return unsubscribe;
  }, []);

  const dismissAlarm = useCallback(() => {
    if (activeAlarm) {
      saveAlarm(activeAlarm.clientId, '');
    }
    setActiveAlarm(null);
  }, [activeAlarm, saveAlarm]);

  return { activeAlarm, dismissAlarm };
};
