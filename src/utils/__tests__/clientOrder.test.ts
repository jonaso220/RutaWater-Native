import { moveItemToPosition, planPositionChange } from '../clientOrder';

describe('moveItemToPosition', () => {
  const source = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D' },
  ];

  test('moves the first item while preserving every item exactly once', () => {
    const result = moveItemToPosition(source, 'a', 4);

    expect(result.items.map((item) => item.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(source.length);
    expect(result.items).toHaveLength(source.length);
    expect(result.items[3]).toBe(source[0]);
    expect(result.changed).toBe(true);
  });

  test('moves an item upward without mutating the source array', () => {
    const result = moveItemToPosition(source, 'd', 2);

    expect(result.items.map((item) => item.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(source.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('clamps positions outside the list', () => {
    expect(moveItemToPosition(source, 'c', -20).items.map((item) => item.id))
      .toEqual(['c', 'a', 'b', 'd']);
    expect(moveItemToPosition(source, 'b', 999).items.map((item) => item.id))
      .toEqual(['a', 'c', 'd', 'b']);
  });

  test('leaves the order unchanged for the same position or a missing item', () => {
    expect(moveItemToPosition(source, 'b', 2).changed).toBe(false);
    expect(moveItemToPosition(source, 'missing', 2)).toEqual({
      items: source,
      currentIndex: -1,
      newIndex: -1,
      changed: false,
    });
  });
});

describe('planPositionChange (Cambiar posición)', () => {
  const day = 'Lunes';
  const list = [
    { id: 'a', listOrders: { Lunes: 1 } },
    { id: 'b', listOrders: { Lunes: 2 } },
    { id: 'c', listOrders: { Lunes: 3 } },
    { id: 'd', listOrders: { Lunes: 4 } },
  ];

  test('takes the midpoint between the new neighbors: one write', () => {
    expect(planPositionChange(list, 'd', 2, day)).toEqual({ currentIndex: 3, newIndex: 1, updates: [{ id: 'd', position: 1.5 }] });
  });

  test('top and bottom go one before the first / after the last', () => {
    expect(planPositionChange(list, 'c', 1, day).updates).toEqual([{ id: 'c', position: 0 }]);
    expect(planPositionChange(list, 'a', 9, day).updates).toEqual([{ id: 'a', position: 5 }]);
  });

  test('no change, unknown item: nothing to write', () => {
    expect(planPositionChange(list, 'b', 2, day).updates).toEqual([]);
    expect(planPositionChange(list, 'zz', 1, day).updates).toEqual([]);
  });

  test('falls back to the legacy listOrder and renumbers when the gap is exhausted', () => {
    const tight = [
      { id: 'a', listOrder: 1 },
      { id: 'b', listOrders: { Lunes: 1 + 1e-10 } },
      { id: 'c', listOrders: { Lunes: 3 } },
    ];
    expect(planPositionChange(tight, 'c', 2, day).updates).toEqual([
      { id: 'c', position: 2 },
      { id: 'b', position: 3 },
    ]);
  });
});
