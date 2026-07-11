const {
  looksLikeCompleteClientCard,
  repairOrRetryDecision,
} = require('../../../netlify/functions/_shared/orderHeuristics');

const CARD = `Nombre: Cliente Nuevo
Dirección: Calle Rivera 1234, Esquina Soca
Teléfono: +598 99 123 456
https://maps.app.goo.gl/ClienteNuevo`;

describe('recuperación de fichas nuevas para Pedido IA', () => {
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
