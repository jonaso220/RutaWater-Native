import { RELATIONSHIP_TYPES } from '../types';
import { parseDate, sanitizePhone, sanitizeProductQty, sanitizeString } from './helpers';

export interface BackupClientRecord {
  id: string;
  customerId: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  lat: string;
  lng: string;
  mapsLink: string;
  freq: 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'once' | 'on_demand';
  visitDay: string;
  visitDays: string[];
  specificDate: string;
  products: Record<string, string>;
  listOrder: number;
  listOrders: Record<string, number>;
  isCompleted: boolean;
  isStarred: boolean;
  isPinned: boolean;
  isNote: boolean;
  isInactive: boolean;
  alarm: string;
  lastVisited: Date | null;
  lastDeliveredAt: Date | null;
  previousDeliveredAt: Date | null;
  completedAt: Date | null;
  doneFor: string;
  relationships: Record<string, string>;
  sameHousehold: Record<string, boolean>;
}

export interface BackupDebtRecord {
  id: string;
  clientId: string;
  clientName: string;
  clientAddress: string;
  amount: number;
  createdAt: Date | null;
}

export interface BackupTransferRecord {
  id: string;
  clientId: string;
  clientName: string;
  clientAddress: string;
  clientLat: string;
  clientLng: string;
  clientMapsLink: string;
  createdAt: Date | null;
}

export interface ValidatedBackup {
  schemaVersion: number;
  exportDate: string;
  exportedBy: string;
  profileName: string;
  clients: BackupClientRecord[];
  debts: BackupDebtRecord[];
  transfers: BackupTransferRecord[];
}

const VALID_DAYS = new Set(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
const VALID_FREQS = new Set(['weekly', 'biweekly', 'triweekly', 'monthly', 'once', 'on_demand']);
const VALID_RELATIONSHIPS = new Set<string>(RELATIONSHIP_TYPES);
const MAX_CLIENTS = 10000;
const MAX_RELATED_RECORDS = 20000;

const isObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');

const finiteNumber = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const safeMapsLink = (value: unknown): string => {
  const link = sanitizeString(typeof value === 'string' ? value : '', 2048);
  return /^https?:\/\/[^\s]+$/i.test(link) ? link : '';
};

const sanitizeProducts = (value: unknown): Record<string, string> => {
  if (!isObject(value)) return {};
  const products: Record<string, string> = {};
  Object.entries(value).slice(0, 200).forEach(([id, quantity]) => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return;
    const clean = sanitizeProductQty(quantity);
    if (clean && clean !== '0') products[id] = clean;
  });
  return products;
};

const sanitizeListOrders = (value: unknown): Record<string, number> => {
  if (!isObject(value)) return {};
  const orders: Record<string, number> = {};
  Object.entries(value).forEach(([day, order]) => {
    const number = Number(order);
    if (VALID_DAYS.has(day) && Number.isFinite(number)) orders[day] = number;
  });
  return orders;
};

const sanitizeRelationships = (value: unknown): Record<string, string> => {
  if (!isObject(value)) return {};
  const relationships: Record<string, string> = {};
  Object.entries(value).slice(0, 500).forEach(([clientId, type]) => {
    if (validId(clientId) && typeof type === 'string' && VALID_RELATIONSHIPS.has(type)) {
      relationships[clientId] = type;
    }
  });
  return relationships;
};

const sanitizeSameHousehold = (value: unknown): Record<string, boolean> => {
  if (!isObject(value)) return {};
  const result: Record<string, boolean> = {};
  Object.entries(value).slice(0, 500).forEach(([clientId, same]) => {
    if (validId(clientId) && typeof same === 'boolean') result[clientId] = same;
  });
  return result;
};

