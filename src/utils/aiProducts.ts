import { Product } from '../constants/products';
import { Client } from '../types';

export type AiLocale = 'es' | 'en' | 'pt';

export interface AiProductCatalogItem {
  id: string;
  label: string;
  short: string;
  hidden: boolean;
}

export interface AiClientPayload {
  id: string;
  name: string;
  address: string;
  freq: string;
  visitDay: string;
  visitDays: string[];
  specificDate: string;
  products: Record<string, number>;
  notes: string;
  isCompleted: boolean;
}

export interface AiParseContext {
  sourceText: string;
  todayIso: string;
  locale: AiLocale;
  catalogScopeKey: string;
  catalogGeneration: number;
  catalogFingerprint: string;
  clientsScopeKey: string;
  clientsFingerprint: string;
}

export class AiProductError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AiProductError';
  }
}

const MAX_CATALOG_ITEMS = 64;
const SAFE_PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const PRODUCT_FIELDS = ['products', 'add_products', 'remove_products'] as const;
const TOOL_NAMES = new Set([
  'create_new_client',
  'schedule_existing_client',
  'merge_products_into_order',
  'update_client_data',
  'add_standalone_note',
  'report_not_found',
  'report_no_action',
]);
const FREQUENCIES = new Set(['weekly', 'biweekly', 'triweekly', 'monthly', 'once', 'on_demand']);
const SCHEDULE_FREQUENCIES = new Set([...FREQUENCIES, 'keep']);
const VISIT_DAYS = new Set(['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
const NOTES_MODES = new Set(['append', 'replace', 'clear', 'keep']);
const TOOL_KEYS: Record<string, string[]> = {
  create_new_client: ['name', 'phone', 'address', 'mapsLink', 'notes', 'products', 'freq', 'visitDay', 'specificDate'],
  schedule_existing_client: ['matched_client_id', 'matched_client_name', 'products', 'add_products', 'remove_products', 'freq', 'visitDay', 'specificDate', 'schedule_mode', 'notes', 'notes_mode'],
  merge_products_into_order: ['matched_client_id', 'matched_client_name', 'add_products', 'remove_products', 'notes', 'notes_mode'],
  update_client_data: ['matched_client_id', 'matched_client_name', 'mapsLink', 'address', 'phone', 'notes', 'notes_mode'],
  add_standalone_note: ['notes', 'specificDate'],
  report_not_found: ['mentioned_name', 'reason'],
  report_no_action: ['message'],
};

export const getAiLocale = (language: string | undefined): AiLocale => {
  const base = (language || '').toLowerCase().split(/[-_]/)[0];
  return base === 'en' || base === 'pt' ? base : 'es';
};

export const buildAiProductCatalog = (
  allProducts: Product[],
  hiddenIds: string[],
): AiProductCatalogItem[] => {
  if (!Array.isArray(allProducts) || allProducts.length === 0 || allProducts.length > MAX_CATALOG_ITEMS) {
    throw new AiProductError('AI_PRODUCT_CATALOG_INVALID');
  }
  const hidden = new Set(hiddenIds);
  const seen = new Set<string>();
  return allProducts.map((product) => {
    const id = typeof product.id === 'string' ? product.id.trim() : '';
    const label = typeof product.label === 'string' ? product.label.trim() : '';
    const short = typeof product.short === 'string' ? product.short.trim() : '';
    if (
      !id || id.length > 80 || !SAFE_PRODUCT_ID.test(id) || UNSAFE_KEYS.has(id) || seen.has(id)
      || !label || label.length > 80 || short.length > 32
      || CONTROL_CHARACTERS.test(label) || CONTROL_CHARACTERS.test(short)
    ) {
      throw new AiProductError('AI_PRODUCT_CATALOG_INVALID');
    }
    seen.add(id);
    return { id, label, short, hidden: hidden.has(id) };
  });
};

const positiveProductMap = (value: unknown): Record<string, number> => {
  const products: Record<string, number> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return products;
  for (const [id, raw] of Object.entries(value)) {
    const amount = typeof raw === 'number'
      ? raw
      : (typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN);
    if (Number.isInteger(amount) && amount > 0 && amount <= 9999) products[id] = amount;
  }
  return products;
};

export const buildAiClientPayload = (source: Client[]): AiClientPayload[] => {
  const clients = source.filter((client) => client.name && !client.isNote);
  const grouped = new Map<string, Client[]>();
  for (const client of clients) {
    const key = `${(client.name || '').toLowerCase().trim()}|${(client.phone || '').replace(/\D/g, '')}`;
    const group = grouped.get(key) || [];
    group.push(client);
    grouped.set(key, group);
  }

  const visible: Client[] = [];
  for (const group of grouped.values()) {
    const hasActive = group.some(
      (client) => !client.isCompleted && client.freq && client.freq !== 'on_demand',
    );
    for (const client of group) {
      if (hasActive && client.freq === 'on_demand') continue;
      visible.push(client);
    }
  }

  return visible.map((client) => ({
    id: client.id,
    name: client.name,
    address: client.address || '',
    freq: client.freq || 'on_demand',
    visitDay: client.visitDay || '',
    visitDays: client.visitDays || [],
    specificDate: client.specificDate || '',
    products: positiveProductMap(client.products),
    notes: client.notes || '',
    isCompleted: Boolean(client.isCompleted),
  }));
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
};

const fingerprint = (value: unknown): string => {
  const text = JSON.stringify(stableValue(value));
  let fnv = 0x811c9dc5;
  let mixed = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    fnv ^= code;
    fnv = Math.imul(fnv, 0x01000193);
    mixed = Math.imul(mixed ^ code, 0x85ebca6b);
    mixed ^= mixed >>> 13;
  }
  return `${text.length}:${(fnv >>> 0).toString(16).padStart(8, '0')}:${(mixed >>> 0).toString(16).padStart(8, '0')}`;
};

export const fingerprintCatalog = (catalog: AiProductCatalogItem[]): string => fingerprint(catalog);

const timestampValue = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value ?? null;
  const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  return { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
};

export const fingerprintClientState = (clients: Client[]): string => fingerprint(
  clients
    .map((client) => ({
      id: client.id,
      customerId: client.customerId || '',
      name: client.name,
      phone: client.phone || '',
      address: client.address || '',
      addresses: client.addresses || [],
      mapsLink: client.mapsLink || '',
      lat: client.lat || '',
      lng: client.lng || '',
      notes: client.notes || '',
      freq: client.freq || 'on_demand',
      visitDay: client.visitDay || '',
      visitDays: client.visitDays || [],
      specificDate: client.specificDate || '',
      products: positiveProductMap(client.products),
      listOrder: client.listOrder,
      listOrders: client.listOrders || {},
      isCompleted: Boolean(client.isCompleted),
      isStarred: Boolean(client.isStarred),
      isPinned: Boolean(client.isPinned),
      isInactive: Boolean(client.isInactive),
      isNote: Boolean(client.isNote),
      alarm: client.alarm || '',
      alarmDay: client.alarmDay || '',
      doneFor: client.doneFor || '',
      lastVisited: timestampValue(client.lastVisited),
      lastDeliveredAt: timestampValue(client.lastDeliveredAt),
      previousDeliveredAt: timestampValue(client.previousDeliveredAt),
      completedAt: timestampValue(client.completedAt),
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
);

const normalizeStrictMap = (
  value: unknown,
  allowed: Set<string>,
): Record<string, number> => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiProductError('AI_PRODUCT_MAP_INVALID');
  }
  const normalized: Record<string, number> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!allowed.has(id)) throw new AiProductError('AI_PRODUCT_ID_NOT_ALLOWED');
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 9999) {
      throw new AiProductError('AI_PRODUCT_QUANTITY_INVALID');
    }
    if (raw > 0) normalized[id] = raw;
  }
  return normalized;
};

