import type { TFunction } from 'i18next';
import { PaymentSchedule } from '../types';
import { PaymentScheduleState, parseDateKey } from './paymentSchedule';

/** «15 nov» */
export const formatPaymentDate = (t: TFunction, key: string): string => {
  const date = parseDateKey(key);
  if (!date) return key;
  const months = t('monthNamesShort', { returnObjects: true }) as string[];
  return `${date.getDate()} ${(months[date.getMonth()] || '').toLowerCase()}`;
};

/** Rango sin repetir el mes: «24 al 27 oct»; si cambia de mes, «28 oct al 3 nov». */
export const formatPaymentRange = (t: TFunction, from: string, to: string) => {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  const sameMonth = !!start && !!end
    && start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  return {
    from: sameMonth ? String(start!.getDate()) : formatPaymentDate(t, from),
    to: formatPaymentDate(t, to),
  };
};

/** Cuándo paga, corto: «Del 1 al 10 de cada mes», «15 nov», «15 al 20 nov». */
export const paymentScheduleLabel = (t: TFunction, schedule: PaymentSchedule): string => {
  if (schedule.kind === 'monthly') {
    return schedule.fromDay === schedule.toDay
      ? t('paymentSchedule.chipMonthlySame', { day: schedule.fromDay })
      : t('paymentSchedule.chipMonthly', { from: schedule.fromDay, to: schedule.toDay });
  }
  return schedule.to
    ? t('paymentSchedule.chipRange', formatPaymentRange(t, schedule.from, schedule.to))
    : formatPaymentDate(t, schedule.from);
};

/** Estado al lado de la fecha: «Toca cobrar», «en 3 días», «venció hace 2 días». */
export const paymentStatusLabel = (t: TFunction, state: PaymentScheduleState): string => {
  switch (state.status) {
    case 'now':
      return state.days === 0
        ? t('paymentSchedule.statusLastDay')
        : t('paymentSchedule.statusNow');
    case 'upcoming':
      return state.days === 1
        ? t('paymentSchedule.statusTomorrow')
        : t('paymentSchedule.statusUpcoming', { count: state.days });
    case 'overdue':
      return t('paymentSchedule.statusOverdue', { count: state.days });
    default:
      return '';
  }
};
