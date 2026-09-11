jest.mock('../../i18n', () => ({ language: 'es' }));

import { buildDebtTotalWhatsAppUrl } from '../debtTotalMessage';

describe('debt total WhatsApp message shared by both debt screens', () => {
  test('preserves the default message, currency format and Uruguay phone normalization', () => {
    const url = new URL(buildDebtTotalWhatsAppUrl('099 123 456', 1250.5)!);
    expect(url.protocol).toBe('whatsapp:');
    expect(url.searchParams.get('phone')).toBe('59899123456');
    expect(url.searchParams.get('text')).toBe('La deuda es de $1.250,5. Saludos');
  });

  test('uses the configured debt template and safely encodes special characters', () => {
    const url = new URL(buildDebtTotalWhatsAppUrl(
      '+598 099 123 456', 300,
      'Hola 👋\nSaldo: ${total} & gracias #1',
    )!);
    expect(url.searchParams.get('phone')).toBe('59899123456');
    expect(url.searchParams.get('text')).toBe('Hola 👋\nSaldo: $300 & gracias #1');
    expect(url.hash).toBe('');
  });

  test('preserves custom templates without a total placeholder', () => {
    const url = new URL(buildDebtTotalWhatsAppUrl('099123456', 300, 'Mensaje propio')!);
    expect(url.searchParams.get('text')).toBe('Mensaje propio');
  });

  test('does not prepare a message without a phone or positive balance', () => {
    expect(buildDebtTotalWhatsAppUrl('', 300)).toBeNull();
    expect(buildDebtTotalWhatsAppUrl('099123456', 0)).toBeNull();
    expect(buildDebtTotalWhatsAppUrl('099123456', -10)).toBeNull();
  });
});