const currentAmount = (client: AiClientPayload | undefined, id: string): number => (
  client?.products[id] || 0
);

const normalizeClientName = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const assertString = (
  input: Record<string, unknown>,
  key: string,
  nonEmpty = false,
): void => {
  const value = input[key];
  if (typeof value !== 'string' || (nonEmpty && !value.trim())) {
    throw new AiProductError('AI_TOOL_INPUT_INVALID');
  }
};

const assertDateString = (value: unknown, allowEmpty: boolean): void => {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const date = match ? new Date(`${value}T12:00:00Z`) : null;
  const isCalendarDate = Boolean(
    match
    && date
    && !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]),
  );
  if (typeof value !== 'string' || (!allowEmpty && !value) || (value && !isCalendarDate)) {
    throw new AiProductError('AI_TOOL_INPUT_INVALID');
  }
};

const assertToolShape = (
  tool: string,
  input: Record<string, unknown>,
  clients: AiClientPayload[],
): void => {
  if (!TOOL_NAMES.has(tool)) throw new AiProductError('AI_TOOL_INVALID');
  const keys = TOOL_KEYS[tool];
  const allowed = new Set(keys);
  if (
    keys.some((key) => !Object.prototype.hasOwnProperty.call(input, key))
    || Object.keys(input).some((key) => !allowed.has(key))
  ) {
    throw new AiProductError('AI_TOOL_INPUT_INVALID');
  }

  if (tool === 'create_new_client') {
    assertString(input, 'name', true);
    for (const key of ['phone', 'address', 'mapsLink', 'notes', 'visitDay']) assertString(input, key);
    assertDateString(input.specificDate, true);
    if (!FREQUENCIES.has(input.freq as string) || !VISIT_DAYS.has(input.visitDay as string)) {
      throw new AiProductError('AI_TOOL_INPUT_INVALID');
    }
    if (clients.some((client) => normalizeClientName(client.name) === normalizeClientName(input.name))) {
      throw new AiProductError('AI_CLIENT_ALREADY_EXISTS');
    }
  } else if (tool === 'schedule_existing_client') {
    assertString(input, 'matched_client_id', true);
    assertString(input, 'matched_client_name', true);
    assertString(input, 'visitDay');
    assertString(input, 'notes');
    assertDateString(input.specificDate, true);
    if (
      !SCHEDULE_FREQUENCIES.has(input.freq as string)
      || !VISIT_DAYS.has(input.visitDay as string)
      || !['add', 'replace'].includes(input.schedule_mode as string)
      || !NOTES_MODES.has(input.notes_mode as string)
    ) throw new AiProductError('AI_TOOL_INPUT_INVALID');
  } else if (tool === 'merge_products_into_order') {
    assertString(input, 'matched_client_id', true);
    assertString(input, 'matched_client_name', true);
    assertString(input, 'notes');
    if (!NOTES_MODES.has(input.notes_mode as string)) throw new AiProductError('AI_TOOL_INPUT_INVALID');
  } else if (tool === 'update_client_data') {
    assertString(input, 'matched_client_id', true);
    assertString(input, 'matched_client_name', true);
    for (const key of ['mapsLink', 'address', 'phone', 'notes']) assertString(input, key);
    if (!NOTES_MODES.has(input.notes_mode as string)) throw new AiProductError('AI_TOOL_INPUT_INVALID');
  } else if (tool === 'add_standalone_note') {
    assertString(input, 'notes', true);
    assertDateString(input.specificDate, false);
  } else if (tool === 'report_not_found') {
    assertString(input, 'mentioned_name', true);
    assertString(input, 'reason', true);
  } else {
    assertString(input, 'message', true);
  }

  if (['schedule_existing_client', 'merge_products_into_order', 'update_client_data'].includes(tool)) {
    const matchedClient = clients.find((client) => client.id === input.matched_client_id);
    if (!matchedClient) {
      throw new AiProductError('AI_PRODUCT_CLIENT_NOT_FOUND');
    }
    if (normalizeClientName(input.matched_client_name) !== normalizeClientName(matchedClient.name)) {
      throw new AiProductError('AI_PRODUCT_CLIENT_NAME_MISMATCH');
    }
    if (matchedClient.isCompleted) throw new AiProductError('AI_CLIENT_COMPLETED');
    if (tool === 'schedule_existing_client') {
      const isDirectoryOnly = !matchedClient.freq || matchedClient.freq === 'on_demand';
      const effectiveFreq = input.freq === 'keep' ? (matchedClient.freq || 'on_demand') : input.freq;
      if (isDirectoryOnly && input.schedule_mode !== 'replace') {
        throw new AiProductError('AI_SCHEDULE_MODE_INVALID');
      }
      if (
        input.schedule_mode === 'add'
        && (isDirectoryOnly || effectiveFreq !== 'once' || !input.specificDate)
      ) {
        throw new AiProductError('AI_SCHEDULE_MODE_INVALID');
      }
    }
  }
};

