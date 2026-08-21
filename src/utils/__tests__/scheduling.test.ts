import {
  parseTime,
  nextOccurrence,
  nextOccurrenceForDay,
  occurrenceForSpecificDate,
  occurrenceForVisitDate,
  isValidCalendarDate,
  isValidScheduleDate,
} from '../scheduling';

// Wednesday 2026-03-04 10:00:00 local time. Used as the synthetic "now" so
// date math is deterministic regardless of when the suite runs.
const FAKE_NOW = new Date(2026, 2, 4, 10, 0, 0, 0);

beforeEach(() => {
  jest.useFakeTimers({ now: FAKE_NOW.getTime() });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('parseTime', () => {
  test('parses two-digit HH:MM', () => {
    expect(parseTime('09:30')).toEqual({ hours: 9, minutes: 30 });
    expect(parseTime('23:59')).toEqual({ hours: 23, minutes: 59 });
    expect(parseTime('00:00')).toEqual({ hours: 0, minutes: 0 });
  });

  test('parses single-digit H:M', () => {
    expect(parseTime('9:5')).toEqual({ hours: 9, minutes: 5 });
    expect(parseTime('1:0')).toEqual({ hours: 1, minutes: 0 });
  });

  test('rejects invalid formats', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('9:30am')).toBeNull();
    expect(parseTime('9-30')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('09:30:00')).toBeNull();
  });

  test('rejects out-of-range hours/minutes', () => {
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('25:30')).toBeNull();
    expect(parseTime('10:60')).toBeNull();
    expect(parseTime('10:99')).toBeNull();
  });
});

describe('isValidCalendarDate', () => {
  test('accepts real calendar dates, including a leap day', () => {
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
    expect(isValidCalendarDate('2026-02-28')).toBe(true);
    expect(isValidCalendarDate('2026-04-30')).toBe(true);
  });

  test('rejects impossible dates instead of allowing JavaScript rollover', () => {
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
    expect(isValidCalendarDate('2026-02-31')).toBe(false);
    expect(isValidCalendarDate('2026-04-31')).toBe(false);
  });

  test('rejects invalid ranges and non-ISO formats', () => {
    expect(isValidCalendarDate('2026-00-10')).toBe(false);
    expect(isValidCalendarDate('2026-13-10')).toBe(false);
    expect(isValidCalendarDate('2026-01-00')).toBe(false);
    expect(isValidCalendarDate('2026-2-01')).toBe(false);
    expect(isValidCalendarDate('2026/02/01')).toBe(false);
  });
});

describe('isValidScheduleDate', () => {
  test('requires a real date for one-time visits', () => {
    expect(isValidScheduleDate('once', '')).toBe(false);
    expect(isValidScheduleDate('once', '2026-02-31')).toBe(false);
    expect(isValidScheduleDate('once', '2026-02-28')).toBe(true);
  });

  test('allows periodic schedules without a date but validates one when supplied', () => {
    expect(isValidScheduleDate('weekly', '')).toBe(true);
    expect(isValidScheduleDate('on_demand', '')).toBe(true);
    expect(isValidScheduleDate('weekly', '2026-04-31')).toBe(false);
    expect(isValidScheduleDate('weekly', '2026-04-30')).toBe(true);
  });
});

