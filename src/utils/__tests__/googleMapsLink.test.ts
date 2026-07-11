import { hasGoogleLocationLinkText, looksLikeCompleteClientCardText, normalizeGoogleMapsLink, parseDirectoryContactCard } from '../googleMapsLink';

describe('normalizeGoogleMapsLink', () => {
  test('limpia puntuación de WhatsApp sin perder el enlace', () => {
    expect(normalizeGoogleMapsLink('https://maps.app.goo.gl/AbC123).'))
      .toBe('https://maps.app.goo.gl/AbC123');
  });

  test('acepta un enlace de Maps sin protocolo', () => {
    expect(normalizeGoogleMapsLink('maps.app.goo.gl/AbC123'))
      .toBe('https://maps.app.goo.gl/AbC123');
  });

  test('recupera del texto original un enlace omitido por la IA', () => {
    const pasted = 'Nombre: Ana\nDirección: Calle 1\nhttps://goo.gl/maps/Test99';
    expect(normalizeGoogleMapsLink('', pasted)).toBe('https://goo.gl/maps/Test99');
  });

  test('acepta el formato maps.google.com compartido por algunos teléfonos', () => {
    expect(normalizeGoogleMapsLink('https://maps.google.com/?q=-34.9,-56.1'))
      .toBe('https://maps.google.com/?q=-34.9,-56.1');
  });

  test('acepta los acortadores nuevos de Google', () => {
    expect(normalizeGoogleMapsLink('https://share.google/AbC123'))
      .toBe('https://share.google/AbC123');
    expect(normalizeGoogleMapsLink('https://g.co/kgs/Place99'))
      .toBe('https://g.co/kgs/Place99');
    expect(hasGoogleLocationLinkText('Ubicación: share.google/AbC123')).toBe(true);
  });

  test('rechaza URLs ajenas aunque sean seguras', () => {
    expect(normalizeGoogleMapsLink('https://example.com/maps/cliente')).toBe('');
  });
});

describe('looksLikeCompleteClientCardText', () => {
  test('detecta una ficha completa aun sin la palabra guardar', () => {
    expect(looksLikeCompleteClientCardText(
      'Nombre: Ana Pérez\nDirección: Calle 1 esquina 2\nTel: 099 123 456\nmaps.app.goo.gl/AbC123',
    )).toBe(true);
  });

  test('detecta la ficha compacta de WhatsApp con "Esq" en una sola línea', () => {
    const card = 'Claudia - Demir Esq Indiana - https://goo.gl/maps/wpLs84gXrssF96mWA +598 95 624 748';
    expect(looksLikeCompleteClientCardText(card)).toBe(true);
    expect(normalizeGoogleMapsLink('', card)).toBe('https://goo.gl/maps/wpLs84gXrssF96mWA');
  });

  test('limpia marcas invisibles insertadas por WhatsApp dentro del enlace', () => {
    const card = 'Claudia - Demir Esq Indiana - https://goo.gl/\u200emaps/wpLs84gXrssF96mWA +598 95 624 748';
    expect(normalizeGoogleMapsLink('', card)).toBe('https://goo.gl/maps/wpLs84gXrssF96mWA');
  });

  test('no confunde un mensaje con solo nombre y mapa con un alta completa', () => {
    expect(looksLikeCompleteClientCardText('Ana Pérez https://maps.app.goo.gl/AbC123')).toBe(false);
  });
});

describe('parseDirectoryContactCard', () => {
  test('usa la dirección como nombre cuando la ficha no trae nombre', () => {
    const card = parseDirectoryContactCard(
      'Demir Esq Indiana - https://goo.gl/maps/wpLs84gXrssF96mWA +598 95 624 748',
    );
    expect(card).toEqual({
      name: 'Demir Esq Indiana',
      address: 'Demir Esq Indiana',
      phone: '+598 95 624 748',
      mapsLink: 'https://goo.gl/maps/wpLs84gXrssF96mWA',
      usedAddressAsName: true,
    });
  });

  test('separa nombre y dirección cuando ambos vienen en la ficha', () => {
    const card = parseDirectoryContactCard(
      'Claudia - Demir Esq Indiana - https://goo.gl/maps/wpLs84gXrssF96mWA +598 95 624 748',
    );
    expect(card?.name).toBe('Claudia');
    expect(card?.address).toBe('Demir Esq Indiana');
    expect(card?.usedAddressAsName).toBe(false);
  });
});
