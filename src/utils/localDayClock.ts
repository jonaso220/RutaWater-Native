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

const formatLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Return the next local calendar date for a valid YYYY-MM-DD key. */
export const nextLocalDateKey = (dateKey: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Noon avoids edge cases around timezone transitions at local midnight.
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return '';

  date.setDate(date.getDate() + 1);
  return formatLocalDateKey(date);
};
