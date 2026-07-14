import { Client } from '../types';
import { getClientMatchKey, parseDate } from './helpers';

export interface DuplicateClientDetail {
  name: string;
  activeId: string;
  staleId: string;
}

export interface DuplicateClientPlan {
  staleIds: string[];
  details: DuplicateClientDetail[];
}

export const findExactClientMatch = (
  clients: Client[],
  name: string,
  phone: string,
): Client | undefined => {
  const candidateKey = getClientMatchKey(name, phone, '__candidate__');
  if (candidateKey.startsWith('__id_')) return undefined;
  return clients.find(
    (client) =>
      !client.isNote &&
      getClientMatchKey(client.name || '', client.phone || '', client.id) === candidateKey,
  );
};

const dataScore = (client: Client): number => {
  let score = 0;
  const productCount = Object.values(client.products || {}).filter(
    (value) => Number(value) > 0,
  ).length;
  score += productCount * 10;
  if (client.notes?.trim()) score += 5;
  if ((client.lat && client.lng) || client.mapsLink) score += 5;
  if (client.address?.trim()) score += 3;
  score += Object.keys(client.relationships || {}).length * 15;
  if (client.lastVisited || client.completedAt) score += 10;
  if (client.alarm) score += 2;
  if (client.updatedAt) {
    const timestamp = (parseDate(client.updatedAt)?.getTime() || 0) / 1000;
    score += Math.min(timestamp / 1e10, 1);
  }
  return score;
};

const keeperScore = (client: Client): number => {
  // Cleaning duplicates is directory maintenance, not order maintenance.
  // Every scheduled document is protected and outranks an on-demand card.
  if (client.freq !== 'on_demand') {
    const pendingBonus = client.isCompleted ? 0 : 100_000;
    const recurringBonus = ['weekly', 'biweekly', 'triweekly', 'monthly'].includes(client.freq)
      ? 10_000
      : 0;
    return 1_000_000 + pendingBonus + recurringBonus + dataScore(client);
  }
  return dataScore(client);
};

/**
 * Builds a safe cleanup plan for duplicate client documents.
 *
 * Only `on_demand` documents can ever become stale. Scheduled documents are
 * included in grouping so they can receive contact/debt/relationship data,
 * but they are never returned in `staleIds` — even when several legitimate
 * pending orders exist for the same person.
 */
export const planDuplicateClientCleanup = (clients: Client[]): DuplicateClientPlan => {
  const groups = new Map<string, Client[]>();

  clients.forEach((client) => {
    if (client.isNote) return;
    const key = getClientMatchKey(client.name || '', client.phone || '', client.id);
    // getClientMatchKey intentionally falls back to the document id when the
    // phone is empty, avoiding accidental merges between namesakes.
    if (key.startsWith('__id_')) return;
    const group = groups.get(key) || [];
    group.push(client);
    groups.set(key, group);
  });

  const staleIds: string[] = [];
  const details: DuplicateClientDetail[] = [];

  groups.forEach((group) => {
    if (group.length < 2) return;
    const sorted = [...group].sort((a, b) => {
      const difference = keeperScore(b) - keeperScore(a);
      return difference || a.id.localeCompare(b.id);
    });
    const keeper = sorted[0];

    sorted.forEach((candidate) => {
      if (candidate.id === keeper.id || candidate.freq !== 'on_demand') return;
      staleIds.push(candidate.id);
      details.push({
        name: candidate.name,
        activeId: keeper.id,
        staleId: candidate.id,
      });
    });
  });

  return { staleIds, details };
};
