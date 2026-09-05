import { toExistingClientUpdate } from '../clientWriteData';

describe('toExistingClientUpdate', () => {
  test('preserves a shared record identity when another member schedules it', () => {
    const update = toExistingClientUpdate({
      userId: 'current-member',
      groupId: 'shared-route',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      isNote: false,
      freq: 'weekly',
      visitDay: 'Lunes',
      products: { water: 2 },
    });

    expect(update).toEqual({
      scheduleRevision: expect.any(String),
      freq: 'weekly',
      visitDay: 'Lunes',
      products: { water: 2 },
    });
    expect(update).not.toHaveProperty('userId');
    expect(update).not.toHaveProperty('groupId');
    expect(update).not.toHaveProperty('isNote');
  });

  test('does not let an AI reuse path turn a client into a deletable note', () => {
    expect(toExistingClientUpdate({
      userId: 'ai-caller',
      groupId: null,
      isNote: true,
      name: 'Existing customer',
    })).toEqual({ name: 'Existing customer' });
  });
});
