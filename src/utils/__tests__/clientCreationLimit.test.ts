import { Client } from '../../types';
import { scheduleNeedsNewClientDocument } from '../clientCreationLimit';

const client = (overrides: Partial<Client> = {}): Client => ({
  id: 'active',
  name: 'Ana',
  phone: '099123456',
  address: '',
  notes: '',
  lat: '',
  lng: '',
  mapsLink: '',
  freq: 'weekly',
  visitDay: 'Lunes',
  visitDays: ['Lunes'],
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
  userId: 'owner',
  ...overrides,
});

describe('scheduleNeedsNewClientDocument', () => {
  test('identifies only a true extra one-time visit as quota-consuming', () => {
    const active = client();
    expect(scheduleNeedsNewClientDocument(active, [active], 'once', 'add')).toBe(true);
    expect(scheduleNeedsNewClientDocument(active, [active], 'once', 'replace')).toBe(false);
    expect(scheduleNeedsNewClientDocument(active, [active], 'weekly', 'add')).toBe(false);
  });

  test('does not consume quota when reactivating or reusing an on-demand document', () => {
    const active = client();
    const directory = client({ id: 'directory', freq: 'on_demand', visitDay: 'Sin Asignar', visitDays: [] });
    expect(scheduleNeedsNewClientDocument(directory, [directory], 'once', 'add')).toBe(false);
    expect(scheduleNeedsNewClientDocument(active, [active, directory], 'once', 'add')).toBe(false);
  });
});
