import type { Client } from '../types';
import { dataScopeFields } from './dataScope';
import type { VisitCommand, VisitTransition } from './visitCompletion';

// One record per client visit in `deliveries`, written in the same transaction
// that applies Listo (app and MCP server). RutaWater never stored what was
// delivered; the history per client and the monthly summary come from here.
// Quantities only: amounts are computed later with the prices of each date.

export const DELIVERIES_COLLECTION = 'deliveries';

/** Natural key: a retry, a second member's tap or a redo after undo reuse it. */
export const deliveryDocId = (clientId: string, occurrence: string): string =>
  `${clientId}_${occurrence}`;

export type DeliveryChange =
  | {
    kind: 'record';
    id: string;
    occurrence: string;
    delivered: boolean;
    products: Record<string, string | number>;
    actorId: string;
    at: number;
  }
  | { kind: 'undo'; id: string };

const visitFieldsChanged = (updates: Partial<Client>): boolean =>
  Object.keys(updates).some((key) => key !== 'visitReceipt');

/**
 * What a command did to the visit history. Only the transition that actually
 * completes the visit records it, and only the one that restores the visit
 * marks it undone: confirmations by other members, tombstones and stale
 * commands leave the record as it is.
 */
export const deliveryChangeFor = (
  client: Client, command: VisitCommand, result: VisitTransition,
): DeliveryChange | null => {
  if (client.isNote || !command) return null;
  if (command.kind === 'complete') {
    if ((result.outcome !== 'applied' && result.outcome !== 'confirmed') || !visitFieldsChanged(result.updates)) {
      return null;
    }
    return {
      kind: 'record',
      id: deliveryDocId(client.id, command.occurrence),
      occurrence: command.occurrence,
      delivered: command.noDelivery !== true,
      products: { ...(client.products || {}) },
      actorId: command.actorId,
      at: command.at,
    };
  }
  if (result.outcome !== 'undone' || !visitFieldsChanged(result.updates)) return null;
  const occurrence = command.kind === 'undoLegacy' ? client.specificDate || '' : command.occurrence;
  return occurrence ? { kind: 'undo', id: deliveryDocId(client.id, occurrence) } : null;
};

/** The last change per record wins (complete → undo → complete in one flush). */
export const mergeDeliveryChanges = (changes: Array<DeliveryChange | null>): DeliveryChange[] => {
  const byId = new Map<string, DeliveryChange>();
  changes.forEach((change) => { if (change) byId.set(change.id, change); });
  return [...byId.values()];
};

/**
 * Document for a change. `existing` is the stored record (read in the same
 * transaction): its scope fields are kept, so a member who did not create it
 * can redo or undo it. `writerId` is who commits the transaction.
 */
export const deliveryDocument = (
  change: DeliveryChange,
  client: Client,
  writerId: string,
  existing: Record<string, unknown> | undefined,
  source: 'app' | 'assistant',
  now: Date,
): Record<string, unknown> | null => {
  if (change.kind === 'undo') {
    return existing ? { undone: true, undoneAt: now, updatedAt: now } : null;
  }
  return {
    ...(existing ? {} : { ...dataScopeFields(writerId, client.groupId), createdAt: now }),
    clientId: client.id,
    customerId: client.customerId || client.id,
    clientName: client.name || '',
    clientAddress: client.address || '',
    occurrence: change.occurrence,
    completedAt: new Date(change.at),
    delivered: change.delivered,
    products: change.products,
    actorId: change.actorId,
    source,
    undone: false,
    updatedAt: now,
  };
};
