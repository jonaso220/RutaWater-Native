import type { Client } from '../../types';
import { validateBackup } from '../backupRestore';
import {
  buildClientIdentityIndex,
  getRelatedClientReference,
  getRelatedRecordStableClientId,
  getStableClientId,
  relatedRecordBelongsToClient,
  resolveClientForRelatedRecord,
  resolveClientForStableId,
} from '../clientIdentity';

const makeClient = (overrides: Partial<Client> & { id: string }): Client => ({
  name: 'Cliente',
  phone: '099 111 222',
  address: '',
  notes: '',
  lat: '',
  lng: '',
  mapsLink: '',
  freq: 'on_demand',
  visitDay: 'Sin Asignar',
  visitDays: [],
  specificDate: '',
  products: {},
  listOrder: 0,
  listOrders: {},
  isCompleted: false,
  isStarred: false,
  isPinned: false,
  isNote: false,
  alarm: '',
  lastVisited: null,
  completedAt: null,
  updatedAt: null,
  userId: 'user-1',
  ...overrides,
});

describe('stable client identity for debts and transfers', () => {
  test('keeps namesakes with the same phone separate without an explicit shared customerId', () => {
    const first = makeClient({ id: 'client-a', name: 'María', customerId: 'client-a' });
    const second = makeClient({ id: 'client-b', name: 'María', customerId: 'client-b' });
    const index = buildClientIdentityIndex([first, second]);

    expect(relatedRecordBelongsToClient('client-a', first, index)).toBe(true);
    expect(relatedRecordBelongsToClient('client-a', second, index)).toBe(false);
    expect(relatedRecordBelongsToClient('client-b', first, index)).toBe(false);
  });

  test('groups a stable record and legacy document-id records only when customerId explicitly links them', () => {
    const primary = makeClient({ id: 'customer-1', customerId: 'customer-1' });
    const extraOrder = makeClient({
      id: 'route-order-9',
      customerId: 'customer-1',
      freq: 'once',
    });
    const index = buildClientIdentityIndex([primary, extraOrder]);

    expect(getStableClientId(extraOrder)).toBe('customer-1');
    expect(getRelatedClientReference(extraOrder)).toEqual({
      clientId: 'route-order-9',
      customerId: 'customer-1',
    });
    expect(getRelatedRecordStableClientId({
      clientId: 'route-order-9',
      customerId: 'customer-1',
    }, index)).toBe('customer-1');
    expect(getRelatedRecordStableClientId('customer-1', index)).toBe('customer-1');
    expect(getRelatedRecordStableClientId('route-order-9', index)).toBe('customer-1');
    expect(relatedRecordBelongsToClient('route-order-9', primary, index)).toBe(true);
    expect(relatedRecordBelongsToClient('customer-1', extraOrder, index)).toBe(true);
  });

  test('preserves a legacy record that contains only the exact clientId', () => {
    const legacy = makeClient({ id: 'legacy-document' });
    const index = buildClientIdentityIndex([legacy]);

    expect(getStableClientId(legacy)).toBe('legacy-document');
    expect(getRelatedRecordStableClientId('legacy-document', index)).toBe('legacy-document');
    expect(resolveClientForRelatedRecord('legacy-document', index)).toBe(legacy);
  });

  test('prefers an additive customerId while preserving the exact clientId for old app versions', () => {
    const order = makeClient({ id: 'route-order-9', customerId: 'customer-1', freq: 'once' });
    const index = buildClientIdentityIndex([order]);
    const stored = getRelatedClientReference(order);

    expect(stored.clientId).toBe('route-order-9');
    expect(stored.customerId).toBe('customer-1');
    expect(getRelatedRecordStableClientId(stored, index)).toBe('customer-1');
  });

  test('keeps an orphan legacy clientId isolated instead of guessing from frozen name or phone', () => {
    const sameContact = makeClient({ id: 'different-client', customerId: 'different-client' });
    const index = buildClientIdentityIndex([sameContact]);

    expect(getRelatedRecordStableClientId('deleted-client', index)).toBe('deleted-client');
    expect(resolveClientForRelatedRecord('deleted-client', index)).toBeUndefined();
    expect(relatedRecordBelongsToClient('deleted-client', sameContact, index)).toBe(false);
  });

  test('resolves a stable id after the original document was deleted but a linked order remains', () => {
    const remainingOrder = makeClient({
      id: 'route-order-9',
      customerId: 'deleted-original',
      freq: 'once',
    });
    const index = buildClientIdentityIndex([remainingOrder]);

    expect(resolveClientForRelatedRecord('deleted-original', index)).toBe(remainingOrder);
    expect(resolveClientForStableId('deleted-original', index)).toBe(remainingOrder);
  });

  test('contact edits do not change linkage', () => {
    const before = makeClient({ id: 'order-a', customerId: 'customer-1' });
    const after = makeClient({
      id: 'order-a',
      customerId: 'customer-1',
      name: 'Nombre actualizado',
      phone: '098 000 000',
    });

    expect(getRelatedRecordStableClientId(
      'order-a',
      buildClientIdentityIndex([before]),
    )).toBe('customer-1');
    expect(getRelatedRecordStableClientId(
      'order-a',
      buildClientIdentityIndex([after]),
    )).toBe('customer-1');
  });

  test('preserves 125 legacy debts exactly without collapsing namesakes', () => {
    const count = 125;
    const originalClientIds = Array.from({ length: count }, (_, index) => `client-${index}`);
    const backup = validateBackup({
      clients: originalClientIds.map((id) => ({
        id,
        name: 'Cliente repetido',
        phone: '099 111 222',
        freq: 'on_demand',
        visitDay: 'Sin Asignar',
      })),
      debts: originalClientIds.map((clientId, index) => ({
        id: `debt-${index}`,
        clientId,
        clientName: 'Cliente repetido',
        amount: index + 1,
      })),
      transfers: [],
    });
    const clients = backup.clients.map((client) => makeClient({
      id: client.id,
      customerId: client.customerId,
      name: client.name,
      phone: client.phone,
    }));
    const index = buildClientIdentityIndex(clients);
    const resolvedIds = backup.debts.map((debt) =>
      getRelatedRecordStableClientId(debt, index));

    expect(backup.debts).toHaveLength(count);
    expect(backup.debts.map((debt) => debt.clientId)).toEqual(originalClientIds);
    expect(resolvedIds).toEqual(originalClientIds);
    expect(new Set(resolvedIds).size).toBe(count);
  });
});
