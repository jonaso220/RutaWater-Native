import type { Client } from '../types';
import { getNextVisitDate, parseDate, toLocalDateString, visitStateKey } from './helpers';
import { getLastVisitDate } from './recency';
import { isValidCalendarDate } from './scheduling';

// Commands contain JSON values only, so Firestore can persist/replay them offline.
// Never queue an unconditional lastVisited update: its eventual arrival could
// overwrite a more recent delivery or a newly scheduled visit.
export interface VisitCommand {
  id: string;
  actorId: string;
  scopeKey: string;
  kind: 'complete' | 'undo' | 'undoLegacy';
  occurrence: string;
  expected: string;
  at: number;
  targetId: string;
  deleteNote: boolean;
}

type SavedFields = Record<string, string | number | boolean | null>;
export interface VisitReceipt {
  occurrence: string;
  expected: string;
  after: string;
  before: SavedFields;
  confirmations: Record<string, string>;
  cancelled: string[];
}

export type VisitOutcome = 'applied' | 'confirmed' | 'undone' | 'kept' | 'stale';
export interface VisitResult { id: string; actorId: string; outcome: VisitOutcome }

const dateFields = new Set(['lastVisited', 'lastDeliveredAt', 'previousDeliveredAt', 'completedAt']);
const savedKeys = [
  'isCompleted', 'lastVisited', 'lastDeliveredAt', 'previousDeliveredAt',
  'completedAt', 'doneFor', 'specificDate', 'alarm', 'alarmDay',
  'alarmScheduledFor', 'isStarred',
] as const;

export const newVisitId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export { visitStateKey } from './helpers';

export const scheduleChanged = (client: Client, updates: Partial<Client>): boolean =>
  ['freq', 'visitDay', 'visitDays', 'specificDate', 'isInactive'].some((key) => {
    if (!(key in updates)) return false;
    const a = (client as any)[key];
    const b = (updates as any)[key];
    return JSON.stringify(Array.isArray(a) ? [...a].sort() : a ?? '')
      !== JSON.stringify(Array.isArray(b) ? [...b].sort() : b ?? '');
  });

export const createVisitCommand = (
  client: Client, actorId: string, forDay?: string, at = Date.now(),
): VisitCommand | null => {
  if (!actorId || client.freq === 'on_demand' || client.isCompleted) return null;
  const date = getNextVisitDate(client, forDay);
  if (!date) return null;
  return {
    id: newVisitId(), actorId, scopeKey: client.groupId || client.userId,
    kind: 'complete', occurrence: toLocalDateString(date),
    expected: visitStateKey(client), at, targetId: '', deleteNote: client.isNote && client.freq === 'once',
  };
};

export const createUndoCommand = (command: VisitCommand): VisitCommand => ({
  ...command, id: newVisitId(), kind: 'undo', targetId: command.id, at: Date.now(),
});

export const undoForCompletedClient = (client: Client, actorId: string): VisitCommand | null => {
  const receipt = client.visitReceipt;
  if (receipt) {
    const targetId = Object.keys(receipt.confirmations).find((id) => receipt.confirmations[id] === actorId);
    if (!targetId) return null;
    return {
      id: newVisitId(), kind: 'undo', targetId, actorId,
      scopeKey: client.groupId || client.userId, occurrence: receipt.occurrence,
      expected: receipt.expected, at: Date.now(), deleteNote: false,
    };
  }
  // Completed one-time orders from before this protocol remain undoable, but
  // only if their exact delivery/schedule state is still the one on screen.
  if (client.freq !== 'once' || !client.isCompleted) return null;
  return {
    id: newVisitId(), kind: 'undoLegacy', targetId: '', actorId,
    scopeKey: client.groupId || client.userId, occurrence: client.specificDate || '',
    expected: visitStateKey(client), at: Date.now(), deleteNote: false,
  };
};

const saveFields = (client: Client): SavedFields => Object.fromEntries(savedKeys.map((key) => {
  const value = client[key];
  return [key, dateFields.has(key) ? parseDate(value as any)?.getTime() ?? null
    : value ?? (key === 'isCompleted' || key === 'isStarred' ? false
      : key === 'alarmScheduledFor' ? null : '')];
})) as SavedFields;

const restoreFields = (saved: SavedFields): Partial<Client> => Object.fromEntries(
  Object.entries(saved).map(([key, value]) => [key,
    dateFields.has(key) && typeof value === 'number' ? new Date(value) : value]),
) as Partial<Client>;

const completedFields = (client: Client, command: VisitCommand): Partial<Client> => {
  const deliveredAt = new Date(Math.max(command.at, getLastVisitDate(client)?.getTime() || 0));
  const updates: Partial<Client> = {
    lastDeliveredAt: deliveredAt as any, alarm: '', alarmDay: '',
    alarmScheduledFor: null, isStarred: false,
  };
  if (client.freq === 'once') {
    updates.isCompleted = true;
    updates.completedAt = deliveredAt as any;
    updates.previousDeliveredAt = getLastVisitDate(client) as any;
  } else {
    updates.lastVisited = new Date(command.at) as any;
    updates.doneFor = command.occurrence;
    updates.specificDate = '';
  }
  return updates;
};

export interface VisitTransition {
  client: Client | null;
  updates: Partial<Client>;
  outcome: VisitOutcome;
}

