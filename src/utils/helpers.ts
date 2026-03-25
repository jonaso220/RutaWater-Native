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
  const date = val.seconds !== undefined
    ? new Date(val.seconds * 1000)
    : new Date(val);
  return isNaN(date.getTime()) ? null : date;
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

// Check if search chars appear in order within text (like WhatsApp/Sublime)
const subsequenceMatch = (text: string, search: string): boolean => {
  let si = 0;
  for (let ti = 0; ti < text.length && si < search.length; ti++) {
    if (text[ti] === search[si]) si++;
  }
  return si === search.length;
};

// Levenshtein on a sliding window: find best distance of `search` within `text`
// Limited to short search terms to avoid performance issues with large texts
const substringLevenshtein = (text: string, search: string): number => {
  const sLen = search.length;
  if (sLen === 0) return 0;
  if (text.length === 0) return sLen;
  if (sLen > 12 || text.length > 100) return sLen; // skip for long inputs
  let best = sLen;
  const minWin = Math.max(1, sLen - 1);
  const maxWin = sLen + 1;
  for (let win = minWin; win <= maxWin; win++) {
    for (let start = 0; start <= text.length - win; start++) {
      const d = levenshtein(text.substring(start, start + win), search);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
};

export const fuzzyMatch = (searchTerm: string): ((...fields: string[]) => boolean) => {
  if (!searchTerm) return () => true;
  const cleaned = normalizeText(searchTerm).trim().replace(/\s+/g, ' ');
  if (!cleaned) return () => true;
  const words = cleaned.split(' ');

  return (...fields: string[]) => {
    const combined = fields.map((f) => normalizeText(f)).join(' ');

    // Fast path: direct full-term substring
    if (combined.includes(cleaned)) return true;

    // Each search word must match at least one field
    return words.every((w) => {
      if (combined.includes(w)) return true;

      const textWords = combined.split(/\s+/);

      // Tolerance: 1 error for 3-4 chars, 2 for 5-7, 3 for 8+
      const maxDist = w.length <= 2 ? 0 : w.length <= 4 ? 1 : w.length <= 7 ? 2 : 3;

      // 1) Prefix match: any text word starts with search word or vice versa
      if (textWords.some((tw) => tw.startsWith(w) || w.startsWith(tw))) return true;

      // 2) Subsequence match: chars appear in order (e.g. "mria" in "maria")
      if (w.length >= 3 && textWords.some((tw) => subsequenceMatch(tw, w))) return true;

      if (maxDist === 0) return false;

      // 3) Word-level Levenshtein (typos like "maris" for "maria")
      if (textWords.some((tw) => levenshtein(tw, w) <= maxDist)) return true;

      // 4) Substring Levenshtein: find approximate match anywhere in the combined text
      //    (handles cases where word boundaries don't align)
      if (w.length >= 3 && substringLevenshtein(combined, w) <= maxDist) return true;

      return false;
    });
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

export const getWeekNumber = (d: Date): number => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

export const getNextVisitDate = (client: Client, forDay?: string): Date | null => {
  // Only use specificDate as-is for 'once' clients (one-time orders).
  // For periodic clients, specificDate is a start-date hint and should not
  // override the normal next-visit calculation.
  if (client.freq === 'once') {
    return client.specificDate ? new Date(client.specificDate + 'T12:00:00') : null;
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

  let intervalWeeks = 1;
  if (client.freq === 'biweekly') intervalWeeks = 2;
  if (client.freq === 'triweekly') intervalWeeks = 3;
  if (client.freq === 'monthly') intervalWeeks = 4;

  if (lastVisited) {
    const lastVisitedDay = new Date(lastVisited);
    lastVisitedDay.setHours(0, 0, 0, 0);

    if (intervalWeeks === 1) {
      // Weekly: if visited after the previous occurrence of the target day,
      // the client was already served this cycle — push to next week.
      // This handles marking "Listo" on a day before the scheduled day.
      const prevOccurrence = new Date(nextDate);
      prevOccurrence.setDate(prevOccurrence.getDate() - 7);
      if (lastVisitedDay.getTime() > prevOccurrence.getTime()) {
        nextDate.setDate(nextDate.getDate() + 7);
      }
    } else {
      // Biweekly/triweekly/monthly: ensure at least intervalWeeks*7 days since last visit
      const minNextDate = new Date(lastVisitedDay);
      minNextDate.setDate(minNextDate.getDate() + intervalWeeks * 7);
      while (nextDate < minNextDate) {
        nextDate.setDate(nextDate.getDate() + 7);
      }
    }
  }

  // For periodic clients, respect specificDate as a minimum start date.
  // If the user set a future start date, don't show the client before that date.
  if (client.specificDate) {
    const startDate = new Date(client.specificDate + 'T00:00:00');
    if (startDate > today && nextDate < startDate) {
      // Push nextDate forward to the first matching day on or after startDate
      while (nextDate < startDate) {
        nextDate.setDate(nextDate.getDate() + 7);
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
  if (!clean) return '';
  // Already has a known international prefix (10+ digits starting with common codes)
  if (clean.length >= 10 && /^(1|7|20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98|212|213|216|218|220|221|222|223|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246|247|248|249|250|251|252|253|254|255|256|257|258|260|261|262|263|264|265|266|267|268|269|290|291|297|298|299|350|351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|500|501|502|503|504|505|506|507|508|509|590|591|592|593|595|596|597|598|599|670|672|673|674|675|676|677|678|679|680|681|682|683|685|686|687|688|689|690|691|692|850|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|970|971|972|973|974|975|976|977|992|993|994|995|996|998)/.test(clean)) {
    return clean;
  }
  // Uruguay local formats
  if (clean.startsWith('598')) return clean;
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

export const isShortLink = (input: string): boolean => {
  return !!(input && (input.includes('goo.gl') || input.includes('maps.app.goo.gl') || input.includes('google.com/maps')));
};

export const getTodayDayName = (): string => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return days[new Date().getDay()];
};