export const validateAiProductResult = <T extends { tool: string; input: unknown }>(
  result: T,
  catalog: AiProductCatalogItem[],
  clients: AiClientPayload[],
): T => {
  const visible = new Set(catalog.filter((product) => !product.hidden).map((product) => product.id));
  const known = new Set(catalog.map((product) => product.id));
  if (!result.input || typeof result.input !== 'object' || Array.isArray(result.input)) {
    throw new AiProductError('AI_TOOL_INPUT_INVALID');
  }
  const input: Record<string, unknown> = { ...(result.input as Record<string, unknown>) };
  assertToolShape(result.tool, input, clients);
  const allowedByField = { products: visible, add_products: visible, remove_products: known };
  for (const field of PRODUCT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      input[field] = normalizeStrictMap(input[field], allowedByField[field]);
    }
  }

  const products = (input.products || {}) as Record<string, number>;
  const additions = (input.add_products || {}) as Record<string, number>;
  const removals = (input.remove_products || {}) as Record<string, number>;
  const absoluteCount = Object.keys(products).length;
  const deltaCount = Object.keys(additions).length + Object.keys(removals).length;
  if (absoluteCount > 0 && deltaCount > 0) {
    throw new AiProductError('AI_PRODUCT_ABSOLUTE_DELTA_CONFLICT');
  }

  const clientId = typeof input.matched_client_id === 'string' ? input.matched_client_id : '';
  const client = clients.find((candidate) => candidate.id === clientId);
  if (deltaCount > 0 && !client) throw new AiProductError('AI_PRODUCT_CLIENT_NOT_FOUND');
  for (const [id, amount] of Object.entries(removals)) {
    if (currentAmount(client, id) <= 0) throw new AiProductError('AI_PRODUCT_REMOVE_NOT_PRESENT');
    if (Object.prototype.hasOwnProperty.call(additions, id)) {
      throw new AiProductError('AI_PRODUCT_DELTA_CONFLICT');
    }
    if (amount <= 0) throw new AiProductError('AI_PRODUCT_QUANTITY_INVALID');
  }
  for (const [id, amount] of Object.entries(additions)) {
    if (currentAmount(client, id) + amount > 9999) {
      throw new AiProductError('AI_PRODUCT_QUANTITY_INVALID');
    }
  }

  return { ...result, input } as T;
};

