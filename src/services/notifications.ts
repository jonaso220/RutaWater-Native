import notifee, {
  AlarmType,
  AndroidImportance,
  AuthorizationStatus,
  TriggerType,
  TimestampTrigger,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { reportError } from '../lib/crashReporting';
import {
  parseTime,
  nextOccurrence,
  nextOccurrenceForDay,
  occurrenceForSpecificDate,
} from '../utils/scheduling';

const ANDROID_CHANNEL_ID = 'visit-alarms';

let channelPromise: Promise<string> | null = null;

const ensureAndroidChannel = async (): Promise<string> => {
  if (Platform.OS !== 'android') return ANDROID_CHANNEL_ID;
  if (!channelPromise) {
    channelPromise = notifee
      .createChannel({
        id: ANDROID_CHANNEL_ID,
        name: 'Alarmas de visita',
        importance: AndroidImportance.HIGH,
        vibration: true,
        sound: 'default',
      })
      .catch((e) => {
        // No cachear el rechazo: un fallo transitorio dejaría TODAS las
        // alarmas futuras sin programar hasta reiniciar la app.
        channelPromise = null;
        throw e;
      });
  }
  return channelPromise;
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  const settings = await notifee.requestPermission();
  if (Platform.OS === 'android') {
    await ensureAndroidChannel();
  }
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
};

const notificationIdFor = (clientId: string) => `alarm-${clientId}`;

export const scheduleClientAlarm = async (
  clientId: string,
  clientName: string,
  address: string,
  time: string,
  options?: { targetDay?: string; specificDate?: string },
): Promise<Date | null> => {
  const parsed = parseTime(time);
  if (!parsed) return null;

  const channelId = await ensureAndroidChannel();
  const id = notificationIdFor(clientId);

  let fireAt: Date | null = null;
  if (options?.specificDate) {
    fireAt = occurrenceForSpecificDate(options.specificDate, parsed.hours, parsed.minutes);
  }
  if (!fireAt && options?.targetDay) {
    fireAt = nextOccurrenceForDay(options.targetDay, parsed.hours, parsed.minutes);
  }
  if (!fireAt) {
    fireAt = nextOccurrence(parsed.hours, parsed.minutes);
  }

  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: fireAt.getTime(),
    alarmManager: {
      type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
    },
  };

  const title = clientName || 'Recordatorio de visita';
  const body = address ? `${time} — ${address}` : time;

  try {
    await notifee.createTriggerNotification(
      {
        id,
        title,
        body,
        data: { clientId, alarmTime: time, clientName: title, clientAddress: address },
        android: {
          channelId,
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'default' },
          smallIcon: 'ic_launcher',
          sound: 'default',
        },
        ios: {
          sound: 'default',
          interruptionLevel: 'timeSensitive',
        },
      },
      trigger,
    );
    return fireAt;
  } catch (e) {
    reportError(e, 'scheduleClientAlarm error');
    return null;
  }
};

export const cancelClientAlarm = async (clientId: string): Promise<void> => {
  try {
    await notifee.cancelTriggerNotification(notificationIdFor(clientId));
  } catch (e) {
    reportError(e, 'cancelClientAlarm error');
  }
};

/** Ids de cliente que tienen un trigger de alarma pendiente en ESTE dispositivo. */
export const getScheduledAlarmClientIds = async (): Promise<Set<string>> => {
  try {
    const ids = await notifee.getTriggerNotificationIds();
    return new Set(
      ids
        .filter((id) => id.startsWith('alarm-'))
        .map((id) => id.slice('alarm-'.length)),
    );
  } catch (e) {
    reportError(e, 'getScheduledAlarmClientIds error');
    return new Set();
  }
};
