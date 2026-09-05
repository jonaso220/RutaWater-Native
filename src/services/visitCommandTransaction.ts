import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import type { Client } from '../types';
import { withDefaults } from '../utils/clientDefaults';
import { applyVisitCommand, VisitResult } from '../utils/visitCompletion';

// The adapter is shared by the native SDK and authenticated emulator tests.
export const commitVisitCommands = async (
  database: Pick<FirebaseFirestoreTypes.Module, 'runTransaction' | 'collection'>,
  clientId: string, scopeKey: string, isSessionCurrent: () => boolean,
): Promise<void> => {
  await database.runTransaction(async (transaction) => {
    const ref = database.collection('clients').doc(clientId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !isSessionCurrent()) return;
    let client: Client | null = withDefaults(clientId, snapshot.data());
    if ((client.groupId || client.userId) !== scopeKey) return;
    const commands = Array.isArray(client.visitCommands) ? client.visitCommands : [];
    if (!commands.length) return;
    const updates: Partial<Client> = {};
    const results: VisitResult[] = [...(client.visitResults || [])];
    for (const command of commands) {
      const result = applyVisitCommand(client, command);
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
    transaction.update(ref, {
      ...updates,
      visitCommands: [],
      // Bounded receipts acknowledge local actions without an unbounded log.
      visitResults: results.slice(-20),
      updatedAt: new Date(),
    });
  });
};