const productMapsEqual = (left: Record<string, number>, right: Record<string, number>): boolean => {
  const leftIds = Object.keys(left).sort();
  const rightIds = Object.keys(right).sort();
  return leftIds.length === rightIds.length
    && leftIds.every((id, index) => id === rightIds[index] && left[id] === right[id]);
};

export const applyAiProductChange = (
  currentValue: unknown,
  input: {
    products?: Record<string, number>;
    add_products?: Record<string, number>;
    remove_products?: Record<string, number>;
  },
  catalog: AiProductCatalogItem[],
): { products: Record<string, number>; changed: boolean; hadProductIntent: boolean } => {
  const current = positiveProductMap(currentValue);
  const absolute = input.products || {};
  const additions = input.add_products || {};
  const removals = input.remove_products || {};
  const hasAbsolute = Object.keys(absolute).length > 0;
  const hasDelta = Object.keys(additions).length > 0 || Object.keys(removals).length > 0;
  let next = { ...current };

  if (hasAbsolute) {
    const catalogById = new Map(catalog.map((product) => [product.id, product]));
    next = {};
    // An absolute set replaces only the visible catalog. Hidden and orphaned
    // historical values are preserved so an AI schedule cannot erase them.
    for (const [id, amount] of Object.entries(current)) {
      const product = catalogById.get(id);
      if (!product || product.hidden) next[id] = amount;
    }
    Object.assign(next, absolute);
  } else if (hasDelta) {
    for (const [id, amount] of Object.entries(additions)) next[id] = (next[id] || 0) + amount;
    for (const [id, amount] of Object.entries(removals)) {
      const remaining = (next[id] || 0) - amount;
      if (remaining > 0) next[id] = remaining;
      else delete next[id];
    }
  }

  return {
    products: next,
    changed: !productMapsEqual(current, next),
    hadProductIntent: hasAbsolute || hasDelta,
  };
};
