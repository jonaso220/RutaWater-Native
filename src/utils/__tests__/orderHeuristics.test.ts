const {
  classifyClientIdentity,
  looksLikeCompleteClientCard,
  repairOrRetryDecision,
} = require('../../../netlify/functions/_shared/orderHeuristics');

const CARD = `Nombre: Cliente Nuevo
Dirección: Calle Rivera 1234, Esquina Soca
Teléfono: +598 99 123 456
https://maps.app.goo.gl/ClienteNuevo`;

describe('recuperación de fichas nuevas para Pedido IA', () => {
  test('clasifica homónimos por teléfono y dirección, no solo por nombre', () => {
    const clients = [{
      id: 'ana-1', name: 'Ana Pérez', phone: '099111222', phones: ['099111222'],
      address: 'Calle 1', addresses: ['Calle 1'],
    }];
    expect(classifyClientIdentity(
      { name: 'Ána Perez', phone: '+598 99 111 222', address: 'Calle 9' },
      clients,
    )).toBe('existing');
    expect(classifyClientIdentity(
      { name: 'Ana Pérez', phone: '098333444', address: 'Calle 9' },
      clients,
    )).toBe('new');
    expect(classifyClientIdentity(
      { name: 'Ana Pérez', phone: '098333444', address: 'Calle 1' },
      clients,
    )).toBe('ambiguous');
  });

  test('reconoce una ficha completa copiada desde WhatsApp', () => {
    expect(looksLikeCompleteClientCard(CARD)).toBe(true);
  });

  test('la ficha compacta de Claudia fuerza alta si el modelo dice no encontrado', () => {
    const compact = 'Claudia - Demir Esq Indiana - https://goo.gl/maps/wpLs84gXrssF96mWA +598 95 624 748';
    const decision = repairOrRetryDecision(
      { name: 'report_not_found', input: { mentioned_name: 'Claudia' } },
      compact,
      [],
    );
    expect(looksLikeCompleteClientCard(compact)).toBe(true);
    expect(decision.retryAsCreate).toBe(true);
  });

  test('convierte no-encontrado en un segundo parseo de alta si no existe', () => {
    const decision = repairOrRetryDecision(
      { name: 'report_not_found', input: { mentioned_name: 'Cliente Nuevo' } },
      CARD,
      [{ id: 'otro', name: 'Cliente Viejo' }],
    );
    expect(decision.retryAsCreate).toBe(true);
  });

  test('recupera un homónimo válido aunque el modelo haya pedido no actuar', () => {
    const decision = repairOrRetryDecision(
      { name: 'report_no_action', input: { message: 'Ya existe alguien con ese nombre' } },
      CARD,
      [{
        id: 'otro-cliente', name: 'Cliente Nuevo', phone: '099999999',
        address: 'Calle Distinta 55', mapsLink: 'https://maps.app.goo.gl/OtroCliente',
      }],
    );
    expect(decision.retryAsCreate).toBe(true);
  });

  test('no fuerza un alta si el teléfono ya identifica al cliente existente', () => {
    const decision = repairOrRetryDecision(
      { name: 'report_no_action', input: { message: 'Ya existe' } },
      CARD,
      [{
        id: 'mismo-cliente', name: 'Cliente Nuevo', phone: '099123456',
        address: 'Otra dirección', mapsLink: '',
      }],
    );
    expect(decision.retryAsCreate).toBe(false);
  });

  test('una ficha homónima distinta corrige una tool de cliente existente mal elegida', () => {
    const decision = repairOrRetryDecision(
      {
        name: 'update_client_data',
        input: { matched_client_id: 'otro-cliente', matched_client_name: 'Cliente Nuevo' },
      },
      CARD,
      [{
        id: 'otro-cliente', name: 'Cliente Nuevo', phone: '099999999',
        address: 'Calle Distinta 55', mapsLink: '',
      }],
    );
    expect(decision.retryAsCreate).toBe(true);
  });

  test('no crea duplicado si la ficha corresponde a un cliente existente', () => {
    const decision = repairOrRetryDecision(
      { name: 'report_not_found', input: { mentioned_name: 'Cliente Nuevo' } },
      CARD,
      [{ id: 'real', name: 'Cliente Nuevo' }],
    );
    expect(decision.retryAsCreate).toBe(false);
  });

  test('no crea duplicado si el modelo leyó mal el nombre pero la ficha contiene uno existente', () => {
    const decision = repairOrRetryDecision(
      { name: 'report_not_found', input: { mentioned_name: 'Nombre desconocido' } },
      CARD.replace('Cliente Nuevo', 'Cliente Registrado'),
      [{ id: 'real', name: 'Cliente Registrado' }],
    );
    expect(decision.retryAsCreate).toBe(false);
  });

  test('repara un id inventado cuando el nombre identifica un cliente único', () => {
    const decision = repairOrRetryDecision(
      {
        name: 'update_client_data',
        input: { matched_client_id: 'inventado', matched_client_name: 'Cliente Nuevo' },
      },
      'Agregá esta URL a Cliente Nuevo',
      [{ id: 'real', name: 'Cliente Nuevo' }],
    );
    expect(decision.retryAsCreate).toBe(false);
    expect(decision.toolUse.input.matched_client_id).toBe('real');
  });

  test('un nombre suelto no se convierte automáticamente en alta', () => {
    const decision = repairOrRetryDecision(
      { name: 'report_not_found', input: { mentioned_name: 'Cliente Nuevo' } },
      'Cliente Nuevo',
      [],
    );
    expect(decision.retryAsCreate).toBe(false);
  });
});