const sanitizeClient = (value: unknown, index: number): BackupClientRecord => {
  if (!isObject(value) || !validId(value.id)) {
    throw new Error(`INVALID_CLIENT_${index}`);
  }
  const name = sanitizeString(value.name, 100);
  if (!name) throw new Error(`INVALID_CLIENT_${index}`);

  const freq = typeof value.freq === 'string' && VALID_FREQS.has(value.freq)
    ? value.freq as BackupClientRecord['freq']
    : 'on_demand';
  const specificDate = typeof value.specificDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.specificDate)
    ? value.specificDate
    : '';
  const doneFor = typeof value.doneFor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.doneFor)
    ? value.doneFor
    : '';

  return {
    id: value.id,
    customerId: validId(value.customerId) ? value.customerId : value.id,
    name,
    phone: sanitizePhone(value.phone),
    address: sanitizeString(value.address, 200),
    notes: sanitizeString(value.notes, 500),
    lat: sanitizeString(value.lat, 20),
    lng: sanitizeString(value.lng, 20),
    mapsLink: safeMapsLink(value.mapsLink),
    freq,
    visitDay: sanitizeString(value.visitDay, 20) || 'Sin Asignar',
    visitDays: Array.isArray(value.visitDays)
      ? value.visitDays.filter((day: unknown): day is string => typeof day === 'string' && VALID_DAYS.has(day))
      : [],
    specificDate,
    products: sanitizeProducts(value.products),
    listOrder: finiteNumber(value.listOrder),
    listOrders: sanitizeListOrders(value.listOrders),
    isCompleted: value.isCompleted === true,
    isStarred: value.isStarred === true,
    isPinned: value.isPinned === true,
    isNote: value.isNote === true,
    isInactive: value.isInactive === true,
    alarm: sanitizeString(value.alarm, 10),
    lastVisited: parseDate(value.lastVisited),
    lastDeliveredAt: parseDate(value.lastDeliveredAt),
    previousDeliveredAt: parseDate(value.previousDeliveredAt),
    completedAt: parseDate(value.completedAt),
    doneFor,
    relationships: sanitizeRelationships(value.relationships),
    sameHousehold: sanitizeSameHousehold(value.sameHousehold),
  };
};

const sanitizeDebt = (value: unknown, index: number): BackupDebtRecord => {
  if (!isObject(value) || !validId(value.id) || !validId(value.clientId)) {
    throw new Error(`INVALID_DEBT_${index}`);
  }
  const amount = finiteNumber(value.amount, -1);
  if (amount <= 0) throw new Error(`INVALID_DEBT_${index}`);
  return {
    id: value.id,
    clientId: value.clientId,
    clientName: sanitizeString(value.clientName, 100),
    clientAddress: sanitizeString(value.clientAddress, 200),
    amount,
    createdAt: parseDate(value.createdAt),
  };
};

const sanitizeTransfer = (value: unknown, index: number): BackupTransferRecord => {
  if (!isObject(value) || !validId(value.id) || !validId(value.clientId)) {
    throw new Error(`INVALID_TRANSFER_${index}`);
  }
  return {
    id: value.id,
    clientId: value.clientId,
    clientName: sanitizeString(value.clientName, 100),
    clientAddress: sanitizeString(value.clientAddress, 200),
    clientLat: sanitizeString(value.clientLat, 20),
    clientLng: sanitizeString(value.clientLng, 20),
    clientMapsLink: safeMapsLink(value.clientMapsLink),
    createdAt: parseDate(value.createdAt),
  };
};

const assertUniqueIds = (records: Array<{ id: string }>, type: string) => {
  const ids = new Set<string>();
  records.forEach((record) => {
    if (ids.has(record.id)) throw new Error(`DUPLICATE_${type}_ID`);
    ids.add(record.id);
  });
};

export const validateBackup = (value: unknown): ValidatedBackup => {
  if (!isObject(value)) throw new Error('INVALID_BACKUP');
  const rawClients = value.clients === undefined ? [] : value.clients;
  const rawDebts = value.debts === undefined ? [] : value.debts;
  const rawTransfers = value.transfers === undefined ? [] : value.transfers;
  if (!Array.isArray(rawClients) || !Array.isArray(rawDebts) || !Array.isArray(rawTransfers)) {
    throw new Error('INVALID_BACKUP');
  }
  if (rawClients.length > MAX_CLIENTS || rawDebts.length > MAX_RELATED_RECORDS || rawTransfers.length > MAX_RELATED_RECORDS) {
    throw new Error('BACKUP_TOO_LARGE');
  }
  if (rawClients.length === 0 && rawDebts.length === 0 && rawTransfers.length === 0) {
    throw new Error('EMPTY_BACKUP');
  }

  const clients = rawClients.map(sanitizeClient);
  const debts = rawDebts.map(sanitizeDebt);
  const transfers = rawTransfers.map(sanitizeTransfer);
  assertUniqueIds(clients, 'CLIENT');
  assertUniqueIds(debts, 'DEBT');
  assertUniqueIds(transfers, 'TRANSFER');

  return {
    schemaVersion: Math.max(1, Math.floor(finiteNumber(value.schemaVersion, 1))),
    exportDate: sanitizeString(value.exportDate, 30),
    exportedBy: sanitizeString(value.exportedBy, 200),
    profileName: sanitizeString(value.profileName, 100),
    clients,
    debts,
    transfers,
  };
};
