import { millisecondsUntilNextLocalDay } from '../localDayClock';

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
