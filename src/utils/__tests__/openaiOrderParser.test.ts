const {
  extractToolUse,
  MAX_OUTPUT_TOKENS,
  sumUsage,
  toOpenAITools,
} = require('../../../netlify/functions/_shared/openai');
const {
  SYSTEM_RULES,
  TOOLS,
} = require('../../../netlify/functions/_shared/anthropic');

describe('adaptador OpenAI de Pedido IA', () => {
  test('convierte todas las tools a esquemas strict compatibles', () => {
    const tools = toOpenAITools();

    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required.sort()).toEqual(
        Object.keys(tool.parameters.properties).sort(),
      );
    }

    const schedule = tools.find((tool: any) => tool.name === 'schedule_existing_client');
    for (const field of ['products', 'add_products', 'remove_products']) {
      const schema = schedule.parameters.properties[field];
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toHaveLength(8);
    }
  });

  test('reserva salida suficiente para el catálogo máximo en strict mode', () => {
    const ids = Array.from({ length: 64 }, (_, index) => {
      const prefix = `p${String(index).padStart(2, '0')}_`;
      return `${prefix}${'x'.repeat(80 - prefix.length)}`;
    });
    const zeroMap = Object.fromEntries(ids.map((id) => [id, 0]));
    const worstCaseArguments = JSON.stringify({
      matched_client_id: 'client',
      matched_client_name: 'Cliente',
      products: zeroMap,
      add_products: zeroMap,
      remove_products: zeroMap,
      freq: 'weekly',
      visitDay: 'Lunes',
      specificDate: '',
      schedule_mode: 'replace',
      notes: '',
      notes_mode: 'keep',
    });

    // One token per ASCII character is deliberately conservative, and the
    // extra 4096 tokens leave space for low-effort reasoning/tool metadata.
    expect(MAX_OUTPUT_TOKENS).toBeGreaterThan(worstCaseArguments.length + 4096);
  });

  test('usa un resultado informativo para pedidos incompletos sin ensuciar notas', () => {
    const noAction = TOOLS.find((tool: any) => tool.name === 'report_no_action');

    expect(noAction).toBeDefined();
    expect(SYSTEM_RULES).toContain('"Farmacia Central" sin más datos');
    expect(SYSTEM_RULES).toContain('report_no_action');
    expect(SYSTEM_RULES).not.toContain('notes explicando que falta info');
    expect(SYSTEM_RULES).not.toContain('no lo metas en remove_products; explicalo en notes');
  });

  test('no permite elegir arbitrariamente entre varios pedidos del mismo cliente', () => {
    expect(SYSTEM_RULES).toContain('Si el cliente tiene varios pedidos pendientes');
    expect(SYSTEM_RULES).toContain('enumerá brevemente las opciones');
    expect(SYSTEM_RULES).toContain('No elijas uno arbitrariamente');
    expect(SYSTEM_RULES).not.toContain('si la solicitud no aclara cuál pedido y hay múltiples, elegí');
  });

  test('un producto fuera del catálogo detiene la operación y no se convierte en nota', () => {
    expect(SYSTEM_RULES).toContain('NUNCA conviertas automáticamente un producto desconocido en una nota');
    expect(SYSTEM_RULES).toContain('aunque el mismo texto también incluya productos válidos');
    expect(SYSTEM_RULES).toContain('Solo guardá ese texto en notes si el usuario pide explícitamente anotarlo');
    expect(SYSTEM_RULES).not.toContain('Van TAL CUAL en notes');
  });

  test('una ficha idéntica existente informa que no hay cambios sin decir que falta el cliente', () => {
    expect(SYSTEM_RULES).toContain('ya existe y no hay datos nuevos para actualizar');
    expect(SYSTEM_RULES).toContain('no uses report_not_found porque el cliente sí fue encontrado');
    expect(SYSTEM_RULES).not.toContain('report_not_found con reason="El cliente ya existe en el directorio"');
  });

  test('mantiene cancelaciones manuales y muestra el aviso correcto', () => {
    expect(SYSTEM_RULES).toContain('La IA no puede borrar ni cancelar pedidos');
    expect(SYSTEM_RULES).toContain('La eliminación es exclusivamente manual desde la UI');
    expect(SYSTEM_RULES).toContain('NUNCA uses report_not_found si el cliente existe');
    expect(SYSTEM_RULES).not.toContain('todos van a report_not_found con la razón anterior');
  });

  test('una coincidencia ambigua enumera clientes sin tratarlos como inexistentes', () => {
    expect(SYSTEM_RULES).toContain('Encontré a Maria Lopez y Maria Gonzalez');
    expect(SYSTEM_RULES).toContain('no usar report_not_found porque los clientes sí existen');
    expect(SYSTEM_RULES).not.toContain('usar report_not_found con reason explicando ambas opciones');
  });

  test('un posible error ortográfico nunca autoriza una modificación', () => {
    expect(SYSTEM_RULES).toContain('Errores ortográficos — NO modificar automáticamente');
    expect(SYSTEM_RULES).toContain('NO hacer matching difuso');
    expect(SYSTEM_RULES).toContain('No modificar nada hasta que el usuario escriba un nombre inequívoco');
    expect(SYSTEM_RULES).not.toContain('variantes con tildes/typos leves');
  });

  test('una ficha diferente no sobrescribe datos existentes sin una orden explícita', () => {
    expect(SYSTEM_RULES).toContain('NO autoriza por sí sola a sobrescribir datos');
    expect(SYSTEM_RULES).toContain('indicá qué campos difieren');
    expect(SYSTEM_RULES).toContain('No llames update_client_data en ese caso');
    expect(SYSTEM_RULES).not.toContain('esos son datos a actualizar, no razón para crear duplicado');
  });

  test('una ficha nueva puede crear y agendar el pedido completo en una operación', () => {
    const createTool = TOOLS.find((tool: any) => tool.name === 'create_new_client');

    expect(createTool.description).toContain('crear al cliente YA AGENDADO con todo el pedido');
    expect(SYSTEM_RULES).toContain('extraer TODO en la misma llamada a create_new_client');
    expect(SYSTEM_RULES).toContain("products={b20:2}, freq='weekly', visitDay='Martes'");
    expect(SYSTEM_RULES).toContain("products={b20:2}, freq='once'");
    expect(SYSTEM_RULES).toContain('NO uses schedule_existing_client para una ficha nueva');
  });

  test('agendar a un cliente activo exige aclarar si mueve o agrega', () => {
    const scheduleTool = TOOLS.find((tool: any) => tool.name === 'schedule_existing_client');

    expect(scheduleTool.description).toContain('preguntar si quiere mover el actual o agregar otro');
    expect(SYSTEM_RULES).toContain('Nunca supongas replace ni add');
    expect(SYSTEM_RULES).toContain('preguntando si quiere mover el pedido actual o agregar uno nuevo');
    expect(SYSTEM_RULES).not.toContain("schedule_mode: 'replace' por default");
  });

  test('extrae y parsea una única function call', () => {
    expect(extractToolUse({
      output: [{
        type: 'function_call',
        name: 'add_standalone_note',
        arguments: JSON.stringify({ notes: 'Llamar al proveedor', specificDate: '2026-07-20' }),
      }],
    })).toEqual({
      name: 'add_standalone_note',
      input: { notes: 'Llamar al proveedor', specificDate: '2026-07-20' },
    });
  });

  test('suma el uso cuando una ficha necesita reintento', () => {
    expect(sumUsage(
      { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      { input_tokens: 80, output_tokens: 10, total_tokens: 90 },
    )).toEqual({ input_tokens: 180, output_tokens: 30, total_tokens: 210 });
  });
});
