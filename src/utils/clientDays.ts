import type { Client } from '../types';
import { sanitizeAddressByDay, weekdayOfDateKey } from './clientAddresses';

// A client visited on several weekdays keeps one card per day. Each of those
// cards carries its own order (listOrders), address (addressByDay), products
// (productsByDay) and star (starredByDay), while name, phones, debts and
// history stay those of the one client.
//
// Reading: the value of the day wins; a day without one uses the client's
// shared field, which is also all that older app versions know about.
// Writing: with several visit days only that day's value changes, through its
// own field path (`productsByDay.Martes`), so a write to one day can never
// carry a stale copy of another day. With a single day the shared field
// changes, and that day's own value is dropped so it cannot shadow it.

/** Fields for `update()`: may hold field paths, so it is not a plain Partial<Client>. */
export type ClientDayUpdate = Record<string, unknown>;

const WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const VALID_DAYS = new Set(WEEK);

type Quantities = Record<string, string | number>;

const isMap = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Visit days of the client in week order (older documents hold a single visitDay). */
export const clientVisitDays = (client: Partial<Client>): string[] => {
  const days = Array.isArray(client.visitDays) && client.visitDays.length > 0
    ? client.visitDays
    : (client.visitDay && client.visitDay !== 'Sin Asignar' ? [client.visitDay] : []);
  return WEEK.filter((day) => days.includes(day));
};

/** True when each visit day of the client is a card of its own. */
export const hasSeparateDays = (client: Partial<Client>): boolean => clientVisitDays(client).length > 1;

const cleanQuantities = (value: unknown): Quantities => {
  const clean: Quantities = {};
  if (!isMap(value)) return clean;
  Object.entries(value).forEach(([id, amount]) => {
    const quantity = Number.parseInt(String(amount ?? 0), 10);
    if (id && Number.isFinite(quantity) && quantity > 0) clean[id] = quantity;
  });
  return clean;
};

/** Keeps only weekdays whose value is a product map. An empty map is a real value: nothing that day. */
export const sanitizeProductsByDay = (value: unknown): Record<string, Quantities> => {
  const clean: Record<string, Quantities> = {};
  if (!isMap(value)) return clean;
  Object.entries(value).forEach(([day, products]) => {
    if (VALID_DAYS.has(day) && isMap(products)) clean[day] = cleanQuantities(products);
  });
  return clean;
};

/** Keeps only weekdays with a boolean star. */
export const sanitizeStarredByDay = (value: unknown): Record<string, boolean> => {
  const clean: Record<string, boolean> = {};
  if (!isMap(value)) return clean;
  Object.entries(value).forEach(([day, starred]) => {
    if (VALID_DAYS.has(day) && typeof starred === 'boolean') clean[day] = starred;
  });
  return clean;
};

/** What the client takes on `day`; without a day (Directory), the shared products. */
export const getClientProductsForDay = (client: Partial<Client>, day?: string | null): Quantities => {
  const own = day ? sanitizeProductsByDay(client.productsByDay)[day] : undefined;
  return own ?? (client.products || {});
};

/** Whether the card of `day` is starred; without a day, the shared star. */
export const isClientStarredOnDay = (client: Partial<Client>, day?: string | null): boolean => {
  const own = day ? sanitizeStarredByDay(client.starredByDay)[day] : undefined;
  return own ?? !!client.isStarred;
};

const without = <T>(map: Record<string, T>, day: string): Record<string, T> => {
  const next = { ...map };
  delete next[day];
  return next;
};

/** Fields to write when the products of the card of `day` change. */
export const productsUpdateForDay = (
  client: Partial<Client>, day: string | null | undefined, products: Record<string, number>,
): ClientDayUpdate => {
  const byDay = sanitizeProductsByDay(client.productsByDay);
  if (day && VALID_DAYS.has(day) && hasSeparateDays(client)) {
    return { [`productsByDay.${day}`]: products };
  }
  if (day && day in byDay) return { products, productsByDay: without(byDay, day) };
  return { products };
};