/** Pure reducer shared by optimistic reads and the retryable transaction. */
export const applyVisitCommand = (client: Client, command: VisitCommand): VisitTransition => {
  const unchanged = (outcome: VisitOutcome = 'stale'): VisitTransition => ({ client, updates: {}, outcome });
  if (!command || typeof command.id !== 'string' || !/^[a-zA-Z0-9-]{1,200}$/.test(command.id)
    || typeof command.actorId !== 'string' || !command.actorId || !Number.isFinite(command.at)
    || typeof command.expected !== 'string'
    || (command.kind !== 'undoLegacy' && !isValidCalendarDate(command.occurrence))
    || command.scopeKey !== (client.groupId || client.userId)) return unchanged();
  const key = visitStateKey(client);
  const receipt = client.visitReceipt;
  const liveReceipt = receipt && receipt.after === key;
  const finish = (updates: Partial<Client>, outcome: VisitOutcome): VisitTransition => ({
    client: { ...client, ...updates }, updates, outcome,
  });

  if (command.kind === 'undoLegacy') {
    if (receipt || key !== command.expected || client.freq !== 'once' || !client.isCompleted) return unchanged();
    return finish({ isCompleted: false, completedAt: null,
      lastDeliveredAt: client.previousDeliveredAt || null, previousDeliveredAt: null }, 'undone');
  }

  if (command.kind === 'undo') {
    // Undo can reach Firestore before Complete (for example, native alarm
    // cancellation is still running). Preserve a tombstone rather than
    // discarding the undo and later resurrecting that same operation.
    if (!liveReceipt) {
      if (key !== command.expected || !command.targetId) return unchanged();
      return finish({ visitReceipt: {
        occurrence: command.occurrence, expected: key, after: key,
        before: saveFields(client), confirmations: {}, cancelled: [command.targetId],
      } }, 'undone');
    }
    if (receipt.expected !== command.expected || receipt.occurrence !== command.occurrence) return unchanged();
    if (receipt.cancelled.includes(command.targetId)) return unchanged('undone');
    if (!receipt.confirmations[command.targetId]) {
      if (receipt.cancelled.length >= 100) return unchanged();
      return finish({ visitReceipt: { ...receipt, cancelled: [...receipt.cancelled, command.targetId] } },
        Object.keys(receipt.confirmations).length ? 'kept' : 'undone');
    }
    if (receipt.confirmations[command.targetId] !== command.actorId) return unchanged();
    const confirmations = { ...receipt.confirmations };
    delete confirmations[command.targetId];
    const nextReceipt = { ...receipt, confirmations,
      cancelled: [...receipt.cancelled, command.targetId] };
    if (Object.keys(confirmations).length) {
      return finish({ visitReceipt: nextReceipt }, 'kept');
    }
    const updates = restoreFields(receipt.before);
    // Do not erase an alarm/star added after completion. Expired one-shots
    // must not be resurrected on this or another household member's device.
    if (client.alarm) {
      delete updates.alarm; delete updates.alarmDay; delete updates.alarmScheduledFor;
    } else if (typeof updates.alarmScheduledFor === 'number' && updates.alarmScheduledFor <= command.at) {
      updates.alarm = ''; updates.alarmDay = ''; updates.alarmScheduledFor = null;
    }
    if (client.isStarred) delete updates.isStarred;
    nextReceipt.after = visitStateKey({ ...client, ...updates });
    return finish({ ...updates, visitReceipt: nextReceipt }, 'undone');
  }

  if (command.kind !== 'complete' || client.freq === 'on_demand') return unchanged();
  if (liveReceipt && receipt.expected === command.expected && receipt.occurrence === command.occurrence) {
    if (receipt.cancelled.includes(command.id)) return unchanged('undone');
    if (receipt.confirmations[command.id]) return unchanged('confirmed');
    if (Object.keys(receipt.confirmations).length + receipt.cancelled.length >= 100) return unchanged();
    const confirmations = { ...receipt.confirmations, [command.id]: command.actorId };
    // One acknowledgement per member: repeated taps do not make their own
    // delivery impossible to undo. Keep the original operation id for retries.
    if (Object.values(receipt.confirmations).includes(command.actorId)) return unchanged('confirmed');
    const reactivating = Object.keys(receipt.confirmations).length === 0;
    const updates = reactivating ? completedFields(client, command) : {};
    const nextReceipt = { ...receipt, confirmations,
      before: reactivating ? saveFields(client) : receipt.before,
      after: visitStateKey({ ...client, ...updates }) };
    return finish({ ...updates, visitReceipt: nextReceipt }, 'confirmed');
  }

  if (key !== command.expected || client.isCompleted) return unchanged();
  if (client.isNote && client.freq === 'once') return { client: null, updates: {}, outcome: 'applied' };
  const updates = completedFields(client, command);
  const completed = { ...client, ...updates };
  const nextReceipt: VisitReceipt = {
    occurrence: command.occurrence, expected: key, after: visitStateKey(completed),
    before: saveFields(client),
    confirmations: { [command.id]: command.actorId }, cancelled: [],
  };
  return finish({ ...updates, visitReceipt: nextReceipt }, 'applied');
};

export const projectVisitCommands = (client: Client): Client | null => {
  let projected: Client | null = client;
  for (const command of Array.isArray(client.visitCommands) ? client.visitCommands : []) {
    if (!projected) break;
    projected = applyVisitCommand(projected, command).client;
  }
  return projected;
};
