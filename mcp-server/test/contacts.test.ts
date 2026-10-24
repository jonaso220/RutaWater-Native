import { contactName, uyPhone } from '../src/contacts';

describe('contactos', () => {
  test('teléfono uruguayo en formato internacional', () => {
    expect(uyPhone('099 309 717')).toBe('+59899309717');
    expect(uyPhone('+598 91 667 066')).toBe('+59891667066');
    expect(uyPhone('91667066')).toBe('+59891667066');
    expect(() => uyPhone('123')).toThrow('inválido');
  });
  test('nombre del contacto: nombre - dirección - y el link aparte', () => {
    expect(contactName('Irma', 'Sarandí esq. Baltasar Brum', 'https://maps.app.goo.gl/x')).toEqual({ first: 'Irma - Sarandí esq. Baltasar Brum -', last: 'https://maps.app.goo.gl/x' });
    expect(contactName('Irma', '', '')).toEqual({ first: 'Irma', last: '' });
  });
});
