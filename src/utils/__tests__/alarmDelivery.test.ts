import { shouldClearDeliveredAlarm } from '../alarmDelivery';

describe('one-shot alarm delivery', () => {
  test('clears only the exact alarm instance that was delivered', () => {
    const client = {
      alarm: '09:30',
      alarmDay: 'Viernes',
      alarmScheduledFor: 4102448400000,
    };
    expect(shouldClearDeliveredAlarm(client, {
      alarmTime: '09:30',
      alarmTargetDay: 'Viernes',
      alarmScheduledFor: '4102448400000',
    })).toBe(true);
    expect(shouldClearDeliveredAlarm(client, {
      alarmTime: '09:30',
      alarmTargetDay: 'Viernes',
      alarmScheduledFor: '4103053200000',
    })).toBe(false);
  });

  test('does not let a late event remove a newly changed alarm', () => {
    expect(shouldClearDeliveredAlarm({
      alarm: '10:45',
      alarmDay: 'Lunes',
      alarmScheduledFor: 4103053200000,
    }, {
      alarmTime: '09:30',
      alarmTargetDay: 'Viernes',
      alarmScheduledFor: '4102448400000',
    })).toBe(false);
  });

  test('constrains legacy delivery cleanup by time and day', () => {
    const legacy = { alarm: '09:30', alarmDay: 'Viernes' };
    expect(shouldClearDeliveredAlarm(legacy, {
      alarmTime: '09:30',
      alarmTargetDay: 'Viernes',
    })).toBe(true);
    expect(shouldClearDeliveredAlarm(legacy, {
      alarmTime: '09:30',
      alarmTargetDay: 'Lunes',
    })).toBe(false);
  });
});
