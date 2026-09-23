import type { Client } from '../types';

export interface ClientIdentityIndex {
  clientByDocumentId: Map<string, Client>;
  stableIdByDocumentId: Map<string, string>;
  clientsByStableId: Map<string, Client[]>;
}

/**
 * The part of the identity index that resolves a related record to its stable
 * customer id. It holds no client objects, so it can be reused across client
 * snapshots that do not change any id (see buildClientStableIdIndex).
 */
export type ClientStableIdIndex = Pick<ClientIdentityIndex, 'stableIdByDocumentId'>;

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

const forEachIdentifiedClient = (
  clients: Client[],
  visit: (client: Client, documentId: string, stableId: string) => void,
): void => {
  clients.forEach((client) => {
    if (!client || client.isNote) return;
    const documentId = cleanId(client.id);
    if (!documentId) return;
    visit(client, documentId, getStableClientId(client) || documentId);
  });
};

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

  forEachIdentifiedClient(clients, (client, documentId, stableId) => {
    clientByDocumentId.set(documentId, client);
    stableIdByDocumentId.set(documentId, stableId);
    const matches = clientsByStableId.get(stableId) || [];
    matches.push(client);
    clientsByStableId.set(stableId, matches);
  });

  return { clientByDocumentId, stableIdByDocumentId, clientsByStableId };
};

/**
 * Same id resolution as buildClientIdentityIndex, but returns `previous` when
 * no document id or stable id changed. Most client snapshots (visits, stars,
 * notes, reorders) leave ids untouched, so debt/transfer lookups keyed by this
 * index keep their identity and memoized lists do not re-render every row.
 */
export const buildClientStableIdIndex = (
  clients: Client[],
  previous?: ClientStableIdIndex | null,
): ClientStableIdIndex => {
  const stableIdByDocumentId = new Map<string, string>();
  forEachIdentifiedClient(clients, (_client, documentId, stableId) => {
    stableIdByDocumentId.set(documentId, stableId);
  });
  if (previous && previous.stableIdByDocumentId.size === stableIdByDocumentId.size) {
    let unchanged = true;
    for (const [documentId, stableId] of stableIdByDocumentId) {
      if (previous.stableIdByDocumentId.get(documentId) !== stableId) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return previous;
  }
  return { stableIdByDocumentId };
};

/** Resolve a related record's `clientId` without mutating or backfilling it. */
export const getRelatedRecordStableClientId = (
  reference: string | RelatedClientReference,
  index: ClientStableIdIndex,
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
  index: ClientStableIdIndex,
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
