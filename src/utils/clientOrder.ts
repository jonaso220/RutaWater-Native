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
