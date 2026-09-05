import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { db } from '../config/firebase';
import { VisitCommand, VisitResult } from '../utils/visitCompletion';
import { commitVisitCommands } from './visitCommandTransaction';
import { reportError } from '../lib/crashReporting';

const running = new Map<string, Promise<void>>();
const submitted = new Set<string>();

/** Uses the native Firestore persistent write queue, including across restarts.
 * Only an intent is queued. Derived delivery dates are written in a transaction
 * when connectivity returns, never by a delayed blind offline update.
 */
export const enqueueVisitCommand = async (clientId: string, command: VisitCommand): Promise<boolean> => {
  if (auth().currentUser?.uid !== command.actorId) return false;
  submitted.add(command.id);
  try {
    await db.collection('clients').doc(clientId).update({
      visitCommands: firestore.FieldValue.arrayUnion(command),
    });
    return true;
  } catch (error: any) {
    submitted.delete(command.id);
    // Another member may already have completed/deleted a one-time note.
    if (String(error?.code).includes('not-found') && command.deleteNote) return true;
    reportError(error, 'enqueueVisitCommand');
    return false;
  }
};

export const consumeVisitResults = (results: VisitResult[], userId: string): VisitResult[] => {
  const own = results.filter((result) => result.actorId === userId && submitted.has(result.id));
  own.forEach((result) => submitted.delete(result.id));
  return own.filter((result) => result.outcome === 'stale' || result.outcome === 'kept');
};

/** Any current group member can drain the shared inbox. The transaction retries
 * if another member appends/completes/undoes/reschedules while it is running.
 * No rules deployment, backend job or destructive migration is needed.
 */
export const flushVisitCommands = (clientId: string, scopeKey: string, userId: string): Promise<void> => {
  const runningKey = `${userId}/${scopeKey}/${clientId}`;
  const existing = running.get(runningKey);
  if (existing) return existing;
  const task = (async () => {
    if (auth().currentUser?.uid !== userId) return;
    await commitVisitCommands(db, clientId, scopeKey, () => auth().currentUser?.uid === userId);
  })().catch((error) => {
    // The durable inbox stays intact on failure. The query listener retries on
    // snapshots, foregrounding and a bounded timer while there is pending work.
    const code = String(error?.code || '');
    if (!/unavailable|deadline-exceeded|aborted|cancelled/.test(code)) {
      reportError(error, 'flushVisitCommands');
    }
  }).finally(() => { running.delete(runningKey); });
  running.set(runningKey, task);
  return task;
};
