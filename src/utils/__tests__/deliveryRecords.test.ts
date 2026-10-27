import { withDefaults } from '../clientDefaults';
import { deliveryChangeFor, deliveryDocument, mergeDeliveryChanges } from '../deliveryRecords';
import { applyVisitCommand, createUndoCommand, createVisitCommand } from '../visitCompletion';

const client = () => withDefaults('c1', {
  userId: 'owner', groupId: 'family', name: 'Ana', address: 'Calle 1',
  freq: 'weekly', visitDay: 'Miércoles', visitDays: ['Miércoles'],
  specificDate: '2026-10-28', products: { b20: 2, soda: 6 },
});

describe('delivery records', () => {
  test('Listo records the products of the card; «not needed» records no delivery', () => {
    const base = client();
    const done = createVisitCommand(base, 'owner', 'Miércoles', 1000)!;
    const change = deliveryChangeFor(base, done, applyVisitCommand(base, done));
    expect(change).toEqual({
      kind: 'record', id: `c1_${done.occurrence}`, occurrence: done.occurrence,
      delivered: true, products: { b20: 2, soda: 6 }, actorId: 'owner', at: 1000,
    });
    const skipped = createVisitCommand(base, 'owner', 'Miércoles', 1000, true)!;
    expect(deliveryChangeFor(base, skipped, applyVisitCommand(base, skipped))).toMatchObject({ delivered: false });
  });

  test('a second member confirming and a stale command leave the record alone', () => {
    const base = client();
    const a = createVisitCommand(base, 'owner', 'Miércoles')!;
    const first = applyVisitCommand(base, a);
    const b = createVisitCommand(base, 'member', 'Miércoles')!;
    expect(deliveryChangeFor(first.client!, b, applyVisitCommand(first.client!, b))).toBeNull();
    const stale = { ...createVisitCommand(base, 'owner', 'Miércoles')!, expected: 'old' };
    expect(deliveryChangeFor(base, stale, applyVisitCommand(base, stale))).toBeNull();
  });

  test('undo marks the record; complete and undo in one flush leave only the undo', () => {
    const base = client();
    const a = createVisitCommand(base, 'owner', 'Miércoles')!;
    const done = applyVisitCommand(base, a);
    const undo = createUndoCommand(a);
    const undone = deliveryChangeFor(done.client!, undo, applyVisitCommand(done.client!, undo));
    expect(undone).toEqual({ kind: 'undo', id: `c1_${a.occurrence}` });
    const merged = mergeDeliveryChanges([deliveryChangeFor(base, a, done), undone]);
    expect(merged).toEqual([undone]);
    expect(deliveryDocument(undone!, base, 'owner', undefined, 'app', new Date(0))).toBeNull();
  });

  test('notes never create records', () => {
    const note = { ...client(), isNote: true };
    const a = createVisitCommand(note, 'owner', 'Miércoles')!;
    expect(deliveryChangeFor(note, a, applyVisitCommand(note, a))).toBeNull();
  });

  test('a new record carries the writer scope; an existing one keeps its own', () => {
    const base = client();
    const change = deliveryChangeFor(base, createVisitCommand(base, 'member', 'Miércoles', 5)!,
      applyVisitCommand(base, createVisitCommand(base, 'member', 'Miércoles', 5)!))!;
    const now = new Date(10);
    expect(deliveryDocument(change, base, 'member', undefined, 'app', now)).toMatchObject({
      userId: 'member', groupId: 'family', scopeKey: 'scope:family', clientId: 'c1', customerId: 'c1',
      clientName: 'Ana', delivered: true, source: 'app', undone: false, createdAt: now,
    });
    const update = deliveryDocument(change, base, 'member', { userId: 'owner' }, 'app', now)!;
    expect(update).not.toHaveProperty('userId');
    expect(update).not.toHaveProperty('createdAt');
  });
});
