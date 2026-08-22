import { Client } from '../../types';
import { findExactClientMatch, planDuplicateClientCleanup } from '../clientDuplicates';

const makeClient = (overrides: Partial<Client>): Client => ({
  id: 'client',
  name: 'Ana Pérez',
  phone: '098 123 456',
  address: '',
  notes: '',
  lat: '',
  lng: '',
  mapsLink: '',
  freq: 'on_demand',
  visitDay: 'Sin Asignar',
  visitDays: [],
  specificDate: '',
  products: {},
  listOrder: 0,
  listOrders: {},
  isCompleted: false,
  isStarred: false,
  isPinned: false,
  isNote: false,
  alarm: '',
  lastVisited: null,
  completedAt: null,
  updatedAt: null,
  userId: 'user',
  ...overrides,
});

describe('planDuplicateClientCleanup', () => {
  test('keeps a pending one-time order and removes only its directory copy', () => {
    const order = makeClient({
      id: 'order',
      freq: 'once',
      visitDay: 'Martes',
      visitDays: ['Martes'],
      specificDate: '2026-07-14',
      products: { bottle: 2 },
    });
    const directory = makeClient({ id: 'directory', address: 'Calle 1' });

    expect(planDuplicateClientCleanup([directory, order])).toEqual({
      staleIds: ['directory'],
      details: [{ name: 'Ana Pérez', activeId: 'order', staleId: 'directory' }],
    });
  });

  test('never removes any scheduled order when a person has several orders', () => {
    const weekly = makeClient({
      id: 'weekly',
      freq: 'weekly',
      visitDay: 'Lunes',
      visitDays: ['Lunes'],
    });
    const extra = makeClient({
      id: 'extra',
      freq: 'once',
      visitDay: 'Viernes',
      visitDays: ['Viernes'],
      specificDate: '2026-07-17',
    });
    const directory = makeClient({ id: 'directory' });

    const plan = planDuplicateClientCleanup([weekly, extra, directory]);
    expect(plan.staleIds).toEqual(['directory']);
    expect(plan.details[0].activeId).toBe('weekly');
    expect(plan.staleIds).not.toContain('weekly');
    expect(plan.staleIds).not.toContain('extra');
  });

  test('keeps the richest card when all duplicates are directory-only', () => {
    const sparse = makeClient({ id: 'sparse' });
    const rich = makeClient({ id: 'rich', address: 'Calle 1', notes: 'Portón azul' });

    expect(planDuplicateClientCleanup([sparse, rich])).toEqual({
      staleIds: ['sparse'],
      details: [{ name: 'Ana Pérez', activeId: 'rich', staleId: 'sparse' }],
    });
  });

  test('does not merge namesakes without a phone', () => {
    const first = makeClient({ id: 'first', phone: '' });
    const second = makeClient({ id: 'second', phone: '' });

    expect(planDuplicateClientCleanup([first, second])).toEqual({
      staleIds: [],
      details: [],
    });
  });
});

describe('findExactClientMatch', () => {
  test('matches normalized Uruguay phone formats', () => {
    const existing = makeClient({ id: 'existing', phone: '+598 98 123 456' });
    expect(findExactClientMatch([existing], '  ANA   PEREZ ', '098123456')?.id).toBe('existing');
  });

  test('requires a phone to avoid merging namesakes', () => {
    const existing = makeClient({ id: 'existing', phone: '' });
    expect(findExactClientMatch([existing], 'Ana Pérez', '')).toBeUndefined();
  });

  test('matches any saved phone, not only the primary one', () => {
    const existing = makeClient({
      id: 'existing',
      phone: '099111222',
      phones: [
        { id: 'primary', number: '099111222', isPrimary: true },
        { id: 'secondary', number: '098333444', isPrimary: false },
      ],
    });
    expect(findExactClientMatch([existing], 'Ana Pérez', '+598 98 333 444')?.id).toBe('existing');
  });
});
