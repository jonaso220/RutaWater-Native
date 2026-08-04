import { Client, ClientAddress, ClientAddressType } from '../types';

const VALID_TYPES = new Set<ClientAddressType>(['home', 'work', 'other']);

const cleanText = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const cleanMapsLink = (value: unknown): string => cleanText(value, 2048);

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
