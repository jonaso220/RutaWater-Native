export {};

const mockNotifee = {
  requestPermission: jest.fn(),
  getNotificationSettings: jest.fn(),
  createChannel: jest.fn().mockResolvedValue('visit-alarms'),
  createTriggerNotification: jest.fn().mockResolvedValue('alarm-client-1'),
  openAlarmPermissionSettings: jest.fn().mockResolvedValue(undefined),
  cancelTriggerNotification: jest.fn().mockResolvedValue(undefined),
  getTriggerNotificationIds: jest.fn().mockResolvedValue([]),
  getTriggerNotifications: jest.fn().mockResolvedValue([]),
};

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: mockNotifee,
  AlarmType: { SET_EXACT_AND_ALLOW_WHILE_IDLE: 3 },
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationSetting: { NOT_SUPPORTED: -1, DISABLED: 0, ENABLED: 1 },
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1 },
  TriggerType: { TIMESTAMP: 0 },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('../../lib/crashReporting', () => ({ reportError: jest.fn() }));

const { Platform } = require('react-native');
const {
  alarmPermissionIssueForSettings,
  cancelAlarmsThenMutate,
  cancelClientAlarm,
  cancelForeignScheduledAlarms,
  cancelScheduledAlarmsForOwner,
  persistAlarmOrRollbackTrigger,
  requestNotificationPermission,
  runSerializedAlarmMutation,
  scheduleClientAlarm,
} = require('../notifications');
const { reportError } = require('../../lib/crashReporting');

