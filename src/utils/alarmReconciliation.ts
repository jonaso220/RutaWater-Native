import type { Client } from '../types';
import { occurrenceForSpecificDate, occurrenceForVisitDate, parseTime } from './scheduling';
import { alarmScheduleFields, intervalWeeksForFreq } from './helpers';

export type AlarmReconciliationAction = 'keep' | 'schedule' | 'clear' | 'cancel';

export interface ScheduledAlarmMetadata {
  time: string;
  targetDay?: string;
  specificDate?: string;
  nextVisitDate?: string;
  intervalWeeks?: number;
  scopeKey?: string;
  ownerUid?: string;
  timestamp?: number;
}

export interface DeliveredAlarmMetadata {
  clientId?: string;
  ownerUid?: string;
  scopeKey?: string;
}

export const isAlarmScopeReady = (
  loading: boolean,
  storeScopeKey: string,
  expectedScopeKey: string,
): boolean => !loading && !!expectedScopeKey && storeScopeKey === expectedScopeKey;

export const shouldPresentDeliveredAlarm = (
  data: DeliveredAlarmMetadata,
  currentUserId: string | undefined,
  activeScopeKey: string | undefined,
  activeClientIds: Set<string>,
): boolean => {
  if (!data.clientId || !currentUserId || !activeScopeKey) return false;
  if (data.ownerUid && data.ownerUid !== currentUserId) return false;
  if (data.scopeKey && data.scopeKey !== activeScopeKey) return false;
  // Legacy/intermediate triggers without both ownership fields are accepted
  // only when their client is canonically visible in the active scope.
  if (!data.ownerUid || !data.scopeKey) return activeClientIds.has(data.clientId);
  return true;
};

type AlarmClient = Pick<
  Client,
  'alarm' | 'freq' | 'isCompleted' | 'isNote' | 'specificDate'
> & Partial<Pick<Client, 'id' | 'alarmDay' | 'alarmScheduledFor' | 'visitDay' | 'visitDays' | 'groupId' | 'userId' | 'lastVisited' | 'doneFor'>>;

export const isAlarmScheduleExpired = (client: AlarmClient, now = Date.now()): boolean =>
  typeof client.alarmScheduledFor === 'number'
  && Number.isFinite(client.alarmScheduledFor)
  && client.alarmScheduledFor <= now;

export const alarmTargetsDay = (client: AlarmClient, day: string): boolean =>
  !!client.alarm
  && (
    client.alarmDay
    || (client.visitDays && client.visitDays.length > 0 ? client.visitDays[0] : undefined)
    || client.visitDay
  ) === day;

