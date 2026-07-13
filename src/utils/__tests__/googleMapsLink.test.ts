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

  test('valida el enlace real en React Native sin depender del polyfill URL', () => {
    const runtime = globalThis as any;
    const originalUrl = runtime.URL;
    runtime.URL = class ReactNativeUrlPolyfill {
      get protocol(): string {
        throw new Error('URL.protocol is not implemented');
      }
    };
    try {
      expect(normalizeGoogleMapsLink('https://maps.app.goo.gl/REDvKKVAReRLe3fXA'))
        .toBe('https://maps.app.goo.gl/REDvKKVAReRLe3fXA');
    } finally {
      runtime.URL = originalUrl;
    }
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
    expect(normalizeGoogleMapsLink('https://maps.app.goo.gl.evil.example/cliente')).toBe('');
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
  test('extrae una ficha etiquetada sin convertir todo el pedido en nombre', () => {
    const card = parseDirectoryContactCard(`Pedido de cliente:

Nombre: MELISA FARIÑA

Dirección: CRUZ DEL SUR (DEL CANAL) M. 51 SOL. 14
Esquina: JUAN ZORRILLA DE SAN MARTIN
Detalle: SAN JOSE DE CARRASCO

https://maps.app.goo.gl/REDvKKVAReRLe3fXA

Teléfono: 098116892

Producto:
Bidon: 12Lts 2   Dispensador: NAT 1

Soda: 0
Detalle: NUEVO... TE ESPERA MARTES CASA ESQUINA.`);

    expect(card).toEqual({
      name: 'MELISA FARIÑA',
      address: 'CRUZ DEL SUR (DEL CANAL) M. 51 SOL. 14, Esquina JUAN ZORRILLA DE SAN MARTIN, SAN JOSE DE CARRASCO',
      phone: '098116892',
      mapsLink: 'https://maps.app.goo.gl/REDvKKVAReRLe3fXA',
      usedAddressAsName: false,
    });
  });

  test('extrae la misma ficha cuando las etiquetas llegan en Markdown', () => {
    const card = parseDirectoryContactCard(`*Pedido de cliente:*
*Nombre:* MELISA FARIÑA
*Dirección:* CRUZ DEL SUR (DEL CANAL) M. 51 SOL. 14
*Esquina:* JUAN ZORRILLA DE SAN MARTIN
*Detalle:* SAN JOSE DE CARRASCO
https://maps.app.goo.gl/REDvKKVAReRLe3fXA
*Teléfono:* 098116892
*Producto:* Bidon: 12Lts 2 Dispensador: NAT 1
*Soda:* 0
*Detalle:* NUEVO... TE ESPERA MARTES CASA ESQUINA.`);

    expect(card).toEqual({
      name: 'MELISA FARIÑA',
      address: 'CRUZ DEL SUR (DEL CANAL) M. 51 SOL. 14, Esquina JUAN ZORRILLA DE SAN MARTIN, SAN JOSE DE CARRASCO',
      phone: '098116892',
      mapsLink: 'https://maps.app.goo.gl/REDvKKVAReRLe3fXA',
      usedAddressAsName: false,
    });
  });

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
