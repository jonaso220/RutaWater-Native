import { resolveAlarmFireDate } from '../scheduling';
import { getAlarmScheduleIssue } from '../helpers';
import type { Client } from '../../types';

// Wednesday 2026-03-04 10:00:00 local time.
const FAKE_NOW = new Date(2026, 2, 4, 10, 0, 0, 0);

beforeEach(() => {
  jest.useFakeTimers({ now: FAKE_NOW.getTime() });
});

afterEach(() => {
  jest.useRealTimers();
});

const client = (overrides: Partial<Client>): Client => ({
  id: 'c1',
  name: 'Cliente',
  freq: 'weekly',
  visitDay: 'Miércoles',
  products: {},
  ...overrides,
} as Client);

describe('resolveAlarmFireDate', () => {
  test('keeps the scheduler contract for each kind of schedule', () => {
    expect(resolveAlarmFireDate('99:00')).toBeNull();
    expect(resolveAlarmFireDate('09:30', { specificDate: '2026-03-01' })).toBeNull();
    expect(resolveAlarmFireDate('09:30', { specificDate: '2026-03-04' })).toBeNull();
    expect(resolveAlarmFireDate('11:00', { specificDate: '2026-03-04' }))
      .toEqual(new Date(2026, 2, 4, 11, 0, 0, 0));
    expect(resolveAlarmFireDate('09:30', { scheduledFor: FAKE_NOW.getTime() - 1 })).toBeNull();
    expect(resolveAlarmFireDate('09:30', { nextVisitDate: '2026-03-04', intervalWeeks: 1 }))
      .toEqual(new Date(2026, 2, 11, 9, 30, 0, 0));
    expect(resolveAlarmFireDate('09:30')).toEqual(new Date(2026, 2, 5, 9, 30, 0, 0));
  });
});

describe('getAlarmScheduleIssue', () => {
  test('a one-time order with a past date explains the date, not permissions', () => {
    const past = client({ freq: 'once', specificDate: '2026-02-20', visitDay: 'Viernes' });
    expect(getAlarmScheduleIssue(past, '19:30', 'Martes')).toBe('date-passed');
  });

  test('a one-time order for today only fails when the chosen time passed', () => {
    const today = client({ freq: 'once', specificDate: '2026-03-04' });
    expect(getAlarmScheduleIssue(today, '09:00', 'Miércoles')).toBe('time-passed');
    expect(getAlarmScheduleIssue(today, '18:00', 'Miércoles')).toBeNull();
  });

  test('future one-time and recurring clients can always be scheduled', () => {
    expect(getAlarmScheduleIssue(client({ freq: 'once', specificDate: '2026-03-10' }), '09:00')).toBeNull();
    expect(getAlarmScheduleIssue(client({ freq: 'weekly' }), '09:00', 'Miércoles')).toBeNull();
  });
});
