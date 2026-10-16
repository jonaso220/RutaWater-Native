export interface PositionedItem {
  id: string;
}

export interface MoveToPositionResult<T> {
  items: T[];
  currentIndex: number;
  newIndex: number;
  changed: boolean;
}

/**
 * Return a reordered copy without adding, removing, or mutating any item.
 * `requestedPosition` is one-based because it comes directly from the UI.
 */
export const moveItemToPosition = <T extends PositionedItem>(
  source: readonly T[],
  itemId: string,
  requestedPosition: number,
): MoveToPositionResult<T> => {
  const currentIndex = source.findIndex((item) => item.id === itemId);
  if (currentIndex === -1 || source.length === 0) {
    return { items: [...source], currentIndex, newIndex: currentIndex, changed: false };
  }

  const items = [...source];
  const [movedItem] = items.splice(currentIndex, 1);
  const safePosition = Number.isFinite(requestedPosition) ? Math.trunc(requestedPosition) : 1;
  const newIndex = Math.max(0, Math.min(safePosition - 1, items.length));
  items.splice(newIndex, 0, movedItem);

  return {
    items,
    currentIndex,
    newIndex,
    changed: newIndex !== currentIndex,
  };
};

export interface DayOrdered extends PositionedItem {
  listOrders?: Record<string, number>;
  listOrder?: number;
}

/**
 * Stored order of an item on a given day, falling back to the legacy single
 * `listOrder`. Infinity when it has none, so it never becomes a neighbor bound.
 */
export const readDayOrder = (item: DayOrdered, day: string): number => {
  const order = item.listOrders && typeof item.listOrders[day] === 'number'
    ? item.listOrders[day]
    : (typeof item.listOrder === 'number' ? item.listOrder : undefined);
  return typeof order === 'number' ? order : Infinity;
};

// Minimum gap between two adjacent fractional orders before the whole day is
// renumbered. With doubles this is reached after ~50 midpoint inserts in the
// same spot, so rebalances are rare.
export const FRACTIONAL_MIN_GAP = 1e-9;

export interface PositionChangePlan {
  currentIndex: number;
  newIndex: number;
  // `listOrders.<day>` values to write. One entry in the common case; the
  // whole day renumbered 1..n when the gap between neighbors is exhausted.
  updates: Array<{ id: string; position: number }>;
}

/**
 * «Cambiar posición»: moves `itemId` to the one-based `requestedPosition` of
 * the day list (already sorted as Home shows it) and returns the orders to
 * write. The moved item takes the midpoint between its new neighbors, so a
 * move is a single write.
 */
export const planPositionChange = <T extends DayOrdered>(
  dayItems: readonly T[],
  itemId: string,
  requestedPosition: number,
  day: string,
): PositionChangePlan => {
  const move = moveItemToPosition(dayItems, itemId, requestedPosition);
  const { currentIndex, newIndex } = move;
  if (currentIndex === -1 || !move.changed) return { currentIndex, newIndex, updates: [] };
  const items = move.items;

  const prevNeighbor = newIndex > 0 ? items[newIndex - 1] : null;
  const nextNeighbor = newIndex < items.length - 1 ? items[newIndex + 1] : null;
  // Non-finite stored orders (no order) count as missing neighbors so the
  // moved item never gets Infinity itself.
  const rawPrev = prevNeighbor ? readDayOrder(prevNeighbor, day) : null;
  const rawNext = nextNeighbor ? readDayOrder(nextNeighbor, day) : null;
  const prevOrder = rawPrev !== null && Number.isFinite(rawPrev) ? rawPrev : null;
  const nextOrder = rawNext !== null && Number.isFinite(rawNext) ? rawNext : null;

  let newOrder = 0;
  let needsRebalance = false;
  if (prevOrder === null && nextOrder === null) {
    newOrder = 1;
  } else if (prevOrder === null) {
    newOrder = (nextOrder as number) - 1;
  } else if (nextOrder === null) {
    newOrder = prevOrder + 1;
  } else if (nextOrder - prevOrder <= FRACTIONAL_MIN_GAP) {
    needsRebalance = true;
  } else {
    newOrder = (prevOrder + nextOrder) / 2;
  }

  if (!needsRebalance) return { currentIndex, newIndex, updates: [{ id: itemId, position: newOrder }] };
  const updates: Array<{ id: string; position: number }> = [];
  items.forEach((item, index) => {
    if (readDayOrder(item, day) !== index + 1) updates.push({ id: item.id, position: index + 1 });
  });
  return { currentIndex, newIndex, updates };
};
