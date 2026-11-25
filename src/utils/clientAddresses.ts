import { Client, ClientAddress, ClientAddressType } from '../types';
import { normalizeGoogleMapsLink } from './googleMapsLink';

const VALID_TYPES = new Set<ClientAddressType>(['home', 'work', 'other']);

const cleanText = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const cleanMapsLink = (value: unknown): string =>
  normalizeGoogleMapsLink(cleanText(value, 2048));

export const createClientAddress = (
  id: string,
  type: ClientAddressType = 'home',
): ClientAddress => ({ id, type, address: '', mapsLink: '', lat: '', lng: '' });

export const sanitizeClientAddresses = (value: unknown): ClientAddress[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value.slice(0, 10).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Partial<ClientAddress>;
    let id = cleanText(raw.id, 100) || `address-${index + 1}`;
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);

    const type = VALID_TYPES.has(raw.type as ClientAddressType)
      ? raw.type as ClientAddressType
      : (index === 0 ? 'home' : 'other');
    const address = cleanText(raw.address, 200);
    const mapsLink = cleanMapsLink(raw.mapsLink);
    const lat = cleanText(raw.lat, 20);
    const lng = cleanText(raw.lng, 20);
    if (!address && !mapsLink && !lat && !lng) return [];

    return [{ id, type, address, mapsLink, lat, lng }];
  });
};

/**
 * Returns the saved locations, falling back to the legacy single-location
 * fields. This keeps every existing client usable without a data migration.
 */
export const getClientAddresses = (client: Partial<Client>): ClientAddress[] => {
  const saved = sanitizeClientAddresses(client.addresses);
  if (saved.length > 0) return saved;

  const address = cleanText(client.address, 200);
  const mapsLink = cleanMapsLink(client.mapsLink);
  const lat = cleanText(client.lat, 20);
  const lng = cleanText(client.lng, 20);
  if (!address && !mapsLink && !lat && !lng) return [];

  return [{ id: 'legacy-primary', type: 'home', address, mapsLink, lat, lng }];
};

export const getEditableClientAddresses = (client: Partial<Client>): ClientAddress[] => {
  const addresses = getClientAddresses(client);
  return addresses.length > 0
    ? addresses
    : [createClientAddress('primary', 'home')];
};

export const getClientAddressSearchText = (client: Partial<Client>): string => {
  const addresses = getClientAddresses(client);
  return addresses.length > 0
    ? addresses.map((location) => location.address).filter(Boolean).join(' ')
    : cleanText(client.address, 200);
};

export const getDefaultNewAddressType = (addresses: ClientAddress[]): ClientAddressType => {
  if (!addresses.some((location) => location.type === 'home')) return 'home';
  if (!addresses.some((location) => location.type === 'work')) return 'work';
  return 'other';
};

export const locationFields = (location?: ClientAddress | null) => ({
  address: location?.address || '',
  mapsLink: location?.mapsLink || '',
  lat: location?.lat || '',
  lng: location?.lng || '',
});

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const VALID_WEEKDAYS = new Set(WEEKDAYS);

/** Día de semana (como lo guardan las fichas) de una fecha aaaa-mm-dd. */
export const weekdayOfDateKey = (dateKey: unknown): string => {
  const match = typeof dateKey === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey) : null;
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? '' : WEEKDAYS[date.getDay()];
};

/** Deja solo días de semana válidos con un id de ubicación. */
export const sanitizeAddressByDay = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([day, id]) => {
    const addressId = cleanText(id, 100);
    if (VALID_WEEKDAYS.has(day) && addressId) clean[day] = addressId;
  });
  return clean;
};

export interface ClientDayLocation {
  // Id de la ubicación guardada que se usa ese día; null si la ubicación
  // efectiva de la ficha no coincide con ninguna de la lista.
  addressId: string | null;
  type: ClientAddressType | null;
  address: string;
  mapsLink: string;
  lat: string;
  lng: string;
}

/**
 * Ubicación de la visita de `day`: la elegida para ese día en la tarjeta o,
 * si no se eligió ninguna (o se borró de la ficha), la ubicación efectiva de
 * la ficha (`address/mapsLink/lat/lng`), como hasta ahora.
 */
export const getClientLocationForDay = (
  client: Partial<Client>, day?: string | null,
): ClientDayLocation => {
  const saved = getClientAddresses(client);
  const chosenId = day ? sanitizeAddressByDay(client.addressByDay)[day] : '';
  const chosen = chosenId ? saved.find((location) => location.id === chosenId) : undefined;
  if (chosen) return { addressId: chosen.id, type: chosen.type, ...locationFields(chosen) };

  const address = cleanText(client.address, 200);
  const mapsLink = cleanMapsLink(client.mapsLink);
  const current = saved.find((location) => location.address === address && location.mapsLink === mapsLink)
    || (saved.length === 1 ? saved[0] : undefined);
  return {
    addressId: current?.id ?? null,
    type: current?.type ?? null,
    address,
    mapsLink,
    lat: cleanText(client.lat, 20),
    lng: cleanText(client.lng, 20),
  };
};

/** La misma ficha con la ubicación de `day` en los campos de arriba (solo para leer). */
export const clientAtDayLocation = <T extends Partial<Client>>(client: T, day?: string | null): T => {
  const location = getClientLocationForDay(client, day);
  if (
    location.address === (client.address || '') && location.mapsLink === (client.mapsLink || '')
    && location.lat === (client.lat || '') && location.lng === (client.lng || '')
  ) return client;
  return {
    ...client, address: location.address, mapsLink: location.mapsLink, lat: location.lat, lng: location.lng,
  };
};

/**
 * Elecciones de dirección por día que siguen valiendo: solo días en los que
 * el cliente se visita y ubicaciones que siguen guardadas en la ficha.
 */
export const pruneAddressByDay = (
  value: unknown, days: string[], addresses: ClientAddress[],
): Record<string, string> => {
  const ids = new Set(addresses.map((location) => location.id));
  const clean: Record<string, string> = {};
  Object.entries(sanitizeAddressByDay(value)).forEach(([day, id]) => {
    if (days.includes(day) && ids.has(id)) clean[day] = id;
  });
  return clean;
};
