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

// --- DATE HELPERS ---

// Conversor canónico a Date. El mismo campo puede llegar como Timestamp de
// Firestore (tiene .toDate()), Date de JS (write local aún sin eco del
// servidor), objeto plano {seconds} (dato serializado, p.ej. backup) o string
// ISO. Todo consumo de fechas de Firestore debe pasar por acá — no
// reimplementar la conversión en cada pantalla.
export const parseDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val.toDate === 'function') {
    const d = val.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  // 'yyyy-mm-dd' sin hora se parsea a mediodía LOCAL: new Date('yyyy-mm-dd')
  // asume medianoche UTC y en UTC-3 cae en el día anterior.
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const d = new Date(val + 'T12:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  const date = val.seconds !== undefined
    ? new Date(val.seconds * 1000)
    : new Date(val);
  return isNaN(date.getTime()) ? null : date;
};

// Doc compartido settings/{groupId || uid} (plantillas de WhatsApp + catálogo
// de productos). Se resuelve SIEMPRE por grupo familiar primario o usuario:
// NO cambia con el reparto/perfil activo, a propósito — son configuración de
// la cuenta, y las reglas de Firestore solo autorizan uid o groupId como id
// de settings. Todo lector/escritor debe usar este helper para que la
// fórmula no diverja entre pantallas.
export const settingsDocId = (uid: string, groupId?: string | null): string => groupId || uid;

// yyyy-mm-dd of a date in LOCAL time. new Date().toISOString() uses UTC and in
// UTC-3 already belongs to tomorrow from 21:00 — never use it for "today".
export const toLocalDateString = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const normalizeText = (text: string): string => {
  if (!text) return '';
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
};

// --- FUZZY SEARCH (Levenshtein) ---

export const levenshtein = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

// Damerau-Levenshtein (optimal string alignment): like Levenshtein but counts
// an adjacent transposition (e.g. "jaun" vs "juan") as a single edit, which is
// one of the most common typing mistakes.
export const damerau = (a: string, b: string): number => {
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d: number[][] = [];
  for (let i = 0; i <= al; i++) d[i] = [i];
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
};

// Typo tolerance scaled to word length (longer words allow more edits).
const wordTolerance = (len: number): number =>
  len <= 4 ? 1 : len <= 7 ? 1 : len <= 11 ? 2 : 3;

// Does search word `w` match any token in `textWords`? Matches on substring
// (covers prefix typing like "mar"→"maria"), or a typo within tolerance. The
// typo check also compares against the token's leading slice of len(w) so a
// mistake while typing the start of a long name still matches.
const wordMatches = (textWords: string[], w: string): boolean => {
  for (const tw of textWords) {
    if (tw.includes(w)) return true;
    if (w.length >= 3) {
      const md = wordTolerance(w.length);
      if (damerau(tw, w) <= md) return true;
      if (tw.length > w.length && damerau(tw.slice(0, w.length), w) <= md) return true;
    }
  }
  return false;
};

export const matchScore = (searchTerm: string, name: string, address: string, phone: string): number => {
  const term = normalizeText(searchTerm).trim();
  if (!term) return 0;
  const n = normalizeText(name);
  const a = normalizeText(address);
  const wordStartsWith = (text: string, q: string): boolean =>
    text.split(/\s+/).filter(Boolean).some((w) => w.startsWith(q));

  if (n === term) return 1000;
  if (n.startsWith(term)) return 800;
  if (wordStartsWith(n, term)) return 700;
  if (n.includes(term)) return 500;
  if (a.startsWith(term)) return 400;
  if (wordStartsWith(a, term)) return 350;
  if (a.includes(term)) return 300;

  // Phone (and address numbers): compare normalized digits so formatting,
  // country code and a leading zero don't block the match.
  const qd = normalizePhoneForComparison(searchTerm);
  if (qd.length >= 3) {
    const pd = normalizePhoneForComparison(phone);
    if (pd) {
      if (pd.startsWith(qd)) return 250;
      if (pd.includes(qd)) return 200;
    }
    const ad = normalizePhoneForComparison(address);
    if (ad && ad.includes(qd)) return 150;
  }
  return 100;
};

export const fuzzyMatch = (searchTerm: string): ((...fields: string[]) => boolean) => {
  if (!searchTerm) return () => true;
  const cleaned = normalizeText(searchTerm).trim().replace(/\s+/g, ' ');
  if (!cleaned) return () => true;
  const words = cleaned.split(' ').filter(Boolean);

  // Phone/number search: when the query is digit-based, match on normalized
  // phone digits (ignoring spaces, dashes, +, country code 598 and leading 0).
  const queryDigits = normalizePhoneForComparison(searchTerm);
  const hasDigitQuery = queryDigits.length >= 3;
  const isPureDigits = /^[\d\s+().-]+$/.test(searchTerm.trim());

  return (...fields: string[]) => {
    if (hasDigitQuery) {
      for (const f of fields) {
        const fd = normalizePhoneForComparison(f || '');
        if (fd && fd.includes(queryDigits)) return true;
      }
      // A pure-number query only makes sense against phone/address numbers.
      if (isPureDigits) return false;
    }

    const combined = fields.map((f) => normalizeText(f || '')).join(' ');

    // Fast path: the whole query appears verbatim.
    if (combined.includes(cleaned)) return true;

    // Every search word must match some token. Empty tokens are filtered out so
    // a missing field (e.g. no phone) can't accidentally match every query.
    const textWords = combined.split(/\s+/).filter(Boolean);
    return words.every((w) => wordMatches(textWords, w));
  };
};

// --- MAGIC PASTE: Parse contact string ---

export const parseContactString = (str: string): {
  name: string; address: string; phone: string; link: string;
  lat: string; lng: string; products: Record<string, string>; notes: string;
} => {
  // Clean WhatsApp formatting
  str = str.replace(/\*/g, '').replace(/(?:^|\s)_([^_]+)_(?:\s|$)/g, ' $1 ');

  const lines = str.split('\n').map((l) => l.trim()).filter((l) => l);

  let name = '', address = '', phone = '', link = '', lat = '', lng = '', notes = '';
  const products: Record<string, string> = {
    b20: '', b12: '', b6: '', soda: '', bombita: '',
    disp_elec_new: '', disp_elec_chg: '', disp_nat: '',
  };

  // 1. Extract Google Maps URL
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = str.match(urlRegex);
  if (urls) {
    link = urls[0];
    const m = link.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) { lat = m[1]; lng = m[2]; }
  }

  // 2. Extract phone
  let i: number;
  for (i = 0; i < lines.length; i++) {
    const telMatch = lines[i].match(/tel[eé]fono\s*:\s*(\d[\d\s-]*)/i);
    if (telMatch) { phone = telMatch[1].replace(/[\s-]/g, ''); break; }
  }
  if (!phone) {
    for (i = 0; i < lines.length; i++) {
      if (lines[i].match(urlRegex)) continue;
      const numMatch = lines[i].match(/\b(0\d{8,})\b/);
      if (numMatch) { phone = numMatch[1]; break; }
    }
  }

  // 3. Extract name
  for (i = 0; i < lines.length; i++) {
    const nameMatch = lines[i].match(/nombre\s*:\s*(.+)/i);
    if (nameMatch) { name = nameMatch[1].trim(); break; }
  }

  // 4. Extract address + corner
  let direccion = '', esquina = '';
  for (i = 0; i < lines.length; i++) {
    const dirMatch = lines[i].match(/direcci[oó]n\s*:\s*(.+)/i);
    if (dirMatch) { direccion = dirMatch[1].trim(); }
    const esqMatch = lines[i].match(/esquina\s*:\s*(.+)/i);
    if (esqMatch) { esquina = esqMatch[1].trim(); }
  }
  if (direccion && esquina) { address = direccion + ' (esq. ' + esquina + ')'; }
  else if (direccion) { address = direccion; }

  // 5. Extract products
  const fullText = str.toLowerCase();

  const b20Match = fullText.match(/bid[oó]n[:\s]*20\s*(?:lts?|litros?)?\s*(\d+)/i) || fullText.match(/20\s*(?:lts?|litros?)\s*(\d+)/i);
  if (b20Match) products.b20 = b20Match[1];

  const b12Match = fullText.match(/bid[oó]n[:\s]*12\s*(?:lts?|litros?)?\s*(\d+)/i) || fullText.match(/12\s*(?:lts?|litros?)\s*(\d+)/i);
  if (b12Match) products.b12 = b12Match[1];

  const b6Match = fullText.match(/bid[oó]n[:\s]*6\s*(?:lts?|litros?)?\s*(\d+)/i) || fullText.match(/6\s*(?:lts?|litros?)\s*(\d+)/i);
  if (b6Match) products.b6 = b6Match[1];

  const sodaMatch = fullText.match(/soda\s*:\s*(\d+)/i);
  if (sodaMatch && parseInt(sodaMatch[1]) > 0) products.soda = sodaMatch[1];

  const bombitaMatch = fullText.match(/bombita\s*:?\s*(\d+)/i);
  if (bombitaMatch && parseInt(bombitaMatch[1]) > 0) products.bombita = bombitaMatch[1];

  const dispElecNewMatch = fullText.match(/dispensador\s*:?\s*(?:elec(?:trico)?|elé(?:ctrico)?)\s*(?:nuevo)?\s*(\d+)/i) || fullText.match(/disp(?:ensador)?\s*:?\s*elec\s*(\d+)/i);
  if (dispElecNewMatch && parseInt(dispElecNewMatch[1]) > 0) products.disp_elec_new = dispElecNewMatch[1];

  const dispElecChgMatch = fullText.match(/dispensador\s*:?\s*(?:elec(?:trico)?|elé(?:ctrico)?)\s*cambio\s*(\d+)/i);
  if (dispElecChgMatch && parseInt(dispElecChgMatch[1]) > 0) products.disp_elec_chg = dispElecChgMatch[1];

  const dispNatMatch = fullText.match(/dispensador\s*:?\s*nat(?:ural)?\s*(\d+)/i) || fullText.match(/disp(?:ensador)?\s*:?\s*nat\s*(\d+)/i);
  if (dispNatMatch && parseInt(dispNatMatch[1]) > 0) products.disp_nat = dispNatMatch[1];

  // 6. Extract notes/details
  const detalles: string[] = [];
  let isAfterProducts = false;
  for (i = 0; i < lines.length; i++) {
    if (/producto|bidon|soda|dispensador/i.test(lines[i])) { isAfterProducts = true; }
    const detMatch = lines[i].match(/detalle\s*:\s*(.+)/i);
    if (detMatch) {
      const detText = detMatch[1].trim();
      if (detText.length <= 20 && !isAfterProducts && !/nuevo|coordinar|espera|llam/i.test(detText)) {
        if (address) address += ' - ' + detText;
        else address = detText;
      } else if (isAfterProducts || detText.length > 20 || /nuevo|coordinar|espera|llam/i.test(detText)) {
        detalles.push(detText);
      }
    }
  }
  notes = detalles.join(' | ');

  // 7. Fallback
  if (!name && !address && !phone) {
    const cleanStr = str.replace(link, '').trim().replace(/-+$/, '').trim();
    const parts = cleanStr.split(/\s+-\s+/).map((s) => s.trim()).filter((s) => s);
    if (parts.length >= 2) { name = parts[0]; address = parts.slice(1).join(' - '); }
    else if (parts.length === 1) { name = parts[0]; address = parts[0]; }
  }

  return { name, address, phone, link, lat, lng, products, notes };
};

