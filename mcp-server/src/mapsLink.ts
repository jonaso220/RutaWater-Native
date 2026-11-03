import { Coordinates, resolveMapsCoordinates } from '../../src/utils/geo';
import { normalizeGoogleMapsLink } from '../../src/utils/googleMapsLink';
import { addressFromMap } from './streets';

// Leer un link de Google Maps (Jonathan, 3/11/2026). Con un punto marcado da las
// coordenadas; compartir una dirección o un lugar da un link sin coordenadas
// (uno de cada ocho de los guardados) y lo único que trae es el texto del lugar:
// la página de Maps muestra la vista por defecto, así que no hay de dónde sacar
// el punto.

const decode = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
};

// «53WR+GJF Súper, Av. X, 15800 Ciudad de la Costa, Departamento de Canelones» → «Súper, Av. X, Ciudad de la Costa»
const cleanPlace = (place: string) => decode(place)
  .replace(/^[23456789CFGHJMPQRVWX]{4,8}[+ ][23456789CFGHJMPQRVWX]{2,3}[ ,]*/i, '')
  .replace(/,?\s*Departamento de [^,]+/i, '')
  .replace(/,?\s*Uruguay\s*$/i, '')
  .replace(/\b\d{5}\s+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** El texto del lugar que trae la URL (q= o /maps/place/…); vacío si solo trae coordenadas. */
export const placeFromMapsUrl = (url: string): string => {
  const raw = url.match(/[?&]q=([^&#]+)/i)?.[1] || url.match(/\/maps\/place\/([^/?#@]+)/i)?.[1] || '';
  const place = cleanPlace(raw);
  // Un punto marcado trae coordenadas como texto («34°47'59.1"S 55°54'53.6"W»), no un lugar.
  return /^(loc:)?\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$|^\d+°/.test(place) ? '' : place;
};

export interface MapsLinkRead { point: Coordinates | null; place: string }

/** Sigue el link una vez y devuelve el punto, si tiene, y el texto del lugar. Si el link está roto, nada. */
export const readMapsLink = async (link: string, fetchImpl: typeof fetch = fetch): Promise<MapsLinkRead> => {
  const urls = [link];
  const point = await resolveMapsCoordinates(link, { fetchImpl, onUrl: (url) => urls.push(url) }).catch(() => null);
  return { point, place: urls.map(placeFromMapsUrl).filter(Boolean).pop() || '' };
};

/** Lo que dice un link, sin escribir nada: coordenadas, dirección armada con el mapa y texto del lugar. */
export const describeMapsLink = async (rawLink: string, fetchImpl: typeof fetch = fetch) => {
  const link = normalizeGoogleMapsLink(rawLink);
  if (!link) throw new Error(`No es un link de Google Maps: «${rawLink}».`);
  const { point, place } = await readMapsLink(link, fetchImpl);
  if (!point) {
    return {
      link, coordenadas: null, lugar: place || null, direccion_del_mapa: null,
      aviso: place
        ? 'El link nombra un lugar sin punto marcado: sirve el texto, pero sin coordenadas la ficha no ordena el recorrido. Hace falta un link de un punto marcado o una ubicación por Telegram.'
        : 'No se pudo leer el link (está roto o no lleva a un lugar).',
    };
  }
  const armado = await addressFromMap(point, '').catch(() => null);
  return {
    link, coordenadas: point, lugar: place || null,
    direccion_del_mapa: armado ? { sugerida: armado.direccion, dudas: armado.dudas } : null,
    ...(armado ? {} : { aviso: 'No se pudieron leer las calles de esa zona: la dirección hay que escribirla a mano.' }),
  };
};