export const getAlarmReconciliationSignature = (
  clients: AlarmClient[],
  scopeKey: string,
): string => JSON.stringify(clients
  .filter((client) => (client.groupId || client.userId) === scopeKey)
  .map((client) => [
    client.id || '',
    client.alarm || '',
    client.alarmDay || '',
    client.alarmScheduledFor || 0,
    client.freq,
    !!client.isCompleted,
    client.specificDate || '',
    client.visitDay || '',
    (client.visitDays || []).join(','),
    client.doneFor || '',
    String((client as { lastVisited?: unknown }).lastVisited ?? ''),
  ])
  .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/**
 * Decides what local alarm reconciliation may do without conflating device
 * failures with invalid shared data. A valid active alarm is always kept in
 * Firestore, even if scheduling later fails on this particular device.
 */
export const getAlarmReconciliationAction = (
  client: AlarmClient,
  scheduledOnDevice: boolean | ScheduledAlarmMetadata | null | undefined,
  expectedOwnerUid?: string,
): AlarmReconciliationAction => {
  const hasScheduledTrigger = typeof scheduledOnDevice === 'boolean'
    ? scheduledOnDevice
    : !!scheduledOnDevice;
  if (!client.alarm) return hasScheduledTrigger ? 'cancel' : 'keep';

  const parsed = parseTime(client.alarm);
  if (!parsed) return 'clear';

  const isActivePeriodic =
    ['weekly', 'biweekly', 'triweekly', 'monthly'].includes(client.freq) &&
    !client.isCompleted;
  const futureOnceOccurrence =
    client.freq === 'once' &&
    !client.isCompleted &&
    !!client.specificDate &&
    occurrenceForSpecificDate(
      client.specificDate,
      parsed.hours,
      parsed.minutes,
    );
  if (!isActivePeriodic && !futureOnceOccurrence) return 'clear';

  // A native timestamp trigger is intentionally one-shot. Once its canonical
  // instant has passed, clear the shared bell instead of arming another cycle.
  if (isAlarmScheduleExpired(client)) {
    // An older app can replace a trigger without knowing alarmScheduledFor.
    // If this device proves there is a newer pending trigger for the same
    // alarm, keep it long enough to migrate its timestamp instead of clearing.
    if (
      typeof scheduledOnDevice !== 'boolean'
      && typeof scheduledOnDevice?.timestamp === 'number'
      && scheduledOnDevice.timestamp > Date.now()
      && scheduledOnDevice.time === client.alarm
      && scheduledOnDevice.targetDay === (
        client.alarmDay
        || (client.visitDays && client.visitDays.length > 0 ? client.visitDays[0] : undefined)
        || client.visitDay
      )
      && scheduledOnDevice.scopeKey === (client.groupId || client.userId)
      && (!expectedOwnerUid || scheduledOnDevice.ownerUid === expectedOwnerUid)
    ) return 'keep';
    return 'clear';
  }

  if (!hasScheduledTrigger) {
    // New alarms persist their exact future instant and can be mirrored safely
    // on another signed-in device. Legacy alarms without it are left visible
    // but never auto-rearmed; the user can remove or program them again.
    return typeof client.alarmScheduledFor === 'number' ? 'schedule' : 'keep';
  }
  // Boolean callers retain the legacy existence-only behavior. Production
  // reconciliation supplies metadata and replaces stale remote time/day data.
  if (typeof scheduledOnDevice === 'boolean') return 'keep';
  if (!scheduledOnDevice) return 'schedule';

  const expectedTargetDay = client.alarmDay
    || (client.visitDays && client.visitDays.length > 0 ? client.visitDays[0] : undefined)
    || client.visitDay;
  const expectedSpecificDate = client.freq === 'once' ? (client.specificDate || undefined) : undefined;
  const expectedScopeKey = client.groupId || client.userId;
  const expectedTiming = alarmScheduleFields(client as Client, expectedTargetDay);
  if (
    scheduledOnDevice.time !== client.alarm
    || scheduledOnDevice.targetDay !== expectedTargetDay
    || scheduledOnDevice.specificDate !== expectedSpecificDate
    || scheduledOnDevice.scopeKey !== expectedScopeKey
    || (!!expectedOwnerUid && scheduledOnDevice.ownerUid !== expectedOwnerUid)
    || (
      typeof client.alarmScheduledFor === 'number'
      && scheduledOnDevice.timestamp !== client.alarmScheduledFor
    )
    || (
      !!scheduledOnDevice.nextVisitDate
      && scheduledOnDevice.nextVisitDate !== expectedTiming.nextVisitDate
    )
  ) {
    return 'schedule';
  }

  if (
    typeof client.alarmScheduledFor !== 'number'
    && typeof scheduledOnDevice.timestamp === 'number'
    && expectedTiming.nextVisitDate
  ) {
    const expectedFire = occurrenceForVisitDate(
      expectedTiming.nextVisitDate,
      parsed.hours,
      parsed.minutes,
      expectedTiming.intervalWeeks ?? intervalWeeksForFreq(client.freq),
    );
    if (expectedFire) {
      const scheduledAt = new Date(scheduledOnDevice.timestamp);
      if (
        scheduledAt.getFullYear() !== expectedFire.getFullYear()
        || scheduledAt.getMonth() !== expectedFire.getMonth()
        || scheduledAt.getDate() !== expectedFire.getDate()
      ) {
        return 'schedule';
      }
    }
  }
  return 'keep';
};
