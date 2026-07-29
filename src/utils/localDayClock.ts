/**
 * Delay until the next calendar day in the device's local timezone.
 *
 * Building the boundary with setHours keeps the timer aligned with local
 * midnight, including timezone offset or daylight-saving changes.
 */
export const millisecondsUntilNextLocalDay = (now: Date = new Date()): number => {
  const nextLocalMidnight = new Date(now);
  nextLocalMidnight.setHours(24, 0, 0, 0);
  return Math.max(0, nextLocalMidnight.getTime() - now.getTime());
};
