import type { Client, ClientAddress } from '../types';

export interface Coordinates {
  lat: number;
  lng: number;
}

const NUMBER = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PAIR = `${NUMBER}\\s*,\\s*\\+?${NUMBER}`;

// Solo se aceptan coordenadas que identifican el punto compartido. Un `@lat,lng`
// suelto es el centro de la vista del mapa (o la ubicación del que lo abre), no
// el lugar, así que se usa únicamente dentro de /maps/place/<nombre>/@….
const PATTERNS: RegExp[] = [
  /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  new RegExp(`[?&](?:q|query|ll|sll|destination|daddr)=(?:loc:)?\\s*${PAIR}(?:[&#\\s]|$)`, 'i'),
  new RegExp(`/maps/(?:search|place)/${PAIR}(?:[/?#&\\s]|$)`, 'i'),
  new RegExp(`/maps/place/[^/?#@]+/@${PAIR}`, 'i'),
];

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
};

export const isValidCoordinates = (point: Partial<Coordinates> | null | undefined): point is Coordinates =>
  !!point
  && typeof point.lat === 'number' && typeof point.lng === 'number'
  && Number.isFinite(point.lat) && Number.isFinite(point.lng)
  && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
  && !(point.lat === 0 && point.lng === 0);

/**
 * Coordenadas que trae escritas un link de Google Maps (o la URL a la que
 * redirige un link corto). Devuelve null si el link solo nombra un lugar.
 */
export const parseMapsCoordinates = (url: string): Coordinates | null => {
  if (!url) return null;
  // Algunas redirecciones (consentimiento) llevan el destino codificado.
  const candidates = [url, decode(url)];
  for (const candidate of candidates) {
    for (const pattern of PATTERNS) {
      const match = candidate.match(pattern);
      if (!match) continue;
      const point = { lat: Number(match[1]), lng: Number(match[2]) };
      if (isValidCoordinates(point)) return point;
    }
  }
  return null;
};

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  maxHops?: number;
  timeoutMs?: number;
  // Recibe cada URL visitada (para informar a dónde lleva un link sin coordenadas).
  onUrl?: (url: string) => void;
}

