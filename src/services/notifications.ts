import notifee, {
  AlarmType,
  AndroidImportance,
  AndroidNotificationSetting,
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
  occurrenceForVisitDate,
} from '../utils/scheduling';

const ANDROID_CHANNEL_ID = 'visit-alarms';

export type AlarmPermissionIssue = 'notifications' | 'exact-alarm';

interface AlarmPermissionSettings {
  authorizationStatus: AuthorizationStatus;
  android?: { alarm?: AndroidNotificationSetting };
}

export const alarmPermissionIssueForSettings = (
  settings: AlarmPermissionSettings,
): AlarmPermissionIssue | null => {
  if (settings.authorizationStatus < AuthorizationStatus.AUTHORIZED) {
    return 'notifications';
  }
  if (
    Platform.OS === 'android' &&
    settings.android?.alarm === AndroidNotificationSetting.DISABLED
  ) {
    return 'exact-alarm';
  }
  return null;
};

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
  return alarmPermissionIssueForSettings(settings) === null;
};

export const getAlarmPermissionIssue = async (): Promise<AlarmPermissionIssue | null> =>
  alarmPermissionIssueForSettings(await notifee.getNotificationSettings());

export const openExactAlarmPermissionSettings = async (): Promise<void> => {
  try {
    if (Platform.OS === 'android') {
      await notifee.openAlarmPermissionSettings();
    }
  } catch (e) {
    reportError(e, 'openExactAlarmPermissionSettings error');
  }
};

const notificationIdFor = (clientId: string) => `alarm-${clientId}`;

// Alarm changes span native state and Firestore, so two overlapping operations
// for the same client cannot be allowed to interleave. Keep the queue here (not
// only in a button) because reconciliation, undo and edits can run in parallel.
const clientAlarmMutationTails = new Map<string, Promise<void>>();

const acquireClientAlarmMutation = async (clientId: string): Promise<() => void> => {
  const previous = clientAlarmMutationTails.get(clientId) || Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => {}).then(() => current);
  clientAlarmMutationTails.set(clientId, tail);
  await previous.catch(() => {});

  return () => {
    releaseCurrent();
    void tail.then(() => {
      if (clientAlarmMutationTails.get(clientId) === tail) {
        clientAlarmMutationTails.delete(clientId);
      }
    });
  };
};

export const runSerializedAlarmMutation = async <T>(
  clientIds: string | string[],
  mutate: () => Promise<T>,
): Promise<T> => {
  const ids = Array.from(new Set(Array.isArray(clientIds) ? clientIds : [clientIds]))
    .filter(Boolean)
    .sort();
  const releases: Array<() => void> = [];
  try {
    // Global ordering prevents deadlocks for batch operations involving more
    // than one client while still allowing unrelated clients to run in parallel.
    for (const id of ids) {
      releases.push(await acquireClientAlarmMutation(id));
    }
    return await mutate();
  } finally {
    for (let i = releases.length - 1; i >= 0; i -= 1) {
      releases[i]();
    }
  }
};