export const getDayIndex = (dayName: string): number => {
  if (!dayName) return -1;
  const normalized = normalizeText(dayName);
  const map: Record<string, number> = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  };
  return map[normalized] !== undefined ? map[normalized] : -1;
};

// Días que una visita no entregada sigue figurando como pendiente ("Hoy")
// antes de saltar sola al próximo ciclo, como si se hubiera marcado Listo.
const LATE_GRACE_DAYS = 2;

export const intervalWeeksForFreq = (
  freq: Client['freq'] | string | undefined,
): number => {
  if (freq === 'biweekly') return 2;
  if (freq === 'triweekly') return 3;
  if (freq === 'monthly') return 4;
  return 1;
};

/** Native-trigger fields so a periodic alarm fires on the next visit, not the next weekday. */
export const alarmScheduleFields = (
  client: Client,
  forDay?: string,
): {
  targetDay?: string;
  specificDate?: string;
  nextVisitDate?: string;
  intervalWeeks?: number;
} => {
  const targetDay = forDay
    || client.alarmDay
    || (client.visitDays && client.visitDays.length > 0 ? client.visitDays[0] : undefined)
    || client.visitDay
    || undefined;
  if (client.freq === 'once') {
    return {
      targetDay,
      specificDate: client.specificDate || undefined,
    };
  }
  const visit = getNextVisitDate(client, targetDay);
  return {
    targetDay,
    nextVisitDate: visit ? toLocalDateString(visit) : undefined,
    intervalWeeks: intervalWeeksForFreq(client.freq),
  };
};

