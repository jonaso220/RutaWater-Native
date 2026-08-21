import type { Client } from '../types';

export interface DeliveredAlarmScheduleData {
  clientId?: string;
  alarmTime?: string;
  alarmTargetDay?: string;
  alarmScheduledFor?: string | number;
  alarmOwnerUid?: string;
  alarmScopeKey?: string;
}

const finiteSchedule = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Prevents an old delivered event from clearing a newer alarm for the client. */
export const shouldClearDeliveredAlarm = (
  client: Partial<Client>,
  delivered: DeliveredAlarmScheduleData,
): boolean => {
  if (!client.alarm) return false;
  if (delivered.alarmTime && delivered.alarmTime !== client.alarm) return false;

  const deliveredFor = finiteSchedule(delivered.alarmScheduledFor);
  const currentFor = finiteSchedule(client.alarmScheduledFor);
  if (deliveredFor !== undefined || currentFor !== undefined) {
    return deliveredFor !== undefined && deliveredFor === currentFor;
  }

  // Legacy triggers had no exact timestamp. Constrain their cleanup to the
  // same saved day so a late event cannot remove a newly moved alarm.
  return !delivered.alarmTargetDay
    || !client.alarmDay
    || delivered.alarmTargetDay === client.alarmDay;
};
