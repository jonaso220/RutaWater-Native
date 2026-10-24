import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { useTranslation } from 'react-i18next';
import { Client, Debt } from '../types';
import { reportError } from '../lib/crashReporting';
import {
  PAYMENT_REMINDER_KIND,
  PaymentReminder,
  syncPaymentReminders,
} from '../services/notifications';
import {
  buildClientIdentityIndex,
  getRelatedRecordStableClientId,
  getStableClientId,
} from '../utils/clientIdentity';
import { isValidPaymentSchedule, toDateKey, upcomingReminderDays } from '../utils/paymentSchedule';
import { formatMoney } from '../utils/format';

const REMINDER_HOUR = 9;
const HORIZON_DAYS = 62;
const NAMES_IN_BODY = 4;
// The notification that launched the app is handled once, not on every remount.
let initialNotificationHandled = false;

/**
 * Agenda en este teléfono el aviso «Hoy toca cobrar» para los clientes con
 * deuda que tienen fecha de cobro y «Recordarme». Solo avisa a quien usa la
 * app: al cliente no se le manda nada. En un reparto compartido, solo en los
 * teléfonos de quien marcó «Recordarme».
 */
export const usePaymentReminders = (
  clients: Client[],
  debts: Debt[],
  uid: string | undefined,
  onOpen: () => void,
) => {
  const { t } = useTranslation();
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const entries = useMemo(() => {
    const index = buildClientIdentityIndex(clients);
    const totals = new Map<string, number>();
    debts.forEach((debt) => {
      const key = getRelatedRecordStableClientId(debt, index);
      totals.set(key, (totals.get(key) || 0) + (Number(debt.amount) || 0));
    });
    const seen = new Set<string>();
    return clients.flatMap((client) => {
      const key = getStableClientId(client);
      const schedule = client.paymentSchedule;
      const total = totals.get(key) || 0;
      if (seen.has(key) || !isValidPaymentSchedule(schedule) || !schedule.remind || total <= 0) return [];
      if (schedule.remindBy && schedule.remindBy !== uid) return [];
      seen.add(key);
      return [{ name: client.name || '', total, schedule }];
    });
  }, [clients, debts, uid]);
  // Clients change on every Listo; only resync when what the reminders show changed.
  const signature = useMemo(() => JSON.stringify(entries), [entries]);

  const buildReminders = useRef<() => PaymentReminder[]>(() => []);
  buildReminders.current = () => {
    const now = new Date();
    const byDay = new Map<string, { day: Date; people: typeof entries }>();
    entries.forEach((entry) => {
      upcomingReminderDays(entry.schedule, now, REMINDER_HOUR, HORIZON_DAYS).forEach((day) => {
        const key = toDateKey(day);
        const bucket = byDay.get(key) || { day, people: [] };
        bucket.people.push(entry);
        byDay.set(key, bucket);
      });
    });
    return Array.from(byDay.entries()).map(([date, { day, people }]) => {
      const sorted = [...people].sort((a, b) => b.total - a.total);
      const shown = sorted.slice(0, NAMES_IN_BODY).map((p) => `${p.name} · ${formatMoney(p.total)}`);
      const rest = sorted.length - shown.length;
      const body = rest > 0
        ? `${shown.join(', ')} ${t('paymentSchedule.notificationMore', { count: rest })}`
        : shown.join(', ');
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), REMINDER_HOUR, 0, 0);
      return { date, timestamp: at.getTime(), title: t('paymentSchedule.notificationTitle'), body };
    });
  };

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      syncPaymentReminders(buildReminders.current())
        .catch((e) => reportError(e, 'syncPaymentReminders error'));
    };
    // Small delay: a burst of snapshot updates schedules once.
    const timer = setTimeout(sync, 1500);
    // Monthly ranges roll forward: recompute when the app comes back.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [signature, t]);

  // Tapping the reminder opens Deudas.
  useEffect(() => {
    const isPaymentReminder = (data?: Record<string, unknown>) => data?.kind === PAYMENT_REMINDER_KIND;
    if (!initialNotificationHandled) {
      initialNotificationHandled = true;
      notifee.getInitialNotification()
        .then((initial) => {
          if (isPaymentReminder(initial?.notification?.data)) onOpenRef.current();
        })
        .catch(() => {});
    }
    return notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS && isPaymentReminder(detail.notification?.data)) onOpenRef.current();
    });
  }, []);
};