describe('nextOccurrence', () => {
  test('returns today when target time is still ahead', () => {
    // FAKE_NOW is 10:00 → target 14:30 same day
    const result = nextOccurrence(14, 30);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2);
    expect(result.getDate()).toBe(4);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  test('rolls to tomorrow when target time is in the past today', () => {
    // FAKE_NOW is 10:00 → target 08:00 same day → tomorrow 08:00
    const result = nextOccurrence(8, 0);
    expect(result.getDate()).toBe(5);
    expect(result.getHours()).toBe(8);
  });

  test('rolls to tomorrow when target time equals now exactly', () => {
    // <=  comparison: same instant should not schedule "now", must be future
    const result = nextOccurrence(10, 0);
    expect(result.getDate()).toBe(5);
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(0);
  });
});

describe('nextOccurrenceForDay', () => {
  test('same weekday, time still ahead — schedules today', () => {
    // FAKE_NOW is Wednesday 10:00 → Miércoles 15:00 same day
    const result = nextOccurrenceForDay('Miércoles', 15, 0);
    expect(result.getDate()).toBe(4);
    expect(result.getHours()).toBe(15);
  });

  test('same weekday, time already past — schedules next week', () => {
    // FAKE_NOW is Wednesday 10:00 → Miércoles 08:00 → next Wed
    const result = nextOccurrenceForDay('Miércoles', 8, 0);
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(8);
  });

  test('weekday ahead in the same week', () => {
    // Wednesday → Friday is +2 days
    const result = nextOccurrenceForDay('Viernes', 9, 0);
    expect(result.getDate()).toBe(6);
    expect(result.getHours()).toBe(9);
  });

  test('weekday behind in the week wraps to next week', () => {
    // Wednesday → Monday wraps forward 5 days
    const result = nextOccurrenceForDay('Lunes', 9, 0);
    expect(result.getDate()).toBe(9);
    expect(result.getHours()).toBe(9);
  });

  test('Sunday boundary (Domingo is index 0)', () => {
    // Wednesday → Sunday is +4 days
    const result = nextOccurrenceForDay('Domingo', 11, 0);
    expect(result.getDate()).toBe(8);
  });

  test('falls back to nextOccurrence when day name is unknown', () => {
    // Unknown day → behaves like nextOccurrence(hours, minutes). 14:00 still
    // ahead today, so should land same day.
    const result = nextOccurrenceForDay('Marteddì', 14, 0);
    expect(result.getDate()).toBe(4);
    expect(result.getHours()).toBe(14);
  });
});

describe('occurrenceForVisitDate', () => {
  test('uses the visit calendar day, not the next weekday', () => {
    // FAKE_NOW is Wednesday 10:00. Next Saturday is the 7th; a biweekly
    // visit two weeks out is Saturday the 21st.
    const result = occurrenceForVisitDate('2026-03-21', 8, 0, 2);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(2);
    expect(result!.getDate()).toBe(21);
    expect(result!.getHours()).toBe(8);
  });

  test('advances whole cycles when the visit-day time already passed', () => {
    // Wednesday 08:00 already passed at 10:00. Weekly → next Wednesday.
    const weekly = occurrenceForVisitDate('2026-03-04', 8, 0, 1);
    expect(weekly!.getDate()).toBe(11);
    expect(weekly!.getHours()).toBe(8);

    // Biweekly skips the in-between Wednesday.
    const biweekly = occurrenceForVisitDate('2026-03-04', 8, 0, 2);
    expect(biweekly!.getDate()).toBe(18);
  });

  test('keeps today when the visit time is still ahead', () => {
    const result = occurrenceForVisitDate(new Date(2026, 2, 4), 15, 0, 2);
    expect(result!.getDate()).toBe(4);
    expect(result!.getHours()).toBe(15);
  });

  test('rejects malformed visit dates', () => {
    expect(occurrenceForVisitDate('2026-03-32', 8, 0, 1)).toBeNull();
    expect(occurrenceForVisitDate('', 8, 0, 1)).toBeNull();
  });
});

describe('occurrenceForSpecificDate', () => {
  test('returns date for valid future YYYY-MM-DD + time', () => {
    const result = occurrenceForSpecificDate('2026-03-10', 9, 30);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(2);
    expect(result!.getDate()).toBe(10);
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(30);
  });

  test('returns null for a date in the past', () => {
    // FAKE_NOW is 2026-03-04 10:00 — anything earlier should be rejected
    expect(occurrenceForSpecificDate('2026-03-04', 9, 0)).toBeNull();
    expect(occurrenceForSpecificDate('2026-03-03', 23, 0)).toBeNull();
    expect(occurrenceForSpecificDate('2025-12-31', 12, 0)).toBeNull();
  });

  test('returns null for invalid date strings', () => {
    expect(occurrenceForSpecificDate('2026-3-4', 10, 0)).toBeNull(); // not zero-padded
    expect(occurrenceForSpecificDate('2026/03/04', 10, 0)).toBeNull();
    expect(occurrenceForSpecificDate('not-a-date', 10, 0)).toBeNull();
    expect(occurrenceForSpecificDate('', 10, 0)).toBeNull();
  });

  test('rejects impossible calendar dates instead of normalizing to another day', () => {
    expect(occurrenceForSpecificDate('2026-04-31', 10, 0)).toBeNull();
    expect(occurrenceForSpecificDate('2027-02-29', 10, 0)).toBeNull();
    expect(occurrenceForSpecificDate('2026-13-01', 10, 0)).toBeNull();
    expect(occurrenceForSpecificDate('2026-00-01', 10, 0)).toBeNull();
  });

  test('today at a future time on FAKE_NOW returns same day', () => {
    // 2026-03-04 15:00 is later today
    const result = occurrenceForSpecificDate('2026-03-04', 15, 0);
    expect(result).not.toBeNull();
    expect(result!.getDate()).toBe(4);
    expect(result!.getHours()).toBe(15);
  });
});
