// Pure date/time helpers used by notifications scheduling. Kept here (no
// imports of notifee or react-native) so they can be unit-tested without
// mocking native modules.

const SPANISH_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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

export const occurrenceForSpecificDate = (
  specificDate: string,
  hours: number,
  minutes: number,
): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(specificDate);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const target = new Date(year, month, day, hours, minutes, 0, 0);
  if (Number.isNaN(target.getTime())) return null;
  if (target.getTime() <= Date.now()) return null;
  return target;
};
