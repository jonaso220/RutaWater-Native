import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import type { Client } from '../types';
import { withDefaults } from '../utils/clientDefaults';
import {
  DELIVERIES_COLLECTION, DeliveryChange, deliveryChangeFor, deliveryDocument, mergeDeliveryChanges,
} from '../utils/deliveryRecords';
import { applyVisitCommand, VisitResult } from '../utils/visitCompletion';

// The adapter is shared by the native SDK and authenticated emulator tests.
export const commitVisitCommands = async (
  database: Pick<FirebaseFirestoreTypes.Module, 'runTransaction' | 'collection'>,
  clientId: string, scopeKey: string, isSessionCurrent: () => boolean, writerId: string,
): Promise<void> => {
  await database.runTransaction(async (transaction) => {
    const ref = database.collection('clients').doc(clientId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !isSessionCurrent()) return;
    let client: Client | null = withDefaults(clientId, snapshot.data());
    if ((client.groupId || client.userId) !== scopeKey) return;
    const original = client;
    const commands = Array.isArray(client.visitCommands) ? client.visitCommands : [];
    if (!commands.length) return;
    const updates: Partial<Client> = {};
    const results: VisitResult[] = [...(client.visitResults || [])];
    const changes: Array<DeliveryChange | null> = [];
    for (const command of commands) {
      const result = applyVisitCommand(client, command);
      changes.push(deliveryChangeFor(client, command, result));
      Object.assign(updates, result.updates);
      if (command?.id && command?.actorId) {
        results.push({ id: command.id, actorId: command.actorId, outcome: result.outcome });
      }
      client = result.client;
      if (!client) {
        transaction.delete(ref);
        return;
      }
    }
    // All reads before the first write, as transactions require.
    const deliveries = await Promise.all(mergeDeliveryChanges(changes).map(async (change) => {
      const deliveryRef = database.collection(DELIVERIES_COLLECTION).doc(change.id);
      const stored = await transaction.get(deliveryRef);
      return { change, deliveryRef, existing: stored.exists ? stored.data() : undefined };
    }));
    transaction.update(ref, {
      ...updates,
      visitCommands: [],
      // Bounded receipts acknowledge local actions without an unbounded log.
      visitResults: results.slice(-20),
      updatedAt: new Date(),
    });
    const now = new Date();
    deliveries.forEach(({ change, deliveryRef, existing }) => {
      const data = deliveryDocument(change, original, writerId, existing, 'app', now);
      if (data) transaction.set(deliveryRef, data, { merge: true });
    });
  });
};
