import { parseDate } from './helpers';

/**
 * Newest first by `createdAt`. Each date is parsed once instead of twice per
 * comparison (O(n log n) parses) on every Firestore snapshot. Items without a
 * valid date sort last, and ties keep their snapshot order.
 */
export const sortByCreatedAtDesc = <T extends { createdAt?: unknown }>(items: T[]): T[] => items
  .map((item) => ({ item, time: parseDate(item.createdAt)?.getTime() || 0 }))
  .sort((a, b) => b.time - a.time)
  .map(({ item }) => item);
