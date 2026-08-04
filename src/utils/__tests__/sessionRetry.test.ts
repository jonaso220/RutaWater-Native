import { planSessionRetry } from '../sessionRetry';

describe('planSessionRetry', () => {
  test('stops after five failed requests instead of retrying forever', () => {
    let attempts = 0;
    const scheduleDecisions: boolean[] = [];
    const delays: number[] = [];

    for (let failure = 0; failure < 5; failure += 1) {
      const plan = planSessionRetry(attempts, 5);
      attempts = plan.attemptCount;
      scheduleDecisions.push(plan.shouldSchedule);
      delays.push(plan.delayMs);
    }

    expect(attempts).toBe(5);
    expect(scheduleDecisions).toEqual([true, true, true, true, false]);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(planSessionRetry(attempts, 5)).toEqual({
      attemptCount: 5,
      shouldSchedule: false,
      delayMs: 30_000,
    });
  });

  test('a caller can explicitly reset the foreground/login budget to zero', () => {
    expect(planSessionRetry(0, 5)).toEqual({
      attemptCount: 1,
      shouldSchedule: true,
      delayMs: 1_000,
    });
  });
});