export const getNextVisitDate = (client: Client, forDay?: string): Date | null => {
  // Only use specificDate as-is for 'once' clients (one-time orders).
  // For periodic clients, specificDate is a start-date hint and should not
  // override the normal next-visit calculation.
  if (client.freq === 'once') {
    if (!client.specificDate) return null;
    // The shared DB (webapp/AI) can hold malformed dates; an Invalid Date here
    // would crash any caller that calls toISOString() on the result.
    const onceDate = new Date(client.specificDate + 'T12:00:00');
    return isNaN(onceDate.getTime()) ? null : onceDate;
  }

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

  const intervalWeeks = intervalWeeksForFreq(client.freq);

  if (lastVisited) {
    const lastVisitedDay = new Date(lastVisited);
    lastVisitedDay.setHours(0, 0, 0, 0);

    // The cycle is anchored to the client's scheduled DAY, not the delivery
    // timestamp:
    //  1) The visit is attributed to its NEAREST scheduled occurrence (tie →
    //     the past one): a late delivery (Tue for a Monday client) belongs to
    //     the Monday that passed; an early one (Sat) to the upcoming Monday.
    //     Late deliveries therefore keep the client's day and rhythm.
    //  2) The next visit of the target day is its occurrence intervalWeeks
    //     after the attributed week — or the same week, for a later sibling
    //     day of a multi-day client (they visit every selected day of their
    //     "on" week).
    //  3) A missed occurrence stays pending for LATE_GRACE_DAYS (the grouping
    //     shows it under "Hoy"), then rolls to the next cycle on its own — as
    //     if it had been marked done.
    //
    // When markAsDone recorded WHICH occurrence the tap completed (doneFor),
    // that beats the nearest-day guess: a delivery more than half a week away
    // from the scheduled day (a Saturday client marked done on Monday) gets
    // attributed to the wrong occurrence and the client doesn't move. doneFor
    // is only trusted while it plausibly belongs to the same completion event
    // as lastVisited — the webapp and older versions update lastVisited alone,
    // which would otherwise leave a stale doneFor pinning the attribution.
    let attributed: Date | null = null;
    if (client.doneFor) {
      const doneForDate = new Date(client.doneFor + 'T00:00:00');
      if (!isNaN(doneForDate.getTime())) {
        const drift = Math.round(
          (doneForDate.getTime() - lastVisitedDay.getTime()) / 86400000,
        );
        // At write time the pending occurrence sits between today−grace and
        // one full cycle ahead; anything outside means lastVisited was
        // updated later without doneFor → fall back to the heuristic.
        if (drift >= -(LATE_GRACE_DAYS + 1) && drift <= intervalWeeks * 7) {
          attributed = doneForDate;
        }
      }
    }

    if (!attributed) {
      const dayIndexes = new Set<number>([targetDayIndex]);
      if (Array.isArray(client.visitDays)) {
        client.visitDays.forEach((d) => {
          const idx = getDayIndex(d);
          if (idx !== -1) dayIndexes.add(idx);
        });
      }
      const mainDayIndex = getDayIndex(client.visitDay);
      if (mainDayIndex !== -1) dayIndexes.add(mainDayIndex);

      let bestOffset: number | null = null;
      dayIndexes.forEach((idx) => {
        const fwd = (idx - lastVisitedDay.getDay() + 7) % 7;
        const offsets = fwd === 0 ? [0] : [fwd - 7, fwd];
        offsets.forEach((off) => {
          if (
            bestOffset === null ||
            Math.abs(off) < Math.abs(bestOffset) ||
            (Math.abs(off) === Math.abs(bestOffset) && off < bestOffset)
          ) {
            bestOffset = off;
          }
        });
      });
      attributed = new Date(lastVisitedDay);
      attributed.setDate(attributed.getDate() + (bestOffset ?? 0));
    }

    // Target day's occurrence in the attributed (Monday-start) week, then
    // jump whole cycles until past the attributed visit and the grace window.
    const candidate = new Date(attributed);
    candidate.setDate(
      candidate.getDate() - ((attributed.getDay() + 6) % 7) + ((targetDayIndex + 6) % 7),
    );
    if (candidate.getTime() <= attributed.getTime()) {
      candidate.setDate(candidate.getDate() + intervalWeeks * 7);
    }
    const graceLimit = new Date(today);
    graceLimit.setDate(graceLimit.getDate() - LATE_GRACE_DAYS);
    while (candidate < graceLimit) {
      candidate.setDate(candidate.getDate() + intervalWeeks * 7);
    }
    nextDate.setTime(candidate.getTime());
  }

  // For periodic clients, respect specificDate as an anchor date.
  if (client.specificDate) {
    const startDate = new Date(client.specificDate + 'T00:00:00');
    if (startDate > today && nextDate < startDate) {
      // Future start date: push nextDate forward to the first matching day on or after startDate
      while (nextDate < startDate) {
        nextDate.setDate(nextDate.getDate() + 7);
      }
    } else if (!lastVisited && startDate <= today && nextDate > today) {
      // Past/today date with no lastVisited (just edited): pull nextDate back to the
      // occurrence in the same week as specificDate so the client reappears immediately.
      // Only do this if specificDate is recent (within the last 7 days) to avoid
      // pulling back clients with stale specificDates from weeks ago.
      const daysSinceStart = Math.round((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceStart < 7) {
        const candidate = new Date(nextDate);
        candidate.setDate(candidate.getDate() - 7);
        if (candidate >= startDate) {
          nextDate.setTime(candidate.getTime());
        }
      }
    }
  }

  return nextDate;
};

// Parseo de montos en formato rioplatense: la coma es el separador decimal y
// el punto (o espacio) separa miles — "1.500" son mil quinientos y "150,50"
// son ciento cincuenta con cincuenta. parseFloat haría 1.5 y 150. Un punto
// solo se toma como decimal cuando le siguen 1-2 dígitos finales ("150.50").
// Devuelve NaN si no se puede interpretar.
export const parseMoneyInput = (raw: string | undefined | null): number => {
  if (raw === undefined || raw === null) return NaN;
  let s = String(raw).trim().replace(/[$\s]/g, '');
  if (!s) return NaN;
  const commas = (s.match(/,/g) || []).length;
  if (commas > 1) return NaN;
  if (commas === 1) {
    // Coma decimal; los puntos que queden son de miles.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    const parts = s.split('.');
    const last = parts[parts.length - 1];
    const isDecimalDot = parts.length === 2 && last.length >= 1 && last.length <= 2;
    if (!isDecimalDot) {
      // "1.500" / "1.234.567" → puntos de miles (cada grupo debe tener 3 dígitos)
      if (parts.slice(1).some((p) => p.length !== 3)) return NaN;
      s = parts.join('');
    }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  // Dos decimales máximo (es plata): evita flotantes raros tipo 150.500000001
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export const normalizePhone = (phone: string): string => {
  if (!phone) return '';
  const clean = phone.replace(/\D/g, '');
  if (!clean) return '';
  // Uruguay numbers copied from WhatsApp as +598 09x xxx xxx keep the local
  // trunk 0. E.164 drops it (598 9x xxx xxx). Handle 598 before the
  // international-prefix match, which would otherwise return 5980… as-is.
  if (clean.startsWith('598')) {
    const national = clean.slice(3);
    return national.startsWith('0') ? '598' + national.slice(1) : clean;
  }
  // Already has a known international prefix (10+ digits starting with common codes)
  if (clean.length >= 10 && /^(1|7|20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98|212|213|216|218|220|221|222|223|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246|247|248|249|250|251|252|253|254|255|256|257|258|260|261|262|263|264|265|266|267|268|269|290|291|297|298|299|350|351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|500|501|502|503|504|505|506|507|508|509|590|591|592|593|595|596|597|598|599|670|672|673|674|675|676|677|678|679|680|681|682|683|685|686|687|688|689|690|691|692|850|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|970|971|972|973|974|975|976|977|992|993|994|995|996|998)/.test(clean)) {
    return clean;
  }
  // Uruguay local formats
  if (clean.startsWith('0')) return '598' + clean.slice(1);
  if (clean.length === 8 && clean.startsWith('9')) return '598' + clean;
  if (clean.length <= 9) return '598' + clean;
  // Long number without recognized prefix, return as-is
  return clean;
};

/**
 * Normalize phone number for duplicate comparison.
 * Strips country code (+598 / 598), spaces, dashes, parentheses, and leading zero.
 * e.g. "098 979 011" -> "98979011", "+598 98 979 011" -> "98979011"
 */
export const normalizePhoneForComparison = (phone: string): string => {
  if (!phone) return '';
  // Strip all non-digit characters
  let digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  // Strip Uruguay country code (598) from the front
  if (digits.startsWith('598')) digits = digits.slice(3);
  // Strip leading zero (local format: 098... -> 98...)
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
};

// Clave para agrupar instancias duplicadas de un mismo cliente humano.
// Usa nombre normalizado + teléfono normalizado cuando hay teléfono.
// Sin teléfono, se cae al id del propio documento (no se fusiona con homónimos).
// Mantiene el mismo criterio que findDuplicateClients en useClients.
export const getClientMatchKey = (
  name: string,
  phone: string,
  fallbackId: string,
): string => {
  const normName = normalizeText(name || '').trim().replace(/\s+/g, ' ');
  if (!normName) return `__id_${fallbackId}`;
  const normPhone = normalizePhoneForComparison(phone);
  return normPhone ? `${normName}::${normPhone}` : `__id_${fallbackId}`;
};

export const isShortLink = (input: string): boolean => {
  return !!(input && (input.includes('goo.gl') || input.includes('maps.app.goo.gl') || input.includes('google.com/maps')));
};

export const getTodayDayName = (): string => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return days[new Date().getDay()];
};

// Adaptive modal width for centered modals on tablet/Mac. Scales the cap
// with available window width so big monitors (32" 2K vertical, iPad Pro
// landscape) don't leave huge dark gutters, while iPad mini and small
// windows still get a comfortable form width.
export const getModalWidth = (windowWidth: number): number | undefined => {
  if (windowWidth < 600) return undefined; // phone bottom-sheet path
  let cap: number;
  if (windowWidth >= 1300) cap = 1100;
  else if (windowWidth >= 1000) cap = 950;
  else if (windowWidth >= 800) cap = 800;
  else cap = 720;
  return Math.min(windowWidth - 48, cap);
};
