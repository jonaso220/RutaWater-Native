import { Client } from '../../types';
import { withDefaults } from '../clientDefaults';
import {
  clientVisitDays, dayFieldsAfterDaysChange, getClientProductsForDay, isClientStarredOnDay,
  productsUpdateForDay, sanitizeProductsByDay, sanitizeStarredByDay, starUpdateForDay,
} from '../clientDays';
import { deliveryChangeFor } from '../deliveryRecords';
import { calculateProductTotals } from '../productCounter';
import { applyVisitCommand, createUndoCommand, createVisitCommand } from '../visitCompletion';

// Martes 8 y jueves 10 de septiembre de 2026.
const NOW = new Date(2026, 8, 7, 10);
const twoDays = (fields: Partial<Client> = {}): Client => withDefaults('c1', {
  userId: 'owner', groupId: 'family', name: 'Rodrigo', freq: 'weekly',
  visitDay: 'Martes', visitDays: ['Martes', 'Jueves'], products: { b20: 2 },
  ...fields,
});

// Como Firestore: `productsByDay.Martes` cambia solo esa entrada del mapa.
const applyUpdate = (client: Client, update: Record<string, unknown>): Client => {
  const next: any = { ...client };
  Object.entries(update).forEach(([key, value]) => {
    const [field, day] = key.split('.');
    next[field] = day ? { ...(next[field] || {}), [day]: value } : value;
  });
  return next;
};

beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
afterEach(() => { jest.useRealTimers(); });

describe('products of each visit day', () => {
  test('a day without its own products uses the client products', () => {
    const client = twoDays();
    expect(getClientProductsForDay(client, 'Martes')).toEqual({ b20: 2 });
    expect(getClientProductsForDay(client, 'Jueves')).toEqual({ b20: 2 });
  });

  test('changing the products of one day leaves the other day alone', () => {
    const client = twoDays();
    const update = productsUpdateForDay(client, 'Martes', { soda: 1 });
    expect(update).toEqual({ 'productsByDay.Martes': { soda: 1 } });
    const after = applyUpdate(client, update);
    expect(getClientProductsForDay(after, 'Martes')).toEqual({ soda: 1 });
    expect(getClientProductsForDay(after, 'Jueves')).toEqual({ b20: 2 });
  });

  test('an empty day stays empty instead of falling back to the client products', () => {
    const after = applyUpdate(twoDays(), productsUpdateForDay(twoDays(), 'Martes', {}));
    expect(getClientProductsForDay(after, 'Martes')).toEqual({});
  });

  test('a single-day client keeps writing the client products', () => {
    const single = twoDays({ visitDays: ['Martes'] });
    expect(productsUpdateForDay(single, 'Martes', { soda: 1 })).toEqual({ products: { soda: 1 } });
    // A leftover value of that day must not shadow the new products.
    const leftover = twoDays({ visitDays: ['Martes'], productsByDay: { Martes: { b6: 4 }, Jueves: { b20: 1 } } });
    expect(productsUpdateForDay(leftover, 'Martes', { soda: 1 }))
      .toEqual({ products: { soda: 1 }, productsByDay: { Jueves: { b20: 1 } } });
  });

  test('the load of a day adds what each card takes that day', () => {
    const client = twoDays({ productsByDay: { Martes: { soda: 3 } } });
    expect(calculateProductTotals([client], [{ id: 'b20' }, { id: 'soda' }], 'Martes')).toEqual({ b20: 0, soda: 3 });
    expect(calculateProductTotals([client], [{ id: 'b20' }, { id: 'soda' }], 'Jueves')).toEqual({ b20: 2, soda: 0 });
  });

  test('Listo records the products of the card of that day', () => {
    const client = twoDays({ productsByDay: { Martes: { soda: 3 } } });
    const tuesday = createVisitCommand(client, 'A', 'Martes')!;
    expect(deliveryChangeFor(client, tuesday, applyVisitCommand(client, tuesday)))
      .toMatchObject({ occurrence: '2026-09-08', products: { soda: 3 } });
    const thursday = createVisitCommand(client, 'A', 'Jueves')!;
    expect(deliveryChangeFor(client, thursday, applyVisitCommand(client, thursday)))
      .toMatchObject({ occurrence: '2026-09-10', products: { b20: 2 } });
  });
});

