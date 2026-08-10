import { millisecondsUntilNextLocalDay, nextLocalDateKey } from '../localDayClock';

describe('millisecondsUntilNextLocalDay', () => {
  test('targets the immediate local-midnight boundary', () => {
    const justBeforeMidnight = new Date(2026, 6, 28, 23, 59, 59, 500);

    expect(millisecondsUntilNextLocalDay(justBeforeMidnight)).toBe(500);
  });

  test('uses the next local calendar day rather than a UTC boundary', () => {
    const localEvening = new Date(2026, 6, 28, 21, 0, 0, 0);

    expect(millisecondsUntilNextLocalDay(localEvening)).toBe(3 * 60 * 60 * 1000);
  });
});

describe('nextLocalDateKey', () => {
  test('advances across month and year boundaries using the local calendar', () => {
    expect(nextLocalDateKey('2026-08-31')).toBe('2026-09-01');
    expect(nextLocalDateKey('2026-12-31')).toBe('2027-01-01');
  });

  test('handles leap days and rejects impossible date keys', () => {
    expect(nextLocalDateKey('2028-02-28')).toBe('2028-02-29');
    expect(nextLocalDateKey('2026-02-30')).toBe('');
    expect(nextLocalDateKey('10/08/2026')).toBe('');
  });
});