export const scheduleClientAlarm = async (
  clientId: string,
  clientName: string,
  address: string,
  time: string,
  options?: {
    targetDay?: string;
    specificDate?: string;
    nextVisitDate?: string;
    intervalWeeks?: number;
    scheduledFor?: number;
    scopeKey?: string;
    ownerUid?: string;
    permissionAlreadyChecked?: boolean;
  },
): Promise<Date | null> => {
  const parsed = parseTime(time);
  if (!parsed) return null;

  const id = notificationIdFor(clientId);

  let fireAt: Date | null = null;
  if (typeof options?.scheduledFor === 'number') {
    fireAt = Number.isFinite(options.scheduledFor) && options.scheduledFor > Date.now()
      ? new Date(options.scheduledFor)
      : null;
    if (!fireAt) return null;
  } else if (options?.specificDate !== undefined) {
    fireAt = occurrenceForSpecificDate(options.specificDate, parsed.hours, parsed.minutes);
    // A supplied one-time date is authoritative. If it is malformed, does not
    // exist, or is already past, silently falling back to a weekly/daily alarm
    // would schedule a different reminder than the user requested.
    if (!fireAt) return null;
  } else if (options?.nextVisitDate) {
    fireAt = occurrenceForVisitDate(
      options.nextVisitDate,
      parsed.hours,
      parsed.minutes,
      options.intervalWeeks ?? 1,
    );
    // Same contract as specificDate: a known visit day must not silently
    // collapse to "next weekday" or the driver goes to a house that is not due.
    if (!fireAt) return null;
  } else if (options?.targetDay) {
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
    // requestPermission() does not grant Android's separate exact-alarm
    // special access. Never attempt to create a trigger when either access is
    // unavailable; callers can then surface the precise recovery action.
    if (!options?.permissionAlreadyChecked && await getAlarmPermissionIssue()) return null;
    const channelId = await ensureAndroidChannel();
    await notifee.createTriggerNotification(
      {
        id,
        title,
        body,
        data: {
          clientId,
          alarmTime: time,
          clientName: title,
          clientAddress: address,
          alarmTargetDay: options?.targetDay || '',
          alarmSpecificDate: options?.specificDate || '',
          alarmNextVisitDate: options?.nextVisitDate || '',
          alarmIntervalWeeks: String(options?.intervalWeeks || ''),
          alarmScheduledFor: String(fireAt.getTime()),
          alarmScopeKey: options?.scopeKey || '',
          alarmOwnerUid: options?.ownerUid || '',
        },
        android: {
          channelId,
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'default' },
          smallIcon: 'ic_notification',
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

export const cancelClientAlarm = async (clientId: string): Promise<true> => {
  try {
    await notifee.cancelTriggerNotification(notificationIdFor(clientId));
    return true;
  } catch (e) {
    reportError(e, 'cancelClientAlarm error');
    throw e;
  }
};

export interface ClientAlarmSnapshot {
  clientId: string;
  clientName: string;
  address: string;
  time: string;
  targetDay?: string;
  specificDate?: string;
  nextVisitDate?: string;
  intervalWeeks?: number;
  scheduledFor?: number;
  scopeKey?: string;
  ownerUid?: string;
}

export const restoreClientAlarmSnapshots = async (
  snapshots: ClientAlarmSnapshot[],
): Promise<void> => {
  const results = await Promise.all(snapshots.map((snapshot) => scheduleClientAlarm(
    snapshot.clientId,
    snapshot.clientName,
    snapshot.address,
    snapshot.time,
    {
      targetDay: snapshot.targetDay,
      specificDate: snapshot.specificDate,
      nextVisitDate: snapshot.nextVisitDate,
      intervalWeeks: snapshot.intervalWeeks,
      scheduledFor: snapshot.scheduledFor,
      scopeKey: snapshot.scopeKey,
      ownerUid: snapshot.ownerUid,
      // These snapshots came from triggers that existed immediately before
      // this operation. Avoid a second permission lookup during compensation.
      permissionAlreadyChecked: true,
    },
  )));
  if (results.some((fireAt) => fireAt === null)) {
    throw new Error('ALARM_SNAPSHOT_RESTORE_FAILED');
  }
};

/**
 * Cancels old triggers before changing shared state. If either cancellation or
 * the mutation fails, recreates every previous trigger from its snapshot so a
 * still-active Firestore alarm never remains silently disarmed.
 */
export const cancelAlarmsThenMutate = async <T>(
  snapshotSource: ClientAlarmSnapshot[] | (() => ClientAlarmSnapshot[]),
  mutate: (snapshots: ClientAlarmSnapshot[]) => Promise<T>,
  clientIds?: string[],
): Promise<T> => {
  const staticSnapshots = typeof snapshotSource === 'function' ? null : snapshotSource;
  const mutationClientIds = clientIds || staticSnapshots?.map((snapshot) => snapshot.clientId) || [];
  if (mutationClientIds.length === 0) return mutate(staticSnapshots || []);
  return runSerializedAlarmMutation(mutationClientIds, async () => {
    // Factories are evaluated only after the keyed lock is held, so a queued
    // operation compensates the alarm that actually won immediately before it.
    const snapshots = typeof snapshotSource === 'function'
      ? snapshotSource()
      : snapshotSource;
    if (snapshots.length === 0) return mutate(snapshots);
    try {
      // Wait for every native outcome in a deterministic order. If one fails,
      // no later cancellation is left racing a compensation restore.
      for (const snapshot of snapshots) {
        await cancelClientAlarm(snapshot.clientId);
      }
      return await mutate(snapshots);
    } catch (error) {
      try {
        await restoreClientAlarmSnapshots(snapshots);
      } catch (restoreError) {
        reportError(restoreError, 'cancelAlarmsThenMutate restore error');
      }
      throw error;
    }
  });
};

/**
 * Persists the shared alarm only after its local trigger exists. If persistence
 * fails, compensate by removing that trigger so no invisible alarm survives.
 * The original persistence error remains authoritative for the caller.
 */
export const persistAlarmOrRollbackTrigger = async (
  persistAlarm: () => Promise<void>,
  rollbackTrigger: () => Promise<unknown>,
  restorePreviousTrigger?: () => Promise<unknown>,
): Promise<void> => {
  try {
    await persistAlarm();
  } catch (error) {
    try {
      await rollbackTrigger();
    } catch (rollbackError) {
      reportError(rollbackError, 'persistAlarm rollback error');
    }
    if (restorePreviousTrigger) {
      try {
        await restorePreviousTrigger();
      } catch (restoreError) {
        reportError(restoreError, 'persistAlarm previous trigger restore error');
      }
    }
    throw error;
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

export interface ScheduledClientAlarm {
  clientId: string;
  time: string;
  targetDay?: string;
  specificDate?: string;
  nextVisitDate?: string;
  intervalWeeks?: number;
  scopeKey?: string;
  ownerUid?: string;
  timestamp?: number;
}

/** Pending alarm metadata on this device, including legacy triggers. */
export const getScheduledClientAlarms = async (): Promise<Map<string, ScheduledClientAlarm>> => {
  try {
    const triggers = await notifee.getTriggerNotifications();
    const alarms = new Map<string, ScheduledClientAlarm>();
    triggers.forEach(({ notification, trigger }) => {
      const id = notification.id || '';
      if (!id.startsWith('alarm-')) return;
      const data = (notification.data || {}) as Record<string, unknown>;
      const clientId = typeof data.clientId === 'string' && data.clientId
        ? data.clientId
        : id.slice('alarm-'.length);
      if (!clientId) return;
      const timestamp = 'timestamp' in trigger && typeof trigger.timestamp === 'number'
        ? trigger.timestamp
        : undefined;
      alarms.set(clientId, {
        clientId,
        time: typeof data.alarmTime === 'string' ? data.alarmTime : '',
        targetDay: typeof data.alarmTargetDay === 'string' && data.alarmTargetDay
          ? data.alarmTargetDay
          : undefined,
        specificDate: typeof data.alarmSpecificDate === 'string' && data.alarmSpecificDate
          ? data.alarmSpecificDate
          : undefined,
        nextVisitDate: typeof data.alarmNextVisitDate === 'string' && data.alarmNextVisitDate
          ? data.alarmNextVisitDate
          : undefined,
        intervalWeeks: typeof data.alarmIntervalWeeks === 'string' && data.alarmIntervalWeeks
          ? Number(data.alarmIntervalWeeks) || undefined
          : undefined,
        scopeKey: typeof data.alarmScopeKey === 'string' && data.alarmScopeKey
          ? data.alarmScopeKey
          : undefined,
        ownerUid: typeof data.alarmOwnerUid === 'string' && data.alarmOwnerUid
          ? data.alarmOwnerUid
          : undefined,
        timestamp,
      });
    });
    return alarms;
  } catch (e) {
    reportError(e, 'getScheduledClientAlarms error');
    return new Map();
  }
};

/** Remove every pending alarm owned by the account that just signed out. */
export const cancelScheduledAlarmsForOwner = async (
  ownerUid: string,
  includeLegacyUnowned = true,
): Promise<void> => {
  const triggers = await notifee.getTriggerNotifications();
  let firstError: unknown;
  for (const { notification } of triggers) {
    const id = notification.id || '';
    if (!id.startsWith('alarm-')) continue;
    const data = (notification.data || {}) as Record<string, unknown>;
    const triggerOwnerUid = typeof data.alarmOwnerUid === 'string' && data.alarmOwnerUid
      ? data.alarmOwnerUid
      : undefined;
    if (triggerOwnerUid !== ownerUid && !(includeLegacyUnowned && !triggerOwnerUid)) continue;
    const clientId = typeof data.clientId === 'string' && data.clientId
      ? data.clientId
      : id.slice('alarm-'.length);
    try {
      await runSerializedAlarmMutation(clientId, () => notifee.cancelTriggerNotification(id));
    } catch (error) {
      reportError(error, 'cancelScheduledAlarmsForOwner error');
      if (!firstError) firstError = error;
    }
  }
  if (firstError) throw firstError;
};

/**
 * Login/foreground privacy sweep. Removes triggers owned by another Firebase
 * account and legacy unowned triggers that cannot be tied to this active scope.
 */
export const cancelForeignScheduledAlarms = async (
  currentOwnerUid: string,
  activeClientIds: Set<string>,
): Promise<void> => {
  const triggers = await notifee.getTriggerNotifications();
  let firstError: unknown;
  for (const { notification } of triggers) {
    const id = notification.id || '';
    if (!id.startsWith('alarm-')) continue;
    const data = (notification.data || {}) as Record<string, unknown>;
    const clientId = typeof data.clientId === 'string' && data.clientId
      ? data.clientId
      : id.slice('alarm-'.length);
    const triggerOwnerUid = typeof data.alarmOwnerUid === 'string' && data.alarmOwnerUid
      ? data.alarmOwnerUid
      : undefined;
    const shouldCancel = triggerOwnerUid
      ? triggerOwnerUid !== currentOwnerUid
      : !activeClientIds.has(clientId);
    if (!shouldCancel) continue;
    try {
      await runSerializedAlarmMutation(clientId, () => notifee.cancelTriggerNotification(id));
    } catch (error) {
      reportError(error, 'cancelForeignScheduledAlarms error');
      if (!firstError) firstError = error;
    }
  }
  if (firstError) throw firstError;
};