describe('star of each visit day', () => {
  test('starring one day does not star the other', () => {
    const client = twoDays();
    const after = applyUpdate(client, starUpdateForDay(client, 'Martes', true));
    expect(isClientStarredOnDay(after, 'Martes')).toBe(true);
    expect(isClientStarredOnDay(after, 'Jueves')).toBe(false);
    expect(after.isStarred).toBe(false);
  });

  test('a single-day client keeps using the client star', () => {
    const single = twoDays({ visitDays: ['Martes'] });
    expect(starUpdateForDay(single, 'Martes', true)).toEqual({ isStarred: true });
  });

  test('Listo clears the star of that day and keeps the star of the other day', () => {
    const client = twoDays({ starredByDay: { Martes: true, Jueves: true } });
    const done = applyVisitCommand(client, createVisitCommand(client, 'A', 'Martes')!).client!;
    expect(isClientStarredOnDay(done, 'Martes')).toBe(false);
    expect(isClientStarredOnDay(done, 'Jueves')).toBe(true);
  });

  test('a star shared by both days survives on the day that is still pending', () => {
    const client = twoDays({ isStarred: true });
    const done = applyVisitCommand(client, createVisitCommand(client, 'A', 'Martes')!).client!;
    expect(isClientStarredOnDay(done, 'Martes')).toBe(false);
    expect(isClientStarredOnDay(done, 'Jueves')).toBe(true);
  });

  test('undoing Listo gives the star back to that day only', () => {
    const client = twoDays({ starredByDay: { Martes: true } });
    const complete = createVisitCommand(client, 'A', 'Martes')!;
    const done = applyVisitCommand(client, complete).client!;
    const undone = applyVisitCommand(done, createUndoCommand(complete)).client!;
    expect(isClientStarredOnDay(undone, 'Martes')).toBe(true);
    expect(isClientStarredOnDay(undone, 'Jueves')).toBe(false);
    expect((undone as any).dayStarred).toBeUndefined();
  });

  test('a single-day client is completed and undone exactly as before', () => {
    const single = twoDays({ visitDays: ['Martes'], isStarred: true });
    const complete = createVisitCommand(single, 'A', 'Martes')!;
    const result = applyVisitCommand(single, complete);
    expect(result.updates.isStarred).toBe(false);
    expect('starredByDay' in result.updates).toBe(false);
    expect('dayStarred' in result.client!.visitReceipt!.before).toBe(false);
    expect(applyVisitCommand(result.client!, createUndoCommand(complete)).client!.isStarred).toBe(true);
  });
});

describe('per-day values when the visit days change', () => {
  const client = twoDays({
    addressByDay: { Martes: 'taller' },
    productsByDay: { Martes: { soda: 1 }, Jueves: { b20: 3 } },
    starredByDay: { Martes: true, Jueves: false },
  });

  test('removing a day folds the remaining day into the client', () => {
    expect(dayFieldsAfterDaysChange(client, ['Martes', 'Jueves'], ['Martes'])).toEqual({
      products: { soda: 1 }, isStarred: true, productsByDay: {}, starredByDay: {},
    });
  });

  test('a single day that moves takes its values along', () => {
    const single = { ...client, visitDays: ['Martes'], visitDay: 'Martes' } as Client;
    expect(dayFieldsAfterDaysChange(single, ['Martes'], ['Miércoles'])).toEqual({
      addressByDay: { 'Miércoles': 'taller' },
      products: { soda: 1 }, isStarred: true, productsByDay: {}, starredByDay: {},
    });
  });

  test('a write to one day does not carry the other day along', () => {
    const stale = twoDays({ productsByDay: { Jueves: { b20: 1 } }, starredByDay: { Jueves: true } });
    expect(Object.keys(productsUpdateForDay(stale, 'Martes', { soda: 1 }))).toEqual(['productsByDay.Martes']);
    expect(Object.keys(starUpdateForDay(stale, 'Martes', true))).toEqual(['starredByDay.Martes']);
  });

  test('a client that leaves the route, or comes back to it, starts clean', () => {
    const single = { ...client, visitDays: ['Martes'], visitDay: 'Martes' } as Client;
    expect(dayFieldsAfterDaysChange(single, ['Martes'], [])).toEqual({
      products: { soda: 1 }, addressByDay: {}, productsByDay: {}, starredByDay: {},
    });
    expect(dayFieldsAfterDaysChange(client, [], ['Lunes', 'Martes'])).toEqual({
      addressByDay: {}, productsByDay: {}, starredByDay: {},
    });
    expect(dayFieldsAfterDaysChange(twoDays(), [], ['Lunes'])).toEqual({});
  });

  test('adding a day changes nothing: the new day starts from the client values', () => {
    expect(dayFieldsAfterDaysChange(client, ['Martes', 'Jueves'], ['Martes', 'Jueves', 'Sábado'])).toEqual({});
  });

  test('replacing one of several days drops only what belonged to it', () => {
    expect(dayFieldsAfterDaysChange(client, ['Martes', 'Jueves'], ['Jueves', 'Sábado'])).toEqual({
      addressByDay: {}, productsByDay: { Jueves: { b20: 3 } }, starredByDay: { Jueves: false },
    });
  });
});

test('ignores malformed per-day data', () => {
  expect(sanitizeProductsByDay({ Martes: { soda: '2', b20: 0, x: 'no' }, Funday: { soda: 1 }, Jueves: 'soda' }))
    .toEqual({ Martes: { soda: 2 } });
  expect(sanitizeStarredByDay({ Martes: true, Jueves: 'yes', Funday: true })).toEqual({ Martes: true });
  expect(clientVisitDays({ visitDay: 'Jueves', visitDays: [] })).toEqual(['Jueves']);
  expect(clientVisitDays({ visitDay: 'Sin Asignar' })).toEqual([]);
});
