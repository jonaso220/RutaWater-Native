import {
  getAlarmReconciliationAction,
  getAlarmReconciliationSignature,
  isAlarmScopeReady,
  shouldPresentDeliveredAlarm,
} from '../alarmReconciliation';

const alarmClient = (overrides: Record<string, unknown> = {}) => ({
  alarm: '09:30',
  freq: 'weekly' as const,
  isCompleted: false,
  isNote: false,
  specificDate: '',
  ...overrides,
});

describe('alarm reconciliation safety', () => {
  test('keeps an already scheduled alarm and schedules a missing active one', () => {
    expect(getAlarmReconciliationAction(alarmClient(), true)).toBe('keep');
    expect(getAlarmReconciliationAction(alarmClient(), false)).toBe('schedule');
  });

  test('keeps valid shared data on the schedule path regardless of device outcome', () => {
    const action = getAlarmReconciliationAction(alarmClient(), false);
    expect(action).toBe('schedule');
    expect(action).not.toBe('clear');
  });

  test('schedules a future one-time alarm and clears an expired one', () => {
    expect(getAlarmReconciliationAction(alarmClient({
      freq: 'once',
      specificDate: '2099-12-31',
    }), false)).toBe('schedule');
    expect(getAlarmReconciliationAction(alarmClient({
      freq: 'once',
      specificDate: '2000-01-01',
    }), false)).toBe('clear');
  });

  test('only clears intrinsically invalid or inactive alarm data', () => {
    expect(getAlarmReconciliationAction(alarmClient({ alarm: '99:99' }), false)).toBe('clear');
    expect(getAlarmReconciliationAction(alarmClient({ isCompleted: true }), false)).toBe('clear');
    expect(getAlarmReconciliationAction(alarmClient({ isCompleted: true }), true)).toBe('clear');
    expect(getAlarmReconciliationAction(alarmClient({ isNote: true }), false)).toBe('schedule');
  });

  test('replaces a pending trigger after a remote time change', () => {
    const client = alarmClient({
      alarm: '10:45',
      visitDay: 'Viernes',
      userId: 'user-1',
    });
    expect(getAlarmReconciliationAction(client, {
      time: '09:30',
      targetDay: 'Viernes',
      scopeKey: 'user-1',
    })).toBe('schedule');
    expect(getAlarmReconciliationAction(client, {
      time: '10:45',
      targetDay: 'Viernes',
      scopeKey: 'user-1',
    })).toBe('keep');
  });

  test('replaces a biweekly trigger armed for this weekday instead of the next visit', () => {
    jest.useFakeTimers({ now: new Date(2026, 2, 4, 10, 0, 0, 0).getTime() });
    try {
      const client = alarmClient({
        freq: 'biweekly',
        alarm: '08:00',
        visitDay: 'Sábado',
        visitDays: ['Sábado'],
        userId: 'user-1',
        lastVisited: new Date(2026, 1, 28, 10, 0, 0, 0),
        doneFor: '2026-02-28',
      });
      const thisSaturday = new Date(2026, 2, 7, 8, 0, 0, 0).getTime();
      const nextVisitSaturday = new Date(2026, 2, 14, 8, 0, 0, 0).getTime();
      expect(getAlarmReconciliationAction(client, {
        time: '08:00',
        targetDay: 'Sábado',
        scopeKey: 'user-1',
        timestamp: thisSaturday,
      })).toBe('schedule');
      expect(getAlarmReconciliationAction(client, {
        time: '08:00',
        targetDay: 'Sábado',
        scopeKey: 'user-1',
        nextVisitDate: '2026-03-14',
        timestamp: nextVisitSaturday,
      })).toBe('keep');
    } finally {
      jest.useRealTimers();
    }
  });

  test('cancels this device trigger after a remote alarm clear', () => {
    const client = alarmClient({
      alarm: '',
      visitDay: 'Viernes',
      userId: 'user-1',
    });
    expect(getAlarmReconciliationAction(client, {
      time: '09:30',
      targetDay: 'Viernes',
      scopeKey: 'user-1',
    })).toBe('cancel');
    expect(getAlarmReconciliationAction(client, undefined)).toBe('keep');
  });

  test('foreground subscription signature changes for remote time and clear updates', () => {
    const base = alarmClient({ id: 'client-1', userId: 'user-1', visitDay: 'Viernes' });
    const initial = getAlarmReconciliationSignature([base], 'user-1');
    const remoteTime = getAlarmReconciliationSignature([{ ...base, alarm: '10:45' }], 'user-1');
    const remoteClear = getAlarmReconciliationSignature([{ ...base, alarm: '' }], 'user-1');
    expect(remoteTime).not.toBe(initial);
    expect(remoteClear).not.toBe(remoteTime);
  });

  test('an empty stale scope never authorizes orphan cleanup after a profile switch', () => {
    expect(isAlarmScopeReady(false, 'scope-a', 'scope-b')).toBe(false);
    expect(isAlarmScopeReady(false, 'scope-b', 'scope-b')).toBe(true);
  });

  test('foreground delivery rejects another owner/scope and constrains legacy alarms', () => {
    const activeIds = new Set(['client-active']);
    expect(shouldPresentDeliveredAlarm(
      { clientId: 'client-active', ownerUid: 'user-old', scopeKey: 'scope-b' },
      'user-new',
      'scope-b',
      activeIds,
    )).toBe(false);
    expect(shouldPresentDeliveredAlarm(
      { clientId: 'client-active', ownerUid: 'user-new', scopeKey: 'scope-a' },
      'user-new',
      'scope-b',
      activeIds,
    )).toBe(false);
    expect(shouldPresentDeliveredAlarm(
      { clientId: 'legacy-foreign' },
      'user-new',
      'scope-b',
      activeIds,
    )).toBe(false);
    expect(shouldPresentDeliveredAlarm(
      { clientId: 'client-active' },
      'user-new',
      'scope-b',
      activeIds,
    )).toBe(true);
  });
});
