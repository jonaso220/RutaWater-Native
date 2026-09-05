import fs from 'fs';
import path from 'path';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { commitVisitCommands } from '../../../src/services/visitCommandTransaction';
import { withDefaults } from '../../../src/utils/clientDefaults';
import { createVisitCommand, createUndoCommand, visitStateKey, projectVisitCommands } from '../../../src/utils/visitCompletion';
import { getNextVisitDate, toLocalDateString } from '../../../src/utils/helpers';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;
const union = firebase.firestore.FieldValue.arrayUnion;

describeWithEmulator.each(['firestore.compat.rules', 'firestore.rules'])('shared completion on %s', (rules) => {
  let env: RulesTestEnvironment;
  let owner: firebase.firestore.Firestore;
  let member: firebase.firestore.Firestore;
  const read = async (db = owner) => withDefaults('client', (await db.doc('clients/client').get()).data());
  const drain = (db = owner) => commitVisitCommands(db as any, 'client', 'family', () => true);
  const next = (client: ReturnType<typeof withDefaults>) => toLocalDateString(getNextVisitDate(client)!);

  beforeAll(async () => {
    const [host, port] = emulator!.split(':');
    env = await initializeTestEnvironment({
      projectId: rules.includes('compat') ? 'demo-visit-compat' : 'demo-visit-strict',
      firestore: { host, port: Number(port), rules: fs.readFileSync(path.resolve(rules), 'utf8') },
    });
    owner = env.authenticatedContext('owner').firestore() as any;
    member = env.authenticatedContext('member').firestore() as any;
  });
  beforeEach(async () => {
    await env.clearFirestore();
    const today = new Date();
    const day = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][today.getDay()];
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        db.doc('users/owner').set({ groupId: 'family', role: 'admin', profileIds: [] }),
        db.doc('users/member').set({ groupId: 'family', role: 'member', profileIds: [] }),
        db.doc('groups/family').set({ adminId: 'owner', lifecycleState: 'active' }),
        db.doc('clients/client').set({
          userId: 'owner', groupId: 'family', name: 'Synthetic test client',
          freq: 'biweekly', visitDay: day, visitDays: [day],
          specificDate: toLocalDateString(today), isNote: false,
        }),
      ]);
    });
  });
  afterAll(async () => { await env.cleanup(); });

  test('two authenticated members enqueue and reconcile concurrently without losing either acknowledgement', async () => {
    const base = await read();
    const a = createVisitCommand(base, 'owner')!; const b = createVisitCommand(base, 'member')!;
    await Promise.all([
      owner.doc('clients/client').update({ visitCommands: union(a) }),
      member.doc('clients/client').update({ visitCommands: union(b) }),
    ]);
    await Promise.all([drain(owner), drain(member)]);
    const done = await read();
    expect(done.visitCommands).toEqual([]);
    expect(Object.values(done.visitReceipt!.confirmations).sort()).toEqual(['member', 'owner']);
    const due = next(done);
    await owner.doc('clients/client').update({ visitCommands: union(createUndoCommand(a)) });
    await drain();
    expect(next(await read())).toBe(due);
    await member.doc('clients/client').update({ visitCommands: union(createUndoCommand(b)) });
    await drain(member);
    expect(visitStateKey(await read())).toBe(visitStateKey(base));
  });

  test('offline intention remains harmless after another member reschedules', async () => {
    const base = await read(member);
    const b = createVisitCommand(base, 'member')!;
    await member.disableNetwork();
    const pendingWrite = member.doc('clients/client').update({ visitCommands: union(b) });
    try {
      const local = await new Promise<any>((resolve, reject) => {
        const unsubscribe = member.doc('clients/client').onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
          if (snapshot.metadata.hasPendingWrites) { unsubscribe(); resolve(snapshot.data()); }
        }, reject);
      });
      expect(projectVisitCommands(withDefaults('client', local))!.doneFor).toBe(b.occurrence);
      await owner.doc('clients/client').update({ scheduleRevision: 'rescheduled', specificDate: '2030-01-01', lastVisited: null, doneFor: '' });
    } finally { await member.enableNetwork(); }
    await pendingWrite;
    await Promise.all([drain(), drain(member)]);
    const latest = await read();
    expect(latest.specificDate).toBe('2030-01-01');
    expect(latest.lastVisited).toBeNull();
    expect(latest.visitResults!.find((r) => r.id === b.id)?.outcome).toBe('stale');
  });

  test('an offline completion and its undo are both persisted and reconcile together', async () => {
    const base = await read(member);
    const b = createVisitCommand(base, 'member')!;
    await member.disableNetwork();
    const completedWrite = member.doc('clients/client').update({ visitCommands: union(b) });
    const undoWrite = member.doc('clients/client').update({ visitCommands: union(createUndoCommand(b)) });
    await member.enableNetwork();
    await Promise.all([completedWrite, undoWrite]);
    await drain();
    expect(visitStateKey(await read())).toBe(visitStateKey(base));
    expect((await read()).visitCommands).toEqual([]);
  });

  test('Undo reaching the server before Complete leaves the visit pending', async () => {
    const base = await read(); const a = createVisitCommand(base, 'owner')!;
    await owner.doc('clients/client').update({ visitCommands: union(createUndoCommand(a)) });
    await drain();
    await owner.doc('clients/client').update({ visitCommands: union(a) });
    await drain();
    expect(visitStateKey(await read())).toBe(visitStateKey(base));
  });

  test('a delayed undo cannot restore the agenda after a later edit', async () => {
    const base = await read(); const a = createVisitCommand(base, 'owner')!;
    await owner.doc('clients/client').update({ visitCommands: union(a) }); await drain();
    await member.doc('clients/client').update({ scheduleRevision: 'new', visitDay: 'Martes', visitDays: ['Martes'] });
    await owner.doc('clients/client').update({ visitCommands: union(createUndoCommand(a)) }); await drain();
    expect((await read()).scheduleRevision).toBe('new');
    expect((await read()).visitDay).toBe('Martes');
  });
});
