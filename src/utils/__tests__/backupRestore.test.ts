import { validateBackup } from '../backupRestore';

const validBackup = {
  exportDate: '2026-07-10',
  exportedBy: 'test@example.com',
  clients: [{
    id: 'client-1',
    name: 'Cliente Uno',
    phone: '099 123 456',
    mapsLink: 'https://maps.app.goo.gl/example',
    addresses: [
      { id: 'home', type: 'home', address: 'Casa', mapsLink: 'https://maps.app.goo.gl/home' },
      { id: 'work', type: 'work', address: 'Trabajo', mapsLink: 'javascript:alert(1)' },
    ],
    freq: 'weekly',
    visitDay: 'Lunes',
    visitDays: ['Lunes'],
    products: { b20: 2, custom_hielo: '3', '../bad': 9 },
    lastDeliveredAt: '2026-07-09T12:00:00.000Z',
    relationships: { 'client-2': 'hermano_a', invalid: 'not-a-type' },
    sameHousehold: { 'client-2': false, invalid: 'yes' },
  }],
  debts: [{ id: 'debt-1', clientId: 'client-1', amount: 350 }],
  transfers: [{ id: 'transfer-1', clientId: 'client-1' }],
};

describe('backup validation', () => {
  test('accepts and sanitizes an exported RutaWater backup', () => {
    const backup = validateBackup(validBackup);

    expect(backup.clients).toHaveLength(1);
    expect(backup.clients[0].products).toEqual({ b20: '2', custom_hielo: '3' });
    expect(backup.clients[0].relationships).toEqual({ 'client-2': 'hermano_a' });
    expect(backup.clients[0].sameHousehold).toEqual({ 'client-2': false });
    expect(backup.clients[0].customerId).toBe('client-1');
    expect(backup.clients[0].addresses).toEqual([
      { id: 'home', type: 'home', address: 'Casa', mapsLink: 'https://maps.app.goo.gl/home', lat: '', lng: '' },
      { id: 'work', type: 'work', address: 'Trabajo', mapsLink: '', lat: '', lng: '' },
    ]);
    expect(backup.clients[0].lastDeliveredAt?.toISOString()).toBe('2026-07-09T12:00:00.000Z');
    expect(backup.debts[0].amount).toBe(350);
    expect(backup.debts[0].customerId).toBeUndefined();
    expect(backup.transfers[0].customerId).toBeUndefined();
    expect(backup.schemaVersion).toBe(1);
  });

  test('preserves additive customerId while accepting legacy related records without it', () => {
    const backup = validateBackup({
      ...validBackup,
      debts: [{
        id: 'debt-1',
        clientId: 'route-order-1',
        customerId: 'client-1',
        amount: 350,
      }],
      transfers: [{
        id: 'transfer-1',
        clientId: 'route-order-1',
        customerId: 'client-1',
      }],
    });

    expect(backup.debts[0]).toMatchObject({
      clientId: 'route-order-1',
      customerId: 'client-1',
    });
    expect(backup.transfers[0]).toMatchObject({
      clientId: 'route-order-1',
      customerId: 'client-1',
    });
  });

  test('rejects malformed and empty files', () => {
    expect(() => validateBackup({ clients: 'invalid' })).toThrow('INVALID_BACKUP');
    expect(() => validateBackup({ clients: [], debts: [], transfers: [] })).toThrow('EMPTY_BACKUP');
  });

  test('rejects duplicate ids and invalid related records', () => {
    expect(() => validateBackup({
      clients: [validBackup.clients[0], validBackup.clients[0]],
      debts: [],
      transfers: [],
    })).toThrow('DUPLICATE_CLIENT_ID');
    expect(() => validateBackup({
      clients: validBackup.clients,
      debts: [{ id: 'debt-1', clientId: 'client-1', amount: -10 }],
      transfers: [],
    })).toThrow('INVALID_DEBT_0');
  });

  test('drops unsafe map links instead of restoring them', () => {
    const backup = validateBackup({
      clients: [{ ...validBackup.clients[0], mapsLink: 'javascript:alert(1)' }],
      debts: [],
      transfers: [],
    });
    expect(backup.clients[0].mapsLink).toBe('');
  });

  test('restores only alarms that carry an exact one-shot instant', () => {
    const legacy = validateBackup({
      clients: [{ ...validBackup.clients[0], alarm: '09:30', alarmDay: 'Lunes' }],
      debts: [],
      transfers: [],
    });
    expect(legacy.clients[0]).toMatchObject({
      alarm: '',
      alarmDay: '',
      alarmScheduledFor: null,
    });

    const scheduled = validateBackup({
      clients: [{
        ...validBackup.clients[0],
        alarm: '09:30',
        alarmDay: 'Lunes',
        alarmScheduledFor: 4102448400000,
      }],
      debts: [],
      transfers: [],
    });
    expect(scheduled.clients[0]).toMatchObject({
      alarm: '09:30',
      alarmDay: 'Lunes',
      alarmScheduledFor: 4102448400000,
    });
  });
});
