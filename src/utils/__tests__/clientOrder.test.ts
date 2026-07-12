import { moveItemToPosition } from '../clientOrder';

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
