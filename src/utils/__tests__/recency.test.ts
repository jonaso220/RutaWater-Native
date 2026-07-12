import { Client } from '../../types';
import { getEffectiveLastActivityDate, getHouseholdMembers, sharesHouseholdWith } from '../recency';

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

  test('un vínculo asimétrico legado comparte la visita en ambos sentidos', () => {
    const visit = new Date('2026-07-09T12:00:00');
    const owner = client({ id: 'a' });
    const relative = client({
      id: 'b',
      relationships: { a: 'conyuge' },
      sameHousehold: { a: true },
      lastVisited: visit as any,
    });
    const clientsById = new Map([['a', owner], ['b', relative]]);

    expect(getEffectiveLastActivityDate(owner, clientsById)?.getTime()).toBe(visit.getTime());
  });

  test('todo el hogar encadenado comparte la visita más reciente', () => {
    const visit = new Date('2026-07-10T12:00:00');
    const a = client({ id: 'a', relationships: { b: 'conyuge' }, sameHousehold: { b: true } });
    const b = client({
      id: 'b',
      relationships: { a: 'conyuge', c: 'hijo_a' },
      sameHousehold: { a: true, c: true },
    });
    const c = client({
      id: 'c',
      relationships: { b: 'padre_madre' },
      sameHousehold: { b: true },
      completedAt: visit as any,
    });
    const clientsById = new Map([['a', a], ['b', b], ['c', c]]);

    expect(getHouseholdMembers(a, clientsById).map((member) => member.id).sort()).toEqual(['b', 'c']);
    expect(getEffectiveLastActivityDate(a, clientsById)?.getTime()).toBe(visit.getTime());
  });

  test('otro domicilio explícito corta el hogar aunque el vínculo inverso diga true', () => {
    const visit = new Date('2026-07-10T12:00:00');
    const a = client({
      id: 'a',
      relationships: { b: 'hermano_a' },
      sameHousehold: { b: false },
    });
    const b = client({
      id: 'b',
      relationships: { a: 'hermano_a' },
      sameHousehold: { a: true },
      lastVisited: visit as any,
    });
    const clientsById = new Map([['a', a], ['b', b]]);

    expect(getHouseholdMembers(a, clientsById)).toEqual([]);
    expect(getEffectiveLastActivityDate(a, clientsById)).toBeNull();
  });
});
