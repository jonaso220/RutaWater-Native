import auth from '@react-native-firebase/auth';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import type { Client } from '../types';
import {
  DeliveredAlarmScheduleData,
  shouldClearDeliveredAlarm,
} from '../utils/alarmDelivery';

/** Clears a delivered one-shot alarm, guarded against owner/scope and races. */
export const clearDeliveredClientAlarm = async (
  data: DeliveredAlarmScheduleData,
): Promise<boolean> => {
  const clientId = data.clientId;
  const currentUid = auth().currentUser?.uid;
  if (!clientId || !currentUid) return false;
  if (data.alarmOwnerUid && data.alarmOwnerUid !== currentUid) return false;

  try {
    return await db.runTransaction(async (transaction) => {
      const ref = db.collection('clients').doc(clientId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const client = snapshot.data() as Client | undefined;
      if (!client) return false;

      const clientScope = client.groupId || client.userId;
      if (data.alarmScopeKey && data.alarmScopeKey !== clientScope) return false;
      if (!shouldClearDeliveredAlarm(client, data)) return false;

      transaction.update(ref, {
        alarm: '',
        alarmDay: '',
        alarmScheduledFor: null,
        updatedAt: new Date(),
      });
      return true;
    });
  } catch (error) {
    reportError(error, 'clearDeliveredClientAlarm error');
    return false;
  }
};