describe('Android exact-alarm permission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'android';
    mockNotifee.cancelTriggerNotification.mockResolvedValue(undefined);
    mockNotifee.createTriggerNotification.mockResolvedValue('alarm-client-1');
    mockNotifee.getTriggerNotifications.mockResolvedValue([]);
  });

  test('distinguishes notification denial from exact-alarm denial', () => {
    expect(alarmPermissionIssueForSettings({
      authorizationStatus: 0,
      android: { alarm: 1 },
    })).toBe('notifications');
    expect(alarmPermissionIssueForSettings({
      authorizationStatus: 1,
      android: { alarm: 0 },
    })).toBe('exact-alarm');
    expect(alarmPermissionIssueForSettings({
      authorizationStatus: 1,
      android: { alarm: 1 },
    })).toBeNull();
  });

  test('does not report permission success when exact alarms are disabled', async () => {
    mockNotifee.requestPermission.mockResolvedValue({
      authorizationStatus: 1,
      android: { alarm: 0 },
    });

    await expect(requestNotificationPermission()).resolves.toBe(false);
  });

  test('does not create a trigger while exact-alarm access is disabled', async () => {
    mockNotifee.getNotificationSettings.mockResolvedValue({
      authorizationStatus: 1,
      android: { alarm: 0 },
    });

    await expect(scheduleClientAlarm(
      'client-1',
      'Cliente',
      'Direccion',
      '09:30',
    )).resolves.toBeNull();
    expect(mockNotifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  test('reuses a reconciliation permission check without another native lookup', async () => {
    await expect(scheduleClientAlarm(
      'client-1',
      'Cliente',
      'Direccion',
      '09:30',
      { permissionAlreadyChecked: true },
    )).resolves.toBeInstanceOf(Date);

    expect(mockNotifee.getNotificationSettings).not.toHaveBeenCalled();
    expect(mockNotifee.createTriggerNotification).toHaveBeenCalledTimes(1);
  });

  test('never falls back to a recurring day when a supplied specific date is invalid', async () => {
    await expect(scheduleClientAlarm(
      'client-1',
      'Cliente',
      'Direccion',
      '09:30',
      {
        targetDay: 'Viernes',
        specificDate: '2000-01-01',
        permissionAlreadyChecked: true,
      },
    )).resolves.toBeNull();

    expect(mockNotifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  test('schedules a biweekly alarm on the next visit, not this weekday', async () => {
    const fireAt = await scheduleClientAlarm(
      'client-1',
      'Cliente',
      'Direccion',
      '08:00',
      {
        targetDay: 'Sábado',
        nextVisitDate: '2099-12-18',
        intervalWeeks: 2,
        permissionAlreadyChecked: true,
      },
    );

    expect(fireAt).toBeInstanceOf(Date);
    expect(fireAt!.getFullYear()).toBe(2099);
    expect(fireAt!.getMonth()).toBe(11);
    expect(fireAt!.getDate()).toBe(18);
    expect(fireAt!.getHours()).toBe(8);
    const trigger = mockNotifee.createTriggerNotification.mock.calls[0][1];
    expect(trigger.timestamp).toBe(fireAt!.getTime());
    const payload = mockNotifee.createTriggerNotification.mock.calls[0][0];
    expect(payload.data.alarmNextVisitDate).toBe('2099-12-18');
    expect(payload.data.alarmIntervalWeeks).toBe('2');
    expect(payload.data.alarmScheduledFor).toBe(String(fireAt!.getTime()));
    expect(payload.android.smallIcon).toBe('ic_notification');
  });

  test('mirrors the exact future one-shot instant and rejects it after it expires', async () => {
    const scheduledFor = new Date('2099-12-18T08:00:00').getTime();
    await expect(scheduleClientAlarm(
      'client-1',
      'Cliente',
      'Direccion',
      '08:00',
      { scheduledFor, permissionAlreadyChecked: true },
    )).resolves.toEqual(new Date(scheduledFor));

    expect(mockNotifee.createTriggerNotification.mock.calls[0][1].timestamp).toBe(scheduledFor);
    jest.clearAllMocks();
    await expect(scheduleClientAlarm(
      'client-1',
      'Cliente',
      'Direccion',
      '08:00',
      { scheduledFor: 1, permissionAlreadyChecked: true },
    )).resolves.toBeNull();
    expect(mockNotifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  test('does not collapse a past nextVisitDate to the upcoming weekday', async () => {
    await expect(scheduleClientAlarm(
      'client-1',
      'Cliente',
      'Direccion',
      '08:00',
      {
        targetDay: 'Sábado',
        nextVisitDate: '2000-01-01',
        intervalWeeks: 2,
        permissionAlreadyChecked: true,
      },
    )).resolves.toBeNull();
    expect(mockNotifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  test('returns true on cancellation and propagates native cancellation failures', async () => {
    await expect(cancelClientAlarm('client-1')).resolves.toBe(true);
    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith('alarm-client-1');

    const nativeError = new Error('native cancel failed');
    mockNotifee.cancelTriggerNotification.mockRejectedValueOnce(nativeError);
    await expect(cancelClientAlarm('client-1')).rejects.toBe(nativeError);
    expect(reportError).toHaveBeenCalledWith(nativeError, 'cancelClientAlarm error');
  });

  test('rolls back the local trigger when the Firestore alarm write fails', async () => {
    const firestoreError = new Error('firestore unavailable');
    const persist = jest.fn(async () => { throw firestoreError; });
    const rollback = jest.fn(async () => true);

    await expect(persistAlarmOrRollbackTrigger(persist, rollback)).rejects.toBe(firestoreError);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test('restores the previous trigger after a cancel-first mutation fails', async () => {
    const writeError = new Error('firestore unavailable');
    const mutate = jest.fn(async () => { throw writeError; });
    const snapshot = {
      clientId: 'client-1',
      clientName: 'Cliente',
      address: 'Direccion',
      time: '09:30',
      targetDay: 'Viernes',
    };

    await expect(cancelAlarmsThenMutate([snapshot], mutate)).rejects.toBe(writeError);
    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith('alarm-client-1');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mockNotifee.createTriggerNotification).toHaveBeenCalledTimes(1);
  });

  test('does not mutate shared state when cancellation fails and still attempts restoration', async () => {
    const cancelError = new Error('native cancel failed');
    mockNotifee.cancelTriggerNotification.mockRejectedValueOnce(cancelError);
    const mutate = jest.fn(async () => undefined);
    const snapshot = {
      clientId: 'client-1',
      clientName: 'Cliente',
      address: '',
      time: '09:30',
      targetDay: 'Viernes',
    };

    await expect(cancelAlarmsThenMutate([snapshot], mutate)).rejects.toBe(cancelError);
    expect(mutate).not.toHaveBeenCalled();
    expect(mockNotifee.createTriggerNotification).toHaveBeenCalledTimes(1);
  });

  test('restores an overwritten previous trigger after alarm persistence fails', async () => {
    const firestoreError = new Error('firestore unavailable');
    const persist = jest.fn(async () => { throw firestoreError; });
    const rollbackReplacement = jest.fn(async () => true);
    const restorePrevious = jest.fn(async () => undefined);

    await expect(persistAlarmOrRollbackTrigger(
      persist,
      rollbackReplacement,
      restorePrevious,
    )).rejects.toBe(firestoreError);
    expect(rollbackReplacement).toHaveBeenCalledTimes(1);
    expect(restorePrevious).toHaveBeenCalledTimes(1);
  });

  test('serializes compound alarm changes for the same client', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = runSerializedAlarmMutation('client-1', async () => {
      events.push('first-start');
      firstStarted();
      await firstGate;
      events.push('first-end');
    });
    await firstStartedPromise;
    const second = runSerializedAlarmMutation('client-1', async () => {
      events.push('second-start');
    });
    await Promise.resolve();
    expect(events).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  test('sign-out cleanup removes the previous owner and legacy alarms only', async () => {
    mockNotifee.getTriggerNotifications.mockResolvedValue([
      { notification: { id: 'alarm-old', data: { clientId: 'old', alarmOwnerUid: 'user-old' } } },
      { notification: { id: 'alarm-new', data: { clientId: 'new', alarmOwnerUid: 'user-new' } } },
      { notification: { id: 'alarm-legacy', data: { clientId: 'legacy' } } },
    ]);

    await cancelScheduledAlarmsForOwner('user-old', true);

    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith('alarm-old');
    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith('alarm-legacy');
    expect(mockNotifee.cancelTriggerNotification).not.toHaveBeenCalledWith('alarm-new');
  });

  test('login sweep removes foreign owners and unknown legacy alarms retryably', async () => {
    mockNotifee.getTriggerNotifications.mockResolvedValue([
      { notification: { id: 'alarm-old', data: { clientId: 'old', alarmOwnerUid: 'user-old' } } },
      { notification: { id: 'alarm-current', data: { clientId: 'current', alarmOwnerUid: 'user-new' } } },
      { notification: { id: 'alarm-known-legacy', data: { clientId: 'known-legacy' } } },
      { notification: { id: 'alarm-unknown-legacy', data: { clientId: 'unknown-legacy' } } },
    ]);

    await cancelForeignScheduledAlarms('user-new', new Set(['known-legacy']));

    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith('alarm-old');
    expect(mockNotifee.cancelTriggerNotification).toHaveBeenCalledWith('alarm-unknown-legacy');
    expect(mockNotifee.cancelTriggerNotification).not.toHaveBeenCalledWith('alarm-current');
    expect(mockNotifee.cancelTriggerNotification).not.toHaveBeenCalledWith('alarm-known-legacy');
  });
});
