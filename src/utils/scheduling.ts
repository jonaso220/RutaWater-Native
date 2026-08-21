// Pure date/time helpers shared by notifications and order scheduling. Kept
// here (no imports of notifee or react-native) so they can be unit-tested
// without mocking native modules.

const SPANISH_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

const parseCalendarDateParts = (value: string): CalendarDateParts | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month, day, 12, 0, 0, 0);

  // JavaScript normalizes impossible dates (for example, 2026-02-31) into a
  // different month. Exact component comparison rejects that rollover.
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month
    || date.getDate() !== day
  ) return null;

  return { year, month, day };
};

export const isValidCalendarDate = (value: string): boolean =>
  parseCalendarDateParts(value) !== null;

// A one-time visit is not actionable without its date. Periodic and on-demand
// schedules may omit it, but whenever the parser supplies a date it must be a
// real ISO calendar day.
export const isValidScheduleDate = (
  frequency: string | undefined,
  value: string,
): boolean => value ? isValidCalendarDate(value) : frequency !== 'once';

export const parseTime = (
  time: string,
): { hours: number; minutes: number } | null => {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(time);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
};

export const nextOccurrence = (hours: number, minutes: number): Date => {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
};

export const nextOccurrenceForDay = (
  dayName: string,
  hours: number,
  minutes: number,
): Date => {
  const targetIdx = SPANISH_DAYS.indexOf(dayName);
  if (targetIdx === -1) return nextOccurrence(hours, minutes);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  let daysAhead = (targetIdx - now.getDay() + 7) % 7;
  if (daysAhead === 0 && target.getTime() <= now.getTime()) {
    daysAhead = 7;
  }
  target.setDate(target.getDate() + daysAhead);
  return target;
};

export const occurrenceForVisitDate = (
  visitDate: Date | string,
  hours: number,
  minutes: number,
  intervalWeeks = 1,
): Date | null => {
  let year: number;
  let month: number;
  let day: number;
  if (typeof visitDate === 'string') {
    const parts = parseCalendarDateParts(visitDate);
    if (!parts) return null;
    ({ year, month, day } = parts);
  } else {
    if (!(visitDate instanceof Date) || Number.isNaN(visitDate.getTime())) return null;
    year = visitDate.getFullYear();
    month = visitDate.getMonth();
    day = visitDate.getDate();
  }

  const target = new Date(year, month, day, hours, minutes, 0, 0);
  if (Number.isNaN(target.getTime())) return null;

  const stepDays = Math.max(1, intervalWeeks) * 7;
  const now = Date.now();
  for (let i = 0; i < 52 && target.getTime() <= now; i += 1) {
    target.setDate(target.getDate() + stepDays);
  }
  if (target.getTime() <= now) return null;
  return target;
};

export const occurrenceForSpecificDate = (
  specificDate: string,
  hours: number,
  minutes: number,
): Date | null => {
  const parts = parseCalendarDateParts(specificDate);
  if (!parts) return null;
  const { year, month, day } = parts;
  const target = new Date(year, month, day, hours, minutes, 0, 0);
  if (Number.isNaN(target.getTime())) return null;
  // Keep guarding the final timestamp as hours/minutes are supplied separately.
  if (
    target.getFullYear() !== year
    || target.getMonth() !== month
    || target.getDate() !== day
  ) return null;
  if (target.getTime() <= Date.now()) return null;
  return target;
};
