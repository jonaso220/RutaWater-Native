import { PaymentSchedule } from '../types';

// Fechas de cobro de Deudas. Todo se calcula en días locales (medianoche),
// así un rango «del 1 al 10» incluye el 10 entero.

export type PaymentStatus = 'now' | 'upcoming' | 'overdue' | 'none';

export interface PaymentWindow {
  start: Date;
  end: Date;
}

export interface PaymentScheduleState {
  status: PaymentStatus;
  window: PaymentWindow | null;
  /** Días hasta que empieza (upcoming), hasta que termina (now) o de atraso (overdue). */
  days: number;
}

const DAY_MS = 86400000;

export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const toDateKey = (date: Date): string => {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

export const parseDateKey = (key: string | undefined): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetween = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);

/** Día del mes acotado al largo del mes: «el 31» en noviembre es el 30. */
const monthDay = (year: number, month: number, day: number): Date => {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(Math.max(day, 1), last));
};

/** Ventana mensual que empieza en el mes indicado (puede terminar el mes siguiente: «del 25 al 5»). */
const monthlyWindow = (schedule: { fromDay: number; toDay: number }, year: number, month: number): PaymentWindow => {
  const start = monthDay(year, month, schedule.fromDay);
  const wraps = schedule.toDay < schedule.fromDay;
  const end = wraps ? monthDay(year, month + 1, schedule.toDay) : monthDay(year, month, schedule.toDay);
  return { start, end };
};

export const isValidPaymentSchedule = (schedule: PaymentSchedule | null | undefined): schedule is PaymentSchedule => {
  if (!schedule) return false;
  if (schedule.kind === 'monthly') {
    return [schedule.fromDay, schedule.toDay].every((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  }
  if (schedule.kind === 'date') {
    const from = parseDateKey(schedule.from);
    const to = schedule.to ? parseDateKey(schedule.to) : from;
    return !!from && !!to && to.getTime() >= from.getTime();
  }
  return false;
};

/**
 * En qué punto está el cobro hoy. Un mensual pasa a «venció» solo si la deuda
 * más vieja ya existía cuando terminó el último rango: una deuda de después se
 * cobra en el rango que viene.
 */
export const getPaymentScheduleState = (
  schedule: PaymentSchedule | null | undefined,
  now: Date = new Date(),
  oldestDebtAt?: Date | null,
): PaymentScheduleState => {
  if (!isValidPaymentSchedule(schedule)) return { status: 'none', window: null, days: 0 };
  const today = startOfDay(now);

  if (schedule.kind === 'date') {
    const start = parseDateKey(schedule.from)!;
    const end = parseDateKey(schedule.to) || start;
    const window = { start, end };
    if (today < start) return { status: 'upcoming', window, days: daysBetween(today, start) };
    if (today <= end) return { status: 'now', window, days: daysBetween(today, end) };
    return { status: 'overdue', window, days: daysBetween(end, today) };
  }

  const year = today.getFullYear();
  const month = today.getMonth();
  // El rango que empezó el mes pasado puede seguir abierto («del 25 al 5»).
  const candidates = [-1, 0, 1].map((offset) => monthlyWindow(schedule, year, month + offset));
  const open = candidates.find((w) => w.start <= today && today <= w.end);
  if (open) return { status: 'now', window: open, days: daysBetween(today, open.end) };
  const next = candidates.find((w) => w.start > today)!;
  const last = [...candidates].reverse().find((w) => w.end < today);
  const oldest = oldestDebtAt ? startOfDay(oldestDebtAt) : null;
  if (last && oldest && oldest <= last.end) {
    return { status: 'overdue', window: last, days: daysBetween(last.end, today) };
  }
  return { status: 'upcoming', window: next, days: daysBetween(today, next.start) };
};

/** Orden «Fecha de cobro»: vencidos (el más atrasado primero), los de ahora, los próximos y al final los sin fecha. */
export const paymentSortKey = (state: PaymentScheduleState): [number, number] => {
  switch (state.status) {
    case 'overdue': return [0, -state.days];
    case 'now': return [1, state.days];
    case 'upcoming': return [2, state.days];
    default: return [3, 0];
  }
};

export const comparePaymentStates = (a: PaymentScheduleState, b: PaymentScheduleState): number => {
  const [ga, va] = paymentSortKey(a);
  const [gb, vb] = paymentSortKey(b);
  return ga - gb || va - vb;
};

/** Próximos días en que empieza el cobro, desde mañana o desde hoy si todavía no pasó la hora del aviso. */
export const upcomingReminderDays = (
  schedule: PaymentSchedule | null | undefined,
  now: Date,
  reminderHour: number,
  horizonDays: number,
): Date[] => {
  if (!isValidPaymentSchedule(schedule) || !schedule.remind) return [];
  const firstDay = now.getHours() < reminderHour ? startOfDay(now) : new Date(startOfDay(now).getTime() + DAY_MS);
  const lastDay = new Date(startOfDay(now).getFullYear(), now.getMonth(), now.getDate() + horizonDays);
  const inRange = (d: Date) => d >= firstDay && d <= lastDay;
  if (schedule.kind === 'date') {
    const start = parseDateKey(schedule.from)!;
    return inRange(start) ? [start] : [];
  }
  const days: Date[] = [];
  for (let offset = 0; offset <= Math.ceil(horizonDays / 28) + 1; offset += 1) {
    const { start } = monthlyWindow(schedule, firstDay.getFullYear(), firstDay.getMonth() + offset);
    if (inRange(start)) days.push(start);
  }
  return days;
};
