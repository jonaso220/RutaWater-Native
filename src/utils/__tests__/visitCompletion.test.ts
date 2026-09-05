import { Client } from '../../types';
import { withDefaults } from '../clientDefaults';
import { getNextVisitDate, parseDate, toLocalDateString } from '../helpers';
import {
  applyVisitCommand, createVisitCommand, createUndoCommand, projectVisitCommands,
  scheduleChanged, undoForCompletedClient, visitStateKey, VisitCommand,
} from '../visitCompletion';

const NOW = new Date(2026, 8, 7, 10);
const base = (fields: Partial<Client> = {}): Client => withDefaults('c1', {
  userId: 'owner', groupId: 'family', name: 'Juan', freq: 'biweekly',
  visitDay: 'Sábado', visitDays: ['Sábado'], doneFor: '2026-08-22',
  lastVisited: new Date(2026, 7, 22, 10), lastDeliveredAt: new Date(2026, 7, 22, 10),
  ...fields,
});
const command = (client: Client, actorId = 'A') => createVisitCommand(client, actorId, 'Sábado')!;
const apply = (client: Client, op: VisitCommand) => applyVisitCommand(client, op).client!;
const next = (client: Client) => toLocalDateString(getNextVisitDate(client, 'Sábado')!);

beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
afterEach(() => { jest.useRealTimers(); });

test.each(['weekly', 'biweekly', 'triweekly', 'monthly'] as const)(
  '%s: concurrent family confirmations advance exactly once, in either arrival order', (freq) => {
    const client = base({ freq });
    const a = command(client, 'A'); const b = command(client, 'B');
    for (const [first, second] of [[a, b], [b, a]]) {
      const once = apply(client, first);
      const twice = apply(once, second);
      expect(next(twice)).toBe(next(once));
      expect(twice.lastDeliveredAt).toEqual(once.lastDeliveredAt);
      expect(Object.values(twice.visitReceipt!.confirmations).sort()).toEqual(['A', 'B']);
    }
  },
);

test('late Saturday completion on Monday keeps 19/9 with two stale cards', () => {
  const client = base();
  const a = command(client); const b = command(client, 'B');
  expect(next(apply(apply(client, a), b))).toBe('2026-09-19');
});

test('the command freezes the occurrence even if a dialog remains open or the day changes', () => {
  const client = base(); const op = command(client);
  jest.setSystemTime(new Date(2026, 8, 8, 1));
  expect(op.occurrence).toBe('2026-09-05');
  expect(apply(client, op).doneFor).toBe('2026-09-05');
});

test('future visit has its own explicit occurrence, and does not mutate the old intent', () => {
  const client = base(); const a = command(client);
  const completed = apply(client, a); const future = command(completed, 'B');
  expect(a.occurrence).toBe('2026-09-05');
  expect(future.occurrence).toBe('2026-09-19');
  expect(future.expected).not.toBe(a.expected);
});

test('retrying one operation does not add an acknowledgement or move delivery time', () => {
  const client = base(); const op = command(client); const completed = apply(client, op);
  jest.setSystemTime(new Date(2026, 8, 8));
  expect(apply(completed, op)).toEqual(completed);
});

test('undo removes only its actor; the other confirmation keeps the delivery done', () => {
  const client = base(); const a = command(client); const b = command(client, 'B');
  const completed = apply(apply(client, a), b);
  const undone = applyVisitCommand(completed, createUndoCommand(a));
  expect(undone.outcome).toBe('kept');
  expect(next(undone.client!)).toBe('2026-09-19');
  expect(Object.values(undone.client!.visitReceipt!.confirmations)).toEqual(['B']);
  expect(visitStateKey(apply(undone.client!, createUndoCommand(b)))).toBe(visitStateKey(client));
});

test('a cancelled operation cannot resurrect a delivery on replay', () => {
  const client = base(); const a = command(client);
  const undone = apply(apply(client, a), createUndoCommand(a));
  expect(visitStateKey(apply(undone, a))).toBe(visitStateKey(client));
});

test('confirmation arriving after the first member undoes still counts for the second', () => {
  const client = base(); const a = command(client); const b = command(client, 'B');
  const final = apply(apply(apply(client, a), createUndoCommand(a)), b);
  expect(next(final)).toBe('2026-09-19');
  expect(Object.values(final.visitReceipt!.confirmations)).toEqual(['B']);
});

test('another member cannot undo an operation they did not create', () => {
  const client = base(); const a = command(client); const completed = apply(client, a);
  const forged = { ...createUndoCommand(a), actorId: 'B' };
  expect(applyVisitCommand(completed, forged).outcome).toBe('stale');
  expect(undoForCompletedClient(completed, 'B')).toBeNull();
});

test('offline older confirmation cannot overwrite a newer visit or delivery history', () => {
  const client = base(); const a = command(client); const offline = command(client, 'B');
  const first = apply(client, a);
  jest.setSystemTime(new Date(2026, 8, 19, 10));
  const latest = apply(first, command(first));
  const late = applyVisitCommand(latest, offline);
  expect(late.outcome).toBe('stale');
  expect(next(late.client!)).toBe('2026-10-03');
  expect(parseDate(late.client!.lastDeliveredAt)).toEqual(new Date(2026, 8, 19, 10));
  expect(applyVisitCommand(latest, createUndoCommand(a)).outcome).toBe('stale');
});

