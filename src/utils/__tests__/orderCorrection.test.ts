const {
  MAX_CORRECTION_LENGTH,
  buildOrderUserMessage,
  normalizeCorrectionRequest,
} = require('../../../netlify/functions/_shared/orderCorrection');

describe('correcciones incrementales de Pedido IA', () => {
  const previousResult = {
    tool: 'create_new_client',
    input: {
      name: 'Iván - Alejandro',
      phone: '095711744, 094211307',
      address: 'Cruz del Sur M. 21 Sol 5',
      mapsLink: 'https://maps.app.goo.gl/example',
      notes: 'Pide factura',
      products: { b20: 2, disp_elec_new: 1 },
      freq: 'biweekly',
      visitDay: 'Sábado',
      specificDate: '',
    },
  };

  test('mantiene el prompt original cuando no hay una corrección', () => {
    const message = buildOrderUserMessage({
      text: 'Pedido de Ana',
      todayIso: '2026-08-21',
    });

    expect(message).toBe('FECHA ACTUAL: 2026-08-21 (Viernes)\n\nTEXTO A PARSEAR:\n"""\nPedido de Ana\n"""');
    expect(message).not.toContain('REGLAS PARA CORREGIR');
  });

  test('envía la interpretación actual como base y ordena conservar lo no mencionado', () => {
    const message = buildOrderUserMessage({
      text: 'Pedido original completo',
      todayIso: '2026-08-21',
      correction: 'El dispensador es eléctrico nuevo',
      previousResult,
    });

    expect(message).toContain('INTERPRETACIÓN ACTUAL');
    expect(message).toContain(JSON.stringify(previousResult));
    expect(message).toContain('El dispensador es eléctrico nuevo');
    expect(message).toContain('Conserva exactamente todos los datos');
    expect(message).toContain('Cambia solamente lo pedido por el usuario');
    expect(message).toContain('prevalece la corrección más reciente');
  });

  test('rechaza correcciones incompletas, vacías o demasiado largas', () => {
    expect(() => normalizeCorrectionRequest('Cambiar producto', undefined)).toThrow('previousResult');
    expect(() => normalizeCorrectionRequest('   ', previousResult)).toThrow('texto no vacío');
    expect(() => normalizeCorrectionRequest(
      'x'.repeat(MAX_CORRECTION_LENGTH + 1),
      previousResult,
    )).toThrow('supera el máximo');
  });

  test('descarta metadatos del cliente y conserva sólo tool e input', () => {
    expect(normalizeCorrectionRequest('Cambiar producto', {
      ...previousResult,
      context: { sourceText: 'dato local' },
      provider: 'openai',
    })).toEqual({
      correction: 'Cambiar producto',
      previousResult,
    });
  });
});