/** Fields to write when the star of the card of `day` changes. */
export const starUpdateForDay = (
  client: Partial<Client>, day: string | null | undefined, starred: boolean,
): ClientDayUpdate => {
  const byDay = sanitizeStarredByDay(client.starredByDay);
  if (day && VALID_DAYS.has(day) && hasSeparateDays(client)) {
    return { [`starredByDay.${day}`]: starred };
  }
  if (day && day in byDay) return { isStarred: starred, starredByDay: without(byDay, day) };
  return { isStarred: starred };
};

/**
 * Star fields after the visit of `occurrence` is completed. Completing a visit
 * clears its star; the other visit days of the client keep theirs.
 */
export const starFieldsAfterVisit = (client: Partial<Client>, occurrence: string): Partial<Client> => {
  const days = clientVisitDays(client);
  const byDay = sanitizeStarredByDay(client.starredByDay);
  if (days.length > 1) {
    const done = weekdayOfDateKey(occurrence);
    const next: Record<string, boolean> = {};
    days.forEach((day) => { next[day] = day === done ? false : isClientStarredOnDay(client, day); });
    return { isStarred: false, starredByDay: next };
  }
  return Object.keys(byDay).length ? { isStarred: false, starredByDay: {} } : { isStarred: false };
};

/**
 * Per-day fields after the visit days change, so each card keeps what it had:
 * a single day that moves takes its values along, days that are removed lose
 * theirs, and a client left with one day folds that day's products and star
 * back into the shared fields. A client that had no visit days, or is left
 * without any, starts clean: values of an earlier schedule must not come back
 * over what is set next. Returns only the fields that change.
 */
export const dayFieldsAfterDaysChange = (
  client: Partial<Client>, previousDays: string[], nextDays: string[],
): Partial<Client> => {
  const moved = previousDays.length === 1 && nextDays.length === 1 && previousDays[0] !== nextDays[0]
    ? { from: previousDays[0], to: nextDays[0] } : null;
  const carry = <T>(map: Record<string, T>): Record<string, T> => {
    const next: Record<string, T> = {};
    Object.entries(map).forEach(([day, value]) => {
      const target = moved && day === moved.from ? moved.to : day;
      if (nextDays.includes(target) && !(target in next)) next[target] = value;
    });
    return next;
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const updates: Partial<Client> = {};

  if (previousDays.length === 0 || nextDays.length === 0) {
    const last = previousDays.length === 1 ? sanitizeProductsByDay(client.productsByDay)[previousDays[0]] : undefined;
    if (last && !same(cleanQuantities(client.products), last)) updates.products = last;
    if (Object.keys(sanitizeAddressByDay(client.addressByDay)).length) updates.addressByDay = {};
    if (Object.keys(sanitizeProductsByDay(client.productsByDay)).length) updates.productsByDay = {};
    if (Object.keys(sanitizeStarredByDay(client.starredByDay)).length) updates.starredByDay = {};
    return updates;
  }

  const addresses = sanitizeAddressByDay(client.addressByDay);
  const nextAddresses = carry(addresses);
  if (!same(addresses, nextAddresses)) updates.addressByDay = nextAddresses;

  const products = sanitizeProductsByDay(client.productsByDay);
  const stars = sanitizeStarredByDay(client.starredByDay);
  let nextProducts = carry(products);
  let nextStars = carry(stars);
  if (nextDays.length === 1) {
    const only = nextDays[0];
    if (only in nextProducts) {
      if (!same(cleanQuantities(client.products), nextProducts[only])) updates.products = nextProducts[only];
      nextProducts = {};
    }
    if (only in nextStars) {
      if (!!client.isStarred !== nextStars[only]) updates.isStarred = nextStars[only];
      nextStars = {};
    }
  }
  if (!same(products, nextProducts)) updates.productsByDay = nextProducts;
  if (!same(stars, nextStars)) updates.starredByDay = nextStars;
  return updates;
};
