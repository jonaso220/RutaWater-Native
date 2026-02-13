// --- HELPERS: Ported from web app js/helpers.js ---

import { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { Client } from '../types';

// --- SANITIZATION ---

export const sanitizeString = (str: string | undefined, maxLen = 500): string => {
  if (!str) return '';
  return String(str).trim().slice(0, maxLen);
};

export const sanitizePhone = (phone: string | undefined): string => {
  if (!phone) return '';
  return String(phone).replace(/[^\d+\-\s()]/g, '').slice(0, 20);
};

export const sanitizeProductQty = (val: any): string => {
  if (!val && val !== 0) return '';
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 0 || n > 9999) return '';
  return String(n);
};

export const isSafeUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const sanitizeClientData = (data: any) => {
  const validDays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const validFreqs = ['weekly', 'biweekly', 'triweekly', 'monthly', 'once', 'on_demand'];
  const validProducts = ['b20', 'b12', 'b6', 'soda', 'bombita', 'disp_elec_new', 'disp_elec_chg', 'disp_nat'];

  const clean: any = {};
  clean.name = sanitizeString(data.name, 100);
  clean.phone = sanitizePhone(data.phone);
  clean.address = sanitizeString(data.address, 200);
  clean.notes = sanitizeString(data.notes, 500);
  clean.lat = sanitizeString(data.lat, 20);
  clean.lng = sanitizeString(data.lng, 20);
  clean.freq = validFreqs.includes(data.freq) ? data.freq : 'weekly';
  clean.visitDay = sanitizeString(data.visitDay, 20);
  clean.specificDate = sanitizeString(data.specificDate, 10);
  clean.locationInput = sanitizeString(data.locationInput, 300);
  clean.mapsLink = data.mapsLink && isSafeUrl(data.mapsLink) ? data.mapsLink : '';
  clean.visitDays = Array.isArray(data.visitDays)
    ? data.visitDays.filter((d: string) => validDays.includes(d))
    : [];
  clean.products = {} as Record<string, string>;
  validProducts.forEach(pid => {
    clean.products[pid] = data.products ? sanitizeProductQty(data.products[pid]) : '';
  });

  return clean;
};

// --- RETRY LOGIC ---

export const firestoreRetry = async <T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (attempt === maxRetries) throw e;
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries reached');
};

export const getErrorMessage = (error: any): string => {
  if (!error) return 'Ocurrió un error inesperado.';
  const code = error.code || '';
  const msg = error.message || '';
  if (code === 'permission-denied' || code === 'PERMISSION_DENIED') return 'No tenés permisos para esta acción.';
  if (code === 'not-found') return 'El registro no fue encontrado.';
  if (code === 'unavailable' || code === 'deadline-exceeded' || msg.includes('network') || msg.includes('Failed to fetch'))
    return 'Error de conexión. Verificá tu internet e intentá de nuevo.';
  return 'Ocurrió un error. Intentá de nuevo.';
};

// --- DATE HELPERS ---

export const parseDate = (val: any): Date | null => {
  if (!val) return null;
  if (val.seconds !== undefined) return new Date(val.seconds * 1000);
  return new Date(val);
};

export const normalizeText = (text: string): string => {
  if (!text) return '';
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
};

export const getDayIndex = (dayName: string): number => {
  if (!dayName) return -1;
  const normalized = normalizeText(dayName);
  const map: Record<string, number> = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  };
  return map[normalized] !== undefined ? map[normalized] : -1;
};

export const getWeekNumber = (d: Date): number => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

export const getNextVisitDate = (client: Client, forDay?: string): Date | null => {
  if (client.specificDate) return new Date(client.specificDate + 'T12:00:00');
  if (client.freq === 'once') return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayToUse = forDay || client.visitDay;
  const targetDayIndex = getDayIndex(dayToUse);
  if (targetDayIndex === -1) return null;

  const currentDayIndex = today.getDay();
  let diff = targetDayIndex - currentDayIndex;
  if (diff < 0) diff += 7;

  const nextDate = new Date(today);
  nextDate.setDate(today.getDate() + diff);

  const lastVisited = parseDate(client.lastVisited);

  let intervalWeeks = 1;
  if (client.freq === 'biweekly') intervalWeeks = 2;
  if (client.freq === 'triweekly') intervalWeeks = 3;
  if (client.freq === 'monthly') intervalWeeks = 4;

  if (lastVisited) {
    const lastVisitedDay = new Date(lastVisited);
    lastVisitedDay.setHours(0, 0, 0, 0);

    if (lastVisitedDay.getTime() >= today.getTime()) {
      nextDate.setDate(nextDate.getDate() + intervalWeeks * 7);
    } else if (intervalWeeks > 1) {
      const daysSince = (nextDate.getTime() - lastVisitedDay.getTime()) / (1000 * 3600 * 24);
      if (daysSince < intervalWeeks * 7 - 3 && daysSince < 7) {
        nextDate.setDate(nextDate.getDate() + (intervalWeeks * 7 - 7));
      }
    }
  }

  return nextDate;
};

export const formatDate = (date: Date | null): string => {
  if (!date) return 'Sin fecha';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return 'Para Hoy';
  const diffTime = d.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return 'Mañana';
  if (diffDays === 7) return 'Próxima Semana';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
};

export const normalizePhone = (phone: string): string => {
  if (!phone) return '';
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('598')) return clean;
  if (clean.startsWith('0')) return '598' + clean.slice(1);
  if (clean.length === 8 && clean.startsWith('9')) return '598' + clean;
  return '598' + clean;
};

export const isShortLink = (input: string): boolean => {
  return !!(input && (input.includes('goo.gl') || input.includes('maps.app.goo.gl') || input.includes('google.com/maps')));
};

export const getTodayDayName = (): string => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return days[new Date().getDay()];
};
