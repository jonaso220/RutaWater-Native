import { useRef } from 'react';

/**
 * Returns `value` while `visible` is true and the last visible value while it
 * is false. Always-mounted modals use it so their derived data (indexes,
 * groupings, fuzzy matches over every client) is not recomputed on every
 * Firestore snapshot while closed, and the content stays intact during the
 * close animation.
 */
export const useValueWhileVisible = <T>(value: T, visible: boolean): T => {
  const lastVisibleValue = useRef(value);
  if (visible) lastVisibleValue.current = value;
  return lastVisibleValue.current;
};
