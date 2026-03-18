import { useState, useEffect, useRef, useCallback } from 'react';
import { Vibration } from 'react-native';
import { useClientsStore } from '../stores/clientsStore';

export interface AlarmData {
  clientId: string;
  name: string;
  address: string;
  time: string;
}

/**
 * Checks client alarms every 5 seconds.
 * When the current time matches an alarm, fires a vibration + returns alarm data.
 * Auto-clears the alarm after firing so it doesn't repeat.
 */
export const useAlarmChecker = () => {
  const clients = useClientsStore((s) => s.clients);
  const saveAlarm = useClientsStore((s) => s.saveAlarm);
  const [activeAlarm, setActiveAlarm] = useState<AlarmData | null>(null);
  const firedAlarmsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const interval = setInterval(() => {
      if (activeAlarm) return; // Don't fire another while one is showing

      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      for (const client of clients) {
        if (!client.alarm || client.isCompleted) continue;
        if (firedAlarmsRef.current.has(client.id)) continue;

        if (client.alarm === currentTime) {
          firedAlarmsRef.current.add(client.id);
          setActiveAlarm({
            clientId: client.id,
            name: client.name || 'Cliente',
            address: client.address || '',
            time: client.alarm,
          });
          // Vibrate pattern: buzz-pause-buzz-pause-buzz
          Vibration.vibrate([0, 500, 200, 500, 200, 500]);
          break;
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [clients, activeAlarm]);

  // Reset fired alarms on the minute change (so same alarm won't re-fire)
  useEffect(() => {
    const resetInterval = setInterval(() => {
      firedAlarmsRef.current.clear();
    }, 65000); // Just over a minute
    return () => clearInterval(resetInterval);
  }, []);

  const dismissAlarm = useCallback(() => {
    if (activeAlarm) {
      // Clear the alarm from the client so it doesn't fire again
      saveAlarm(activeAlarm.clientId, '');
    }
    setActiveAlarm(null);
  }, [activeAlarm, saveAlarm]);

  return { activeAlarm, dismissAlarm };
};
