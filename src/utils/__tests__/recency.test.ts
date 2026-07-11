import { Client } from '../../types';
import { getEffectiveLastActivityDate, sharesHouseholdWith } from '../recency';

const client = (over: Partial<Client>): Client => ({
  id: 'a',
  name: 'A',
  phone: '',
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
  userId: 'u',
  ...over,
} as Client);

describe('recencia del hogar', () => {
  test('un vínculo legado sin indicador conserva el comportamiento anterior', () => {
    const owner = client({ id: 'a', relationships: { b: 'hermano_a' } });
    expect(sharesHouseholdWith(owner, 'b')).toBe(true);
  });

  test('un familiar de otro domicilio no actualiza la visita del hogar', () => {
    const owner = client({
      id: 'a',
      relationships: { b: 'hermano_a' },
      sameHousehold: { b: false },
    });
    const relative = client({ id: 'b', lastVisited: new Date('2026-07-09T12:00:00') as any });
    expect(getEffectiveLastActivityDate(owner, new Map([['b', relative]]))).toBeNull();
  });

  test('un familiar del mismo domicilio comparte su última visita', () => {
    const visit = new Date('2026-07-09T12:00:00');
    const owner = client({
      id: 'a',
      relationships: { b: 'conyuge' },
      sameHousehold: { b: true },
    });
    const relative = client({ id: 'b', lastVisited: visit as any });
    expect(getEffectiveLastActivityDate(owner, new Map([['b', relative]]))?.getTime()).toBe(visit.getTime());
  });
});