const absolute = (location: string, base: string): string => {
  if (/^https?:\/\//i.test(location)) return location;
  const origin = base.match(/^https?:\/\/[^/?#]+/i)?.[0] || '';
  return location.startsWith('/') ? `${origin}${location}` : location;
};

/**
 * Sigue las redirecciones de un link (corto) de Google Maps hasta encontrar
 * coordenadas en la URL. No lee el contenido de la página: para un lugar con
 * nombre esa página muestra la vista por defecto, no el lugar. Con fetch que
 * sigue redirecciones solo (React Native) alcanza con la URL final; en Node se
 * mira cada salto con redirect: 'manual'.
 */
export const resolveMapsCoordinates = async (
  link: string,
  { fetchImpl = fetch, maxHops = 6, timeoutMs = 8000, onUrl }: ResolveOptions = {},
): Promise<Coordinates | null> => {
  const direct = parseMapsCoordinates(link);
  if (direct) return direct;
  if (!/^https?:\/\//i.test(link || '')) return null;
  let url = link;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es' },
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const finalUrl = typeof response.url === 'string' ? response.url : '';
    if (finalUrl && finalUrl !== url) {
      onUrl?.(finalUrl);
      const found = parseMapsCoordinates(finalUrl);
      if (found) return found;
    }
    const location = response.headers?.get?.('location');
    if (response.status < 300 || response.status >= 400 || !location) return null;
    url = absolute(location, url);
    onUrl?.(url);
    const found = parseMapsCoordinates(url);
    if (found) return found;
  }
  return null;
};

/** Mismo formato de texto que guardan las fichas (lat/lng son strings). */
export const formatCoordinate = (value: number): string => String(Number(value.toFixed(6)));

const pointFrom = (lat: unknown, lng: unknown): Coordinates | null => {
  if (lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '') return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return isValidCoordinates(point) ? point : null;
};

/**
 * Punto de entrega de la ficha: lat/lng de la ubicación principal (los campos
 * de arriba, que copian la dirección elegida al agendar) o, si faltan, de la
 * primera dirección guardada que tenga coordenadas.
 */
export const clientCoordinates = (client: Partial<Client>): Coordinates | null => {
  const top = pointFrom(client.lat, client.lng);
  if (top) return top;
  for (const location of Array.isArray(client.addresses) ? client.addresses : []) {
    const point = pointFrom(location?.lat, location?.lng);
    if (point) return point;
  }
  return null;
};

/** Ubicaciones con link de Maps y sin coordenadas (las que hay que resolver). */
export const linksWithoutCoordinates = (client: Partial<Client>): string[] => {
  const links = new Set<string>();
  const add = (location: Partial<ClientAddress> | null | undefined) => {
    const link = (location?.mapsLink || '').trim();
    if (link && !pointFrom(location?.lat, location?.lng)) links.add(link);
  };
  (Array.isArray(client.addresses) ? client.addresses : []).forEach(add);
  add({ mapsLink: client.mapsLink, lat: client.lat, lng: client.lng });
  return [...links];
};

/**
 * Completa lat/lng de las ubicaciones cuyo link se resolvió. Devuelve solo los
 * campos que cambian (addresses y/o lat/lng de arriba), o null si nada cambia.
 */
export const coordinateUpdates = (
  client: Partial<Client>, resolved: Map<string, Coordinates>,
): { addresses?: ClientAddress[]; lat?: string; lng?: string } | null => {
  const updates: { addresses?: ClientAddress[]; lat?: string; lng?: string } = {};
  const fill = <T extends { mapsLink?: string; lat?: string; lng?: string }>(location: T): T => {
    const point = resolved.get((location.mapsLink || '').trim());
    if (!point || pointFrom(location.lat, location.lng)) return location;
    return { ...location, lat: formatCoordinate(point.lat), lng: formatCoordinate(point.lng) };
  };
  if (Array.isArray(client.addresses)) {
    const filled = client.addresses.map((location) => (location ? fill(location) : location));
    if (filled.some((location, index) => location !== client.addresses![index])) updates.addresses = filled;
  }
  const top = fill({ mapsLink: client.mapsLink, lat: client.lat, lng: client.lng });
  if (top.lat !== client.lat || top.lng !== client.lng) {
    updates.lat = top.lat;
    updates.lng = top.lng;
  }
  return Object.keys(updates).length ? updates : null;
};

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Distancia en línea recta (haversine), en metros. */
export const haversineMeters = (a: Coordinates, b: Coordinates): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

export interface Insertion {
  // Lugar en `route` donde entra el punto: 0 = antes de la primera parada.
  index: number;
  // Desvío que agrega: d(A,P) + d(P,B) − d(A,B); en los extremos, d(P, vecino).
  extraMeters: number;
}

/**
 * Inserción más barata de `point` en un recorrido ordenado: el par de paradas
 * consecutivas A, B que minimiza d(A,P) + d(P,B) − d(A,B). También se
 * consideran los extremos (antes de la primera o después de la última), con
 * costo d(P, primera) o d(última, P). Empates: el lugar más temprano.
 */
export const cheapestInsertion = (route: Coordinates[], point: Coordinates): Insertion | null => {
  if (!route.length) return null;
  let best: Insertion = { index: 0, extraMeters: haversineMeters(point, route[0]) };
  for (let index = 1; index <= route.length; index += 1) {
    const before = route[index - 1];
    const after = route[index];
    const extraMeters = after
      ? haversineMeters(before, point) + haversineMeters(point, after) - haversineMeters(before, after)
      : haversineMeters(before, point);
    if (extraMeters < best.extraMeters - 1e-6) best = { index, extraMeters };
  }
  return best;
};
