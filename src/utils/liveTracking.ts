// Seguimiento en vivo del camión: cada «En camino» crea un link propio en
// Realtime Database (seguimiento/<token>) que el cliente mira en la webapp
// (web/seguimiento) durante 30 minutos. El formato lo validan
// database.rules.json; acá queda la parte sin efectos.

export const TRACKING_LINK_MINUTES = 30;
export const TRACKING_BASE_URL = 'https://rutawater.web.app/s/';

/** Lugar de la plantilla «En camino» donde va el link; si no está, se agrega al final. */
export const TRACKING_LINK_PLACEHOLDER = '{link}';

// Una posición vieja no sirve para arrancar un link nuevo.
export const FRESH_FIX_MS = 2 * 60 * 1000;
// Entre escrituras de posición, y cada cuánto o cada cuántos metros suma un punto al recorrido.
export const MIN_WRITE_INTERVAL_MS = 10 * 1000;
export const TRAIL_MIN_METERS = 40;
export const TRAIL_MAX_INTERVAL_MS = 60 * 1000;
// Un link a punto de vencer ya no recibe escrituras: las reglas las rechazarían.
const EXPIRY_MARGIN_MS = 5 * 1000;

export interface TrackingFix {
  lat: number;
  lng: number;
  precision?: number;
  rumbo?: number;
  at: number;
}

export interface TrackingLink {
  token: string;
  vence: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 24 caracteres base64url (144 bits) a partir de bytes aleatorios criptográficos. */
export const newTrackingToken = (randomBytes: (length: number) => Uint8Array): string => {
  const bytes = randomBytes(24);
  let token = '';
  for (let i = 0; i < 24; i += 1) token += ALPHABET[bytes[i] & 63];
  return token;
};

export const trackingUrl = (token: string): string => `${TRACKING_BASE_URL}${token}`;

/**
 * Mensaje de «En camino» con el link: va donde diga {link}, o en una línea al
 * final. Sin link (permiso negado, sin sesión) el mensaje sale como siempre.
 */
export const withTrackingLink = (message: string, url: string | null, linkLine: string): string => {
  if (!url) return message.split(TRACKING_LINK_PLACEHOLDER).join('').replace(/[ \t]+\n/g, '\n').trim();
  if (message.includes(TRACKING_LINK_PLACEHOLDER)) return message.split(TRACKING_LINK_PLACEHOLDER).join(url);
  return `${message.trim()}\n\n${linkLine}`;
};

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Posición en el formato de las reglas: rumbo solo si es válido, precisión en metros enteros. */
export const positionFields = (fix: TrackingFix) => ({
  lat: round(fix.lat, 6),
  lng: round(fix.lng, 6),
  precision: fix.precision !== undefined && fix.precision >= 0 ? Math.round(fix.precision) : null,
  rumbo: fix.rumbo !== undefined && fix.rumbo >= 0 && fix.rumbo < 360 ? Math.round(fix.rumbo) % 360 : null,
});

export const isFreshFix = (fix: TrackingFix | null, now: number): fix is TrackingFix =>
  !!fix && now - fix.at <= FRESH_FIX_MS;

/** Registro nuevo de un link: en camino si ya hay una posición reciente, si no «preparado». */
export const newTrackingRecord = (
  ownerUid: string, day: string, vence: number, fix: TrackingFix | null, now: number, timestamp: object,
) => {
  const base = { ownerUid, dia: day, vence, actualizado: timestamp };
  if (!isFreshFix(fix, now)) return { ...base, estado: 'preparado' };
  const position = positionFields(fix);
  const record: Record<string, unknown> = { ...base, estado: 'en_camino', lat: position.lat, lng: position.lng };
  if (position.precision !== null) record.precision = position.precision;
  if (position.rumbo !== null) record.rumbo = position.rumbo;
  return record;
};

export const liveLinks = (links: TrackingLink[], now: number): TrackingLink[] =>
  links.filter((link) => link.vence - EXPIRY_MARGIN_MS > now);

export const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

export const shouldAddTrailPoint = (last: TrackingFix | null, next: TrackingFix): boolean =>
  !last || next.at - last.at >= TRAIL_MAX_INTERVAL_MS || distanceMeters(last, next) >= TRAIL_MIN_METERS;
