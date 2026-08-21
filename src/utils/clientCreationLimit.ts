import { Frequency } from '../constants/products';
import { Client } from '../types';
import { findExactClientMatch } from './clientDuplicates';

/** Mirrors the only branch in scheduleFromDirectory that creates a new doc. */
export const scheduleNeedsNewClientDocument = (
  client: Client,
  allClients: Client[],
  frequency: Frequency,
  mode: 'add' | 'replace' = 'add',
): boolean => {
  const wasInDirectory = client.freq === 'on_demand' || client.visitDay === 'Sin Asignar';
  if (wasInDirectory || mode === 'replace') return false;
  if (frequency !== 'once' && frequency !== 'on_demand') return false;

  const reusableOnDemand = findExactClientMatch(
    allClients.filter((candidate) => candidate.id !== client.id && candidate.freq === 'on_demand'),
    client.name,
    client.phone,
  );
  return !reusableOnDemand;
};
