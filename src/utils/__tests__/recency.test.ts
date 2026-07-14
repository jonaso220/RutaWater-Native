import { Client } from '../../types';
import {
  buildEffectiveLastActivityDates,
  getDirectoryDeliveryHistoryUpdate,
  getEffectiveLastActivityDate,
  getHouseholdMembers,
  getLastActivityDate,
  getLastVisitDate,
  sharesHouseholdWith,
} from '../recency';

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
  test('una ficha legacy usa su edición como referencia sin inventar una entrega', () => {
    const legacyDate = new Date('2026-07-09T12:00:00');
    const edited = client({ id: 'a', updatedAt: new Date('2026-07-09T12:00:00') as any });
    expect(getLastVisitDate(edited)).toBeNull();
    expect(getLastActivityDate(edited)?.getTime()).toBe(legacyDate.getTime());
  });

  test('la fecha aproximada legacy no se comparte con familiares', () => {
    const owner = client({
      id: 'a',
      relationships: { b: 'conyuge' },
      sameHousehold: { b: true },
    });
    const editedRelative = client({
      id: 'b',
      updatedAt: new Date('2026-07-09T12:00:00') as any,
    });
    const clientsById = new Map([['a', owner], ['b', editedRelative]]);

    expect(getEffectiveLastActivityDate(owner, clientsById)).toBeNull();
  });

  test('lastDeliveredAt sobrevive aunque la agenda haya limpiado lastVisited', () => {
    const delivery = new Date('2026-06-01T12:00:00');
    const scheduled = client({
      id: 'a',
      freq: 'monthly',
      lastDeliveredAt: delivery as any,
      lastVisited: null,
      updatedAt: new Date('2026-07-13T12:00:00') as any,
    });
    expect(getLastActivityDate(scheduled)?.getTime()).toBe(delivery.getTime());
  });

  test('archivar un pedido único conserva completedAt como entrega real', () => {
    const delivery = new Date('2026-07-09T12:00:00');
    const completedOnce = client({
      id: 'a',
      freq: 'once',
      isCompleted: true,
      completedAt: delivery as any,
      lastVisited: new Date('2026-05-01T12:00:00') as any,
    });
    expect(getDirectoryDeliveryHistoryUpdate(completedOnce)).toEqual({
      lastDeliveredAt: delivery,
      lastVisited: null,
    });
  });

  test('un campo canónico antiguo no oculta una entrega legacy más nueva', () => {
    const oldCanonical = new Date('2026-04-01T12:00:00');
    const recentCompletion = new Date('2026-07-10T12:00:00');
    const completed = client({
      id: 'a',
      lastDeliveredAt: oldCanonical as any,
      completedAt: recentCompletion as any,
    });
    expect(getLastActivityDate(completed)?.getTime()).toBe(recentCompletion.getTime());
  });

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

  test('un familiar comparte la fecha canónica aunque su agenda se haya reiniciado', () => {
    const visit = new Date('2026-05-29T12:00:00');
    const owner = client({
      id: 'a',
      relationships: { b: 'conyuge' },
      sameHousehold: { b: true },
      lastDeliveredAt: new Date('2026-03-01T12:00:00') as any,
    });
    const relative = client({
      id: 'b',
      freq: 'monthly',
      lastDeliveredAt: visit as any,
      lastVisited: null,
      updatedAt: new Date('2026-07-13T12:00:00') as any,
    });
    expect(getEffectiveLastActivityDate(owner, new Map([['a', owner], ['b', relative]]))?.getTime())
      .toBe(visit.getTime());
  });

  test('una entrega en otro documento del mismo cliente actualiza a su hogar', () => {
    const visit = new Date('2026-07-11T12:00:00');
    const wife = client({
      id: 'wife',
      name: 'Laura',
      phone: '099111222',
      relationships: { husband: 'conyuge' },
      sameHousehold: { husband: true },
    });
    const husband = client({
      id: 'husband',
      name: 'Carlos',
      phone: '098123456',
      relationships: { wife: 'conyuge' },
      sameHousehold: { wife: true },
    });
    const husbandExtraOrder = client({
      id: 'husband-extra',
      name: 'Carlos',
      phone: '+598 98 123 456',
      freq: 'once',
      lastDeliveredAt: visit as any,
    });
    const clientsById = new Map([
      [wife.id, wife],
      [husband.id, husband],
      [husbandExtraOrder.id, husbandExtraOrder],
    ]);

    expect(getEffectiveLastActivityDate(wife, clientsById)?.getTime()).toBe(visit.getTime());
  });

  test('customerId conecta un pedido extra sin teléfono con el hogar', () => {
    const visit = new Date('2026-07-12T12:00:00');
    const wife = client({
      id: 'wife',
      customerId: 'wife',
      name: 'Laura',
      relationships: { husband: 'conyuge' },
      sameHousehold: { husband: true },
    });
    const husband = client({
      id: 'husband',
      customerId: 'husband',
      name: 'Carlos',
      phone: '',
      relationships: { wife: 'conyuge' },
      sameHousehold: { wife: true },
    });
    const husbandExtraOrder = client({
      id: 'husband-extra',
      customerId: 'husband',
      name: 'Carlos',
      phone: '',
      freq: 'once',
      lastDeliveredAt: visit as any,
    });
    const clientsById = new Map([
      [wife.id, wife],
      [husband.id, husband],
      [husbandExtraOrder.id, husbandExtraOrder],
    ]);

    expect(getEffectiveLastActivityDate(wife, clientsById)?.getTime()).toBe(visit.getTime());
    expect(getHouseholdMembers(wife, clientsById).map((member) => member.id)).toEqual(['husband']);
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

  test('el índice precalculado reúne hogar, identidad y fallback legacy', () => {
    const householdVisit = new Date('2026-07-12T12:00:00');
    const legacyDate = new Date('2026-06-01T12:00:00');
    const wife = client({
      id: 'wife',
      customerId: 'wife',
      relationships: { husband: 'conyuge' },
      sameHousehold: { husband: true },
    });
    const husband = client({
      id: 'husband',
      customerId: 'husband',
      relationships: { wife: 'conyuge' },
      sameHousehold: { wife: true },
    });
    const extra = client({
      id: 'extra',
      customerId: 'husband',
      lastDeliveredAt: householdVisit as any,
    });
    const legacy = client({ id: 'legacy', updatedAt: legacyDate as any });

    const index = buildEffectiveLastActivityDates([wife, husband, extra, legacy]);

    expect(index.get(wife.id)?.getTime()).toBe(householdVisit.getTime());
    expect(index.get(husband.id)?.getTime()).toBe(householdVisit.getTime());
    expect(index.get(extra.id)?.getTime()).toBe(householdVisit.getTime());
    expect(index.get(legacy.id)?.getTime()).toBe(legacyDate.getTime());
  });

  test('indexa un hogar grande encadenado sin recursión ni recorridos cruzados', () => {
    const visit = new Date('2026-07-13T12:00:00');
    const total = 2000;
    const household = Array.from({ length: total }, (_, position) => {
      const id = `client-${position}`;
      const nextId = `client-${position + 1}`;
      return client({
        id,
        customerId: id,
        relationships: position < total - 1 ? { [nextId]: 'otro' } : {},
        sameHousehold: position < total - 1 ? { [nextId]: true } : {},
        lastDeliveredAt: position === total - 1 ? visit as any : null,
      });
    });

    const index = buildEffectiveLastActivityDates(household);

    expect(index.size).toBe(total);
    expect(index.get('client-0')?.getTime()).toBe(visit.getTime());
  });
});
