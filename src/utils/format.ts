import i18n from '../i18n';
import { parseDate } from './helpers';

// Formateadores compartidos de display. Toda fecha/monto visible al usuario
// debe pasar por acá — no armar `$${x.toLocaleString()}` ni
// toLocaleDateString ad-hoc en las pantallas.

// Locale de fechas según el idioma de la APP (no el del dispositivo).
const DATE_LOCALES: Record<string, string> = { es: 'es-ES', en: 'en-US', pt: 'pt-BR' };
const dateLocale = (): string => DATE_LOCALES[i18n.language] || 'es-ES';

// Montos siempre en convención rioplatense (punto de miles, coma decimal):
// es la misma que interpreta parseMoneyInput al tipear, y con el locale del
// dispositivo el display y el parseo divergían.
export const formatMoney = (n: number | undefined | null): string => {
  const value = Number(n) || 0;
  return `$${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
};

// "5 jul 2026". Acepta Timestamp/Date/{seconds}/string vía parseDate; '' si
// no hay fecha válida.
export const formatShortDate = (val: any): string => {
  const date = parseDate(val);
  if (!date) return '';
  return date.toLocaleDateString(dateLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

// "5 jul, 14:30" — variante con hora (transferencias).
export const formatShortDateTime = (val: any): string => {
  const date = parseDate(val);
  if (!date) return '';
  return date.toLocaleDateString(dateLocale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};
