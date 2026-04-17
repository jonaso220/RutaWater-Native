import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  TriggerType,
  TimestampTrigger,
} from '@notifee/react-native';
import { Platform } from 'react-native';

const ANDROID_CHANNEL_ID = 'visit-alarms';

let channelPromise: Promise<string> | null = null;

const ensureAndroidChannel = async (): Promise<string> => {
  if (Platform.OS !== 'android') return ANDROID_CHANNEL_ID;
  if (!channelPromise) {
    channelPromise = notifee.createChannel({
      id: ANDROID_CHANNEL_ID,
      name: 'Alarmas de visita',
      importance: AndroidImportance.HIGH,
      vibration: true,
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

const parseTime = (time: string): { hours: number; minutes: number } | null => {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(time);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
};

const nextOccurrence = (hours: number, minutes: number): Date => {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
};

export const scheduleClientAlarm = async (
  clientId: string,
  clientName: string,
  address: string,
  time: string,
): Promise<boolean> => {
  const parsed = parseTime(time);
  if (!parsed) return false;

  const channelId = await ensureAndroidChannel();
  const id = notificationIdFor(clientId);
  const fireAt = nextOccurrence(parsed.hours, parsed.minutes);

  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: fireAt.getTime(),
    alarmManager: {
      allowWhileIdle: true,
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
        },
        ios: {
          sound: 'default',
          interruptionLevel: 'timeSensitive',
        },
      },
      trigger,
    );
    return true;
  } catch (e) {
    console.error('scheduleClientAlarm error', e);
    return false;
  }
};

export const cancelClientAlarm = async (clientId: string): Promise<void> => {
  try {
    await notifee.cancelTriggerNotification(notificationIdFor(clientId));
  } catch (e) {
    console.error('cancelClientAlarm error', e);
  }
};
