import {
  comparePaymentStates,
  getPaymentScheduleState,
  isValidPaymentSchedule,
  toDateKey,
  upcomingReminderDays,
} from '../paymentSchedule';
import { PaymentSchedule } from '../../types';

const monthly = (fromDay: number, toDay: number, remind = true): PaymentSchedule => ({ kind: 'monthly', fromDay, toDay, remind });
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('Fechas de cobro', () => {
  it('«del 1 al 10» toca ahora el 10 entero y queda en días hasta el final', () => {
    const state = getPaymentScheduleState(monthly(1, 10), at(2026, 11, 10, 23));
    expect(state.status).toBe('now');
    expect(state.days).toBe(0);
  });

  it('después del rango: vence solo si la deuda ya estaba', () => {
    const vieja = getPaymentScheduleState(monthly(1, 10), at(2026, 11, 14), at(2026, 11, 3));
    expect(vieja).toMatchObject({ status: 'overdue', days: 4 });
    const nueva = getPaymentScheduleState(monthly(1, 10), at(2026, 11, 14), at(2026, 11, 12));
    expect(nueva.status).toBe('upcoming');
    expect(toDateKey(nueva.window!.start)).toBe('2026-12-01');
    expect(nueva.days).toBe(17);
  });

  it('rango que cruza de mes («del 25 al 5») y el 31 en meses cortos', () => {
    const cruza = getPaymentScheduleState(monthly(25, 5), at(2026, 12, 3));
    expect(cruza.status).toBe('now');
    expect(toDateKey(cruza.window!.start)).toBe('2026-11-25');
    const fin = getPaymentScheduleState(monthly(28, 31), at(2027, 2, 28));
    expect(fin.status).toBe('now');
    expect(toDateKey(fin.window!.end)).toBe('2027-02-28');
  });

  it('fecha puntual o rango puntual', () => {
    const fecha: PaymentSchedule = { kind: 'date', from: '2026-11-15', to: '2026-11-20', remind: false };
    expect(getPaymentScheduleState(fecha, at(2026, 11, 13))).toMatchObject({ status: 'upcoming', days: 2 });
    expect(getPaymentScheduleState(fecha, at(2026, 11, 20))).toMatchObject({ status: 'now', days: 0 });
    expect(getPaymentScheduleState(fecha, at(2026, 11, 22))).toMatchObject({ status: 'overdue', days: 2 });
    expect(isValidPaymentSchedule({ kind: 'date', from: '2026-11-20', to: '2026-11-15', remind: false })).toBe(false);
  });

  it('ordena vencidos, ahora, próximos y sin fecha', () => {
    const now = at(2026, 11, 14);
    const states = [
      getPaymentScheduleState(null, now),
      getPaymentScheduleState(monthly(20, 25), now),
      getPaymentScheduleState(monthly(10, 15), now),
      getPaymentScheduleState(monthly(1, 5), now, at(2026, 10, 20)),
    ];
    expect([...states].sort(comparePaymentStates).map((s) => s.status)).toEqual(['overdue', 'now', 'upcoming', 'none']);
  });

  it('avisos: el día que empieza, solo si pidió recordatorio', () => {
    expect(upcomingReminderDays(monthly(1, 10), at(2026, 11, 1, 8), 9, 45).map(toDateKey)).toEqual(['2026-11-01', '2026-12-01']);
    expect(upcomingReminderDays(monthly(1, 10), at(2026, 11, 1, 10), 9, 45).map(toDateKey)).toEqual(['2026-12-01']);
    expect(upcomingReminderDays(monthly(1, 10, false), at(2026, 11, 1, 8), 9, 45)).toEqual([]);
    expect(upcomingReminderDays({ kind: 'date', from: '2026-11-15', remind: true }, at(2026, 11, 1), 9, 45).map(toDateKey)).toEqual(['2026-11-15']);
  });
});
