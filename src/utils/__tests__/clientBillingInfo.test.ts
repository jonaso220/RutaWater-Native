import {
  billingInfoUpdates,
  buildClientShareMessage,
  isValidClientEmail,
  sanitizeClientBillingInfo,
} from '../clientBillingInfo';
import { Client } from '../../types';

const labels = {
  title: 'DATOS DEL CLIENTE',
  name: 'Nombre',
  address: 'Dirección',
  location: 'Ubicación',
  rut: 'RUT',
  businessName: 'Razón social',
  email: 'Email',
  phone: 'Teléfono',
};

describe('client billing info', () => {
  test('trims fields and lowercases the email', () => {
    expect(sanitizeClientBillingInfo({
      rut: ' 21 234567 0019 ',
      businessName: ' Agua Sur S.R.L. ',
      email: ' Compras@AguaSur.UY ',
    })).toEqual({
      rut: '21 234567 0019',
      businessName: 'Agua Sur S.R.L.',
      email: 'compras@aguasur.uy',
    });
  });

  test('accepts an empty email but rejects a malformed one', () => {
    expect(isValidClientEmail('')).toBe(true);
    expect(isValidClientEmail('a@b.uy')).toBe(true);
    expect(isValidClientEmail('ab.uy')).toBe(false);
  });

  test('only reports fields that changed, so legacy docs are untouched', () => {
    expect(billingInfoUpdates({}, { rut: '', businessName: '', email: '' })).toEqual({});
    expect(billingInfoUpdates({ rut: '123' }, { rut: '123', businessName: 'X', email: '' }))
      .toEqual({ businessName: 'X' });
  });

  test('shares name, address, link and RUT in order, skipping empty fields', () => {
    const client = {
      name: 'Juan Pérez',
      address: 'Av. Italia 1234',
      mapsLink: 'https://maps.app.goo.gl/abc123',
      lat: '',
      lng: '',
      phone: '099 123 456',
      rut: '212345670019',
      businessName: 'Agua Sur S.R.L.',
      email: '',
    } as unknown as Client;

    expect(buildClientShareMessage(client, labels)).toBe([
      '*DATOS DEL CLIENTE*',
      '',
      '*Nombre:* Juan Pérez',
      '*Dirección:* Av. Italia 1234',
      '*Ubicación:* https://maps.app.goo.gl/abc123',
      '*RUT:* 212345670019',
      '*Razón social:* Agua Sur S.R.L.',
      '*Teléfono:* 099 123 456',
    ].join('\n'));
  });
});
