import { Client, ClientPhone } from '../types';
import { normalizePhoneForComparison, sanitizePhone } from './helpers';

const MAX_CLIENT_PHONES = 5;

const cleanId = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, 100) || fallback;
};

const phoneKey = (number: string): string =>
  normalizePhoneForComparison(number) || number.replace(/\D/g, '');

export const createClientPhone = (
  id: string,
  isPrimary = false,
): ClientPhone => ({ id, number: '', isPrimary });

/**
 * Keeps editable rows intact while ensuring the draft has a single primary.
 * Empty rows cannot remain primary while another row contains a number.
 */
export const normalizeEditableClientPhones = (phones: ClientPhone[]): ClientPhone[] => {
  if (phones.length === 0) return [];

  const selectedIndex = phones.findIndex(
    (phone) => phone.isPrimary && !!phone.number.trim(),
  );
  const firstNonEmptyIndex = phones.findIndex((phone) => !!phone.number.trim());
  const primaryIndex = selectedIndex >= 0
    ? selectedIndex
    : firstNonEmptyIndex >= 0
      ? firstNonEmptyIndex
      : 0;

  return phones.map((phone, index) => ({
    ...phone,
    isPrimary: index === primaryIndex,
  }));
};

/**
 * Cleans a saved phone catalog, removes duplicates and guarantees one primary
 * number whenever at least one non-empty number remains.
 */
export const sanitizeClientPhones = (value: unknown): ClientPhone[] => {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenNumbers = new Set<string>();

  const phones = value.slice(0, MAX_CLIENT_PHONES).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Partial<ClientPhone>;
    const number = sanitizePhone(raw.number).trim();
    if (!number) return [];

    const key = phoneKey(number);
    if (key && seenNumbers.has(key)) return [];
    if (key) seenNumbers.add(key);

    let id = cleanId(raw.id, `phone-${index + 1}`);
    if (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);

    return [{ id, number, isPrimary: raw.isPrimary === true }];
  });

  if (phones.length === 0) return [];
  const selectedIndex = phones.findIndex((phone) => phone.isPrimary);
  const primaryIndex = selectedIndex >= 0 ? selectedIndex : 0;
  return phones.map((phone, index) => ({
    ...phone,
    isPrimary: index === primaryIndex,
  }));
};

/**
 * Reads the additive catalog while treating legacy `phone` as authoritative.
 * This also keeps edits made by older app versions or the AI contact updater
 * visible as the new principal number instead of resurrecting stale data.
 */
export const getClientPhones = (client: Partial<Client>): ClientPhone[] => {
  const saved = sanitizeClientPhones(client.phones);
  const legacyPrimary = sanitizePhone(client.phone).trim();
  if (!legacyPrimary) return saved;

  const legacyKey = phoneKey(legacyPrimary);
  const matchingIndex = saved.findIndex((phone) => phoneKey(phone.number) === legacyKey);
  if (matchingIndex >= 0) {
    return saved.map((phone, index) => ({
      ...phone,
      number: index === matchingIndex ? legacyPrimary : phone.number,
      isPrimary: index === matchingIndex,
    }));
  }

  return [
    { id: 'legacy-primary', number: legacyPrimary, isPrimary: true },
    ...saved.slice(0, MAX_CLIENT_PHONES - 1).map((phone) => ({ ...phone, isPrimary: false })),
  ];
};

export const getEditableClientPhones = (client: Partial<Client>): ClientPhone[] => {
  const phones = getClientPhones(client);
  return phones.length > 0
    ? phones
    : [createClientPhone('primary', true)];
};

export const getPrimaryClientPhone = (phones: ClientPhone[]): ClientPhone | undefined => {
  const clean = sanitizeClientPhones(phones);
  return clean.find((phone) => phone.isPrimary) || clean[0];
};

export const getClientPhoneSearchText = (client: Partial<Client>): string =>
  getClientPhones(client).map((phone) => phone.number).join(' ');