test.each([
  { specificDate: '2026-09-12', lastVisited: null, doneFor: '' },
  { scheduleRevision: 'new-generation' },
  { freq: 'weekly' as const },
  { visitDay: 'Lunes', visitDays: ['Lunes'] },
  { freq: 'on_demand' as const },
  { groupId: 'different-route' },
])('reagendamento/cambio de alcance invalida una confirmación antigua: %j', (changes) => {
  const client = base(); const a = command(client);
  const changed = { ...client, ...changes };
  expect(applyVisitCommand(changed, a).outcome).toBe('stale');
  expect(apply(changed, a)).toEqual(changed);
});

test('legacy app completion invalidates a delayed command even without a revision', () => {
  const client = base(); const a = command(client);
  const changed = { ...client, lastVisited: new Date(2026, 8, 7, 11) as any, doneFor: '2026-09-05' };
  expect(applyVisitCommand(changed, a).outcome).toBe('stale');
});

test('contact/product edits survive both completion and undo', () => {
  const client = base(); const a = command(client);
  const changed = { ...client, name: 'New name', products: { b20: 5 }, notes: 'Keep' };
  const restored = apply(apply(changed, a), createUndoCommand(a));
  expect(restored).toMatchObject({ name: 'New name', products: { b20: 5 }, notes: 'Keep' });
});

test('undo preserves alarms and stars added after the completion', () => {
  const client = base(); const a = command(client);
  const edited = { ...apply(client, a), alarm: '15:00', alarmDay: 'Sábado', isStarred: true };
  const undone = apply(edited, createUndoCommand(a));
  expect(undone.alarm).toBe('15:00'); expect(undone.isStarred).toBe(true);
});

test('one-time order confirmations preserve the previous delivery for undo', () => {
  const client = base({ freq: 'once', specificDate: '2026-09-05' });
  const a = command(client); const b = command(client, 'B');
  const completed = apply(apply(client, a), b);
  expect(completed.isCompleted).toBe(true);
  const aUndone = apply(completed, createUndoCommand(a));
  expect(aUndone.isCompleted).toBe(true);
  const bothUndone = apply(aUndone, createUndoCommand(b));
  expect(bothUndone.isCompleted).toBe(false);
  expect(bothUndone.lastDeliveredAt).toEqual(client.lastDeliveredAt);
});

test('old completed one-time orders can be undone only against the same state', () => {
  const client = base({ freq: 'once', isCompleted: true, completedAt: NOW as any });
  const undo = undoForCompletedClient(client, 'A')!;
  expect(apply(client, undo).isCompleted).toBe(false);
  expect(applyVisitCommand({ ...client, scheduleRevision: 'changed' }, undo).outcome).toBe('stale');
});

test('one-time notes are deleted, recurring notes advance as usual', () => {
  const once = base({ freq: 'once', isNote: true, specificDate: '2026-09-05' });
  expect(applyVisitCommand(once, command(once)).client).toBeNull();
  const periodic = base({ isNote: true });
  expect(next(apply(periodic, command(periodic)))).toBe('2026-09-19');
});

test('offline projection can complete and undo without changing the raw persisted snapshot', () => {
  const client = base(); const a = command(client);
  const queued = { ...client, visitCommands: [a, createUndoCommand(a)] };
  const projected = projectVisitCommands(queued)!;
  expect(visitStateKey(projected)).toBe(visitStateKey(client));
  expect(queued.visitReceipt).toBeUndefined();
  expect(queued.visitCommands).toHaveLength(2);
});

test('schedule change detection ignores unchanged frequency and unrelated edits', () => {
  const client = base();
  expect(scheduleChanged(client, { freq: client.freq, name: 'Other' })).toBe(false);
  expect(scheduleChanged(client, { specificDate: '2026-09-12' })).toBe(true);
});

test('explicitly completing a distant future visit advances from that exact date', () => {
  const client = base({ specificDate: '2026-10-03', lastVisited: null, doneFor: '' });
  const intent = command(client);
  expect(intent.occurrence).toBe('2026-10-03');
  expect(next(apply(client, intent))).toBe('2026-10-17');
});

test('malformed queued commands cannot crash the projection or alter the client', () => {
  const client = base();
  expect(projectVisitCommands({ ...client, visitCommands: [null as any, { id: '__proto__' } as any] })).toEqual({
    ...client, visitCommands: [null, { id: '__proto__' }],
  });
});

test('Undo arriving before Complete prevents that operation from ever applying', () => {
  const client = base(); const a = command(client);
  const undoneFirst = apply(client, createUndoCommand(a));
  expect(visitStateKey(apply(undoneFirst, a))).toBe(visitStateKey(client));
});

test('all delivery orders of A, B and undo-A preserve exactly B', () => {
  const client = base(); const a = command(client); const b = command(client, 'B'); const undoA = createUndoCommand(a);
  for (const ops of [[a,b,undoA], [a,undoA,b], [b,a,undoA], [b,undoA,a], [undoA,a,b], [undoA,b,a]]) {
    const final = ops.reduce(apply, client);
    expect(Object.values(final.visitReceipt!.confirmations)).toEqual(['B']);
    expect(next(final)).toBe('2026-09-19');
  }
});
