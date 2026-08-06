import type { Client } from '../types';

export interface ClientIdentityIndex {
  clientByDocumentId: Map<string, Client>;
  stableIdByDocumentId: Map<string, string>;
  clientsByStableId: Map<string, Client[]>;
}

export interface RelatedClientReference {
  clientId: string;
  customerId?: string;
}

const cleanId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Canonical identity of one customer across route/order documents.
 *
 * `customerId` was added after the original client documents already existed,
 * so falling back to the Firestore document id preserves its exact historical
 * reference without rewriting or guessing the customer from contact data.
 */
export const getStableClientId = (
  client: Pick<Client, 'id' | 'customerId'>,
): string => cleanId(client.customerId) || cleanId(client.id);

/**
 * Fields persisted by new debt/transfer writes. Keeping the exact document id
 * preserves compatibility with already distributed app versions; customerId
 * adds the canonical identity understood by current versions.
 */
export const getRelatedClientReference = (
  client: Pick<Client, 'id' | 'customerId'>,
): Required<RelatedClientReference> => ({
  clientId: cleanId(client.id),
  customerId: getStableClientId(client),
});

/**
 * Builds the indexes needed to resolve both generations of related records:
 *
 * - current debts/transfers store exact `clientId` plus stable `customerId`;
 * - legacy records only store the exact client document id in `clientId`.
 *
 * No name/phone fallback is used. Two people with equal contact data therefore
 * remain separate unless their client documents explicitly share customerId.
 */
export const buildClientIdentityIndex = (clients: Client[]): ClientIdentityIndex => {
  const clientByDocumentId = new Map<string, Client>();
  const stableIdByDocumentId = new Map<string, string>();
  const clientsByStableId = new Map<string, Client[]>();

  clients.forEach((client) => {
    if (!client || client.isNote) return;
    const documentId = cleanId(client.id);
    if (!documentId) return;
    const stableId = getStableClientId(client) || documentId;
    clientByDocumentId.set(documentId, client);
    stableIdByDocumentId.set(documentId, stableId);
    const matches = clientsByStableId.get(stableId) || [];
    matches.push(client);
    clientsByStableId.set(stableId, matches);
  });

  return { clientByDocumentId, stableIdByDocumentId, clientsByStableId };
};

/** Resolve a related record's `clientId` without mutating or backfilling it. */
export const getRelatedRecordStableClientId = (
  reference: string | RelatedClientReference,
  index: ClientIdentityIndex,
): string => {
  const explicitStableId = typeof reference === 'string'
    ? ''
    : cleanId(reference.customerId);
  if (explicitStableId) return explicitStableId;
  const clientId = typeof reference === 'string' ? reference : reference.clientId;
  const cleanClientId = cleanId(clientId);
  return index.stableIdByDocumentId.get(cleanClientId) || cleanClientId;
};

export const relatedRecordBelongsToClient = (
  reference: string | RelatedClientReference,
  client: Pick<Client, 'id' | 'customerId'>,
  index: ClientIdentityIndex,
): boolean => getRelatedRecordStableClientId(reference, index) === getStableClientId(client);

/**
 * Finds live contact/location data for a debt or transfer. Exact legacy
 * document ids win; stable ids then prefer the canonical document, followed
 * by an on-demand directory card and finally any remaining route instance.
 */
export const resolveClientForRelatedRecord = (
  reference: string | RelatedClientReference,
  index: ClientIdentityIndex,
): Client | undefined => {
  const recordClientId = typeof reference === 'string' ? reference : reference.clientId;
  const exact = index.clientByDocumentId.get(cleanId(recordClientId));
  if (exact) return exact;

  const stableId = getRelatedRecordStableClientId(reference, index);
  const candidates = index.clientsByStableId.get(stableId) || [];
  return candidates.find((client) => client.id === stableId)
    || candidates.find((client) => client.freq === 'on_demand')
    || candidates[0];
};

/** Preferred active document for actions on an already resolved stable group. */
export const resolveClientForStableId = (
  stableId: string,
  index: ClientIdentityIndex,
): Client | undefined => {
  const candidates = index.clientsByStableId.get(cleanId(stableId)) || [];
  return candidates.find((client) => client.id === stableId)
    || candidates.find((client) => client.freq === 'on_demand')
    || candidates[0];
};
