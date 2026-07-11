import { validateBackup } from '../backupRestore';

const validBackup = {
  exportDate: '2026-07-10',
  exportedBy: 'test@example.com',
  clients: [{
    id: 'client-1',
    name: 'Cliente Uno',
    phone: '099 123 456',
    mapsLink: 'https://maps.app.goo.gl/example',
    freq: 'weekly',
    visitDay: 'Lunes',
    visitDays: ['Lunes'],
    products: { b20: 2, custom_hielo: '3', '../bad': 9 },
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
    expect(backup.debts[0].amount).toBe(350);
    expect(backup.schemaVersion).toBe(1);
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
});
