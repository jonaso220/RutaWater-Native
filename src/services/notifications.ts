import notifee, {
  AlarmType,
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
      sound: 'default',
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

const SPANISH_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const nextOccurrenceForDay = (
  dayName: string,
  hours: number,
  minutes: number,
): Date => {
  const targetIdx = SPANISH_DAYS.indexOf(dayName);
  if (targetIdx === -1) return nextOccurrence(hours, minutes);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  let daysAhead = (targetIdx - now.getDay() + 7) % 7;
  if (daysAhead === 0 && target.getTime() <= now.getTime()) {
    daysAhead = 7;
  }
  target.setDate(target.getDate() + daysAhead);
  return target;
};

const occurrenceForSpecificDate = (
  specificDate: string,
  hours: number,
  minutes: number,
): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(specificDate);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const target = new Date(year, month, day, hours, minutes, 0, 0);
  if (Number.isNaN(target.getTime())) return null;
  if (target.getTime() <= Date.now()) return null;
  return target;
};

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
    console.error('scheduleClientAlarm error', e);
    return null;
  }
};

export const cancelClientAlarm = async (clientId: string): Promise<void> => {
  try {
    await notifee.cancelTriggerNotification(notificationIdFor(clientId));
  } catch (e) {
    console.error('cancelClientAlarm error', e);
  }
};
