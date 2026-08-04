import { validateBackup } from '../backupRestore';
import {
  buildBackupRestorePlan,
  deterministicRestoreDocumentId,
  RestoreWriteOperation,
} from '../backupRestorePlan';

const rawBackup = () => ({
  exportDate: '2026-08-04',
  clients: [
    {
      id: 'client-a',
      customerId: 'client-a',
      name: 'Cliente A',
      freq: 'weekly',
      visitDay: 'Lunes',
      visitDays: ['Lunes'],
      relationships: { 'client-b': 'hermano_a' },
      sameHousehold: { 'client-b': false },
    },
    {
      id: 'client-b',
      customerId: 'client-b',
      name: 'Cliente B',
      freq: 'on_demand',
      visitDay: 'Sin Asignar',
    },
  ],
  debts: [{ id: 'debt-a', clientId: 'client-a', amount: 250 }],
  transfers: [{ id: 'transfer-a', clientId: 'client-b' }],
});

const keyFor = (operation: RestoreWriteOperation): string =>
  `${operation.collection}/${operation.id}`;

const applyMerged = (
  stored: Map<string, Record<string, any>>,
  operation: RestoreWriteOperation,
) => {
  const key = keyFor(operation);
  stored.set(key, { ...(stored.get(key) || {}), ...operation.data });
};

describe('backup restore planning', () => {
  test('keeps another member attribution immutable on existing shared records', () => {
    const backup = validateBackup(rawBackup());
    const plan = buildBackupRestorePlan({
      backup,
      scope: { userId: 'restoring-member', groupId: 'shared-route' },
      currentClients: [{
        id: 'existing-client-a',
        backupSourceId: 'client-a',
        userId: 'original-creator',
        groupId: 'shared-route',
      }],
      currentDebts: [{
        id: 'existing-debt-a',
        backupSourceId: 'debt-a',
        clientId: 'existing-client-a',
        userId: 'original-creator',
        groupId: 'shared-route',
      }],
      currentTransfers: [],
      now: new Date('2026-08-04T12:00:00.000Z'),
    });

    const existingClientWrite = plan.find((operation) => operation.id === 'existing-client-a')!;
    const existingDebtWrite = plan.find((operation) => operation.id === 'existing-debt-a')!;
    expect(existingClientWrite.data).not.toHaveProperty('userId');
    expect(existingClientWrite.data).not.toHaveProperty('groupId');
    expect(existingClientWrite.data).not.toHaveProperty('isNote');
    expect(existingDebtWrite.data).not.toHaveProperty('userId');
    expect(existingDebtWrite.data).not.toHaveProperty('groupId');
    expect({
      userId: 'original-creator',
      groupId: 'shared-route',
      ...existingClientWrite.data,
    }).toMatchObject({
      userId: 'original-creator',
      groupId: 'shared-route',
    });

    const newClientWrite = plan.find((operation) => operation.data.backupSourceId === 'client-b')!;
    expect(newClientWrite.data).toMatchObject({
      userId: 'restoring-member',
      groupId: 'shared-route',
    });
    expect(existingDebtWrite.data.clientId).toBe('existing-client-a');
  });

  test('a batch-two failure and immediate stale retry cannot duplicate records or break links', () => {
    const backup = validateBackup(rawBackup());
    const input = {
      backup,
      scope: { userId: 'owner', groupId: 'route-1' },
      // Deliberately stale on both attempts, matching a retry before listeners
      // receive the first committed batch.
      currentClients: [],
      currentDebts: [],
      currentTransfers: [],
      now: new Date('2026-08-04T12:00:00.000Z'),
    };
    const firstPlan = buildBackupRestorePlan(input);
    const stored = new Map<string, Record<string, any>>();

    // Simulate a two-operation Firestore batch: batch 1 commits both clients,
    // then batch 2 fails before debts/transfers are written.
    firstPlan.slice(0, 2).forEach((operation) => applyMerged(stored, operation));
    expect(() => { throw new Error('BATCH_2_FAILED'); }).toThrow('BATCH_2_FAILED');

    const retryPlan = buildBackupRestorePlan(input);
    retryPlan.forEach((operation) => applyMerged(stored, operation));

    expect(retryPlan.map(keyFor)).toEqual(firstPlan.map(keyFor));
    expect(stored.size).toBe(4);
    const clientAId = deterministicRestoreDocumentId('clients', 'route-1', 'client-a');
    const clientBId = deterministicRestoreDocumentId('clients', 'route-1', 'client-b');
    expect(stored.get(`debts/${deterministicRestoreDocumentId('debts', 'route-1', 'debt-a')}`))
      .toMatchObject({ clientId: clientAId, backupSourceId: 'debt-a' });
    expect(stored.get(`transfers/${deterministicRestoreDocumentId('transfers', 'route-1', 'transfer-a')}`))
      .toMatchObject({ clientId: clientBId, backupSourceId: 'transfer-a' });
    expect(stored.get(`clients/${clientAId}`)?.relationships).toEqual({
      [clientBId]: 'hermano_a',
    });
  });

  test('an exact document id wins over another record backupSourceId', () => {
    const backup = validateBackup(rawBackup());
    const plan = buildBackupRestorePlan({
      backup,
      scope: { userId: 'owner' },
      currentClients: [
        { id: 'client-a', userId: 'owner' },
        {
          id: 'restored-copy',
          backupSourceId: 'client-a',
          userId: 'owner',
        },
      ],
      currentDebts: [],
      currentTransfers: [],
      now: new Date('2026-08-04T12:00:00.000Z'),
    });

    const restoredClientA = plan.find((operation) =>
      operation.collection === 'clients' && operation.data.backupSourceId === 'client-a');
    expect(restoredClientA?.id).toBe('client-a');
  });
});
