const {
  LEGACY_PRODUCT_CATALOG,
  buildProductAwareSystemRules,
  buildProductAwareTools,
  normalizeLocale,
  normalizeProductCatalog,
  normalizeToolUse,
} = require('../_shared/aiProductCatalog');
const { SYSTEM_RULES, TOOLS, buildClientsBlock } = require('../_shared/anthropic');

const catalog = [
  { id: 'b20', label: 'Bidón familiar renombrado', short: 'Fam', hidden: false },
  { id: 'custom_ret', label: 'Retornable grande', short: 'RetG', hidden: false },
  { id: 'old_hidden', label: 'Producto anterior', short: 'Old', hidden: true },
];

const client = {
  id: 'client-1',
  name: 'Ana',
  freq: 'weekly',
  products: { b20: 2, old_hidden: 1 },
};

const merge = (overrides: Record<string, unknown> = {}) => ({
  name: 'merge_products_into_order',
  input: {
    matched_client_id: 'client-1',
    matched_client_name: 'Ana',
    add_products: {},
    remove_products: {},
    notes: '',
    notes_mode: 'keep',
    ...overrides,
  },
});

describe('catálogo dinámico de Pedido IA', () => {
  test('keeps the exact legacy catalog and Spanish fallback for old clients', () => {
    expect(normalizeProductCatalog(undefined)).toEqual(LEGACY_PRODUCT_CATALOG);
    expect(normalizeProductCatalog(undefined)).not.toBe(LEGACY_PRODUCT_CATALOG);
    expect(normalizeLocale(undefined)).toBe('es');
  });

  test('uses custom and renamed products while hidden IDs are remove-only', () => {
    const tools = buildProductAwareTools(TOOLS, catalog, { strict: true });
    const schedule = tools.find((tool: any) => tool.name === 'schedule_existing_client');
    expect(Object.keys(schedule.input_schema.properties.products.properties)).toEqual(['b20', 'custom_ret']);
    expect(Object.keys(schedule.input_schema.properties.add_products.properties)).toEqual(['b20', 'custom_ret']);
    expect(Object.keys(schedule.input_schema.properties.remove_products.properties)).toEqual(['b20', 'custom_ret', 'old_hidden']);
    expect(schedule.input_schema.properties.products.description).toContain('custom_ret');
    expect(schedule.input_schema.properties.products.description).not.toContain('b12');

    const prompt = buildProductAwareSystemRules(SYSTEM_RULES, catalog, 'pt');
    expect(prompt).toContain('Bidón familiar renombrado');
    expect(prompt).toContain('Retornable grande');
    expect(prompt).toContain('portugués');
    expect(prompt).toContain('galão de água 20 litros');
  });

  test('allows removing a known hidden product only when it is present', () => {
    expect(normalizeToolUse(
      merge({ remove_products: { old_hidden: 1 } }),
      catalog,
      [client],
    ).input.remove_products).toEqual({ old_hidden: 1 });

    expect(() => normalizeToolUse(
      merge({ remove_products: { custom_ret: 1 } }),
      catalog,
      [client],
    )).toThrow('AI_PRODUCT_REMOVE_NOT_PRESENT');
  });

  test('rejects hidden additions, mixed absolute/deltas, partial unknowns and invalid shapes', () => {
    expect(() => normalizeToolUse(
      merge({ add_products: { old_hidden: 1 } }), catalog, [client],
    )).toThrow('AI_PRODUCT_ID_NOT_ALLOWED');
    expect(() => normalizeToolUse({
      name: 'schedule_existing_client',
      input: {
        matched_client_id: 'client-1', matched_client_name: 'Ana',
        products: { b20: 1 }, add_products: { custom_ret: 1 }, remove_products: {},
        freq: 'weekly', visitDay: 'Lunes', specificDate: '', schedule_mode: 'replace',
        notes: '', notes_mode: 'keep',
      },
    }, catalog, [client])).toThrow('AI_PRODUCT_ABSOLUTE_DELTA_CONFLICT');
    expect(() => normalizeToolUse(
      merge({ add_products: { b20: 1, invented: 2 } }), catalog, [client],
    )).toThrow('AI_PRODUCT_ID_NOT_ALLOWED');
    expect(() => normalizeToolUse(
      merge({ add_products: { custom_ret: 1 }, notes_mode: 'invented' }), catalog, [client],
    )).toThrow('AI_TOOL_INPUT_INVALID');
  });

  test('only permits add mode for a dated one-time extra on an active client', () => {
    const schedule = (overrides: Record<string, unknown>, clients = [client]) => () => normalizeToolUse({
      name: 'schedule_existing_client',
      input: {
        matched_client_id: 'client-1', matched_client_name: 'Ana',
        products: {}, add_products: {}, remove_products: {},
        freq: 'once', visitDay: '', specificDate: '2026-08-12', schedule_mode: 'add',
        notes: '', notes_mode: 'keep',
        ...overrides,
      },
    }, catalog, clients);
    expect(schedule({})()).toMatchObject({ input: { schedule_mode: 'add' } });
    expect(schedule({ freq: 'weekly', specificDate: '' })).toThrow('AI_SCHEDULE_MODE_INVALID');
    expect(schedule({}, [{ ...client, freq: 'on_demand' }])).toThrow('AI_SCHEDULE_MODE_INVALID');
  });

  test('marks completed rows as non-mutable and rejects every existing-client write', () => {
    expect(buildClientsBlock([{ ...client, isCompleted: true }])).toContain(
      'pedido completado (historial; no se puede modificar con IA)',
    );
    expect(buildClientsBlock([{ ...client, isCompleted: true }])).not.toContain('pedido pendiente');
    expect(() => normalizeToolUse(
      merge({ add_products: { custom_ret: 1 } }),
      catalog,
      [{ ...client, isCompleted: true }],
    )).toThrow('AI_CLIENT_COMPLETED');
  });

  test.each([
    ['merge_products_into_order', merge({ matched_client_name: 'Otra persona' })],
    ['update_client_data', {
      name: 'update_client_data',
      input: {
        matched_client_id: 'client-1', matched_client_name: 'Otra persona',
        mapsLink: '', address: '', phone: '', notes: '', notes_mode: 'keep',
      },
    }],
    ['schedule_existing_client', {
      name: 'schedule_existing_client',
      input: {
        matched_client_id: 'client-1', matched_client_name: 'Otra persona',
        products: {}, add_products: {}, remove_products: {}, freq: 'once', visitDay: '',
        specificDate: '2026-08-12', schedule_mode: 'replace', notes: '', notes_mode: 'keep',
      },
    }],
  ])('rejects a valid id paired with another client name for %s', (_tool, toolUse) => {
    expect(() => normalizeToolUse(toolUse, catalog, [client])).toThrow(
      'AI_PRODUCT_CLIENT_NAME_MISMATCH',
    );
  });

  test.each(['on_demand', 'weekly'])('rejects creating an existing client (%s)', (freq) => {
    expect(() => normalizeToolUse({
      name: 'create_new_client',
      input: {
        name: 'ÁNA', phone: '', address: '', mapsLink: '', notes: '', products: {},
        freq: 'on_demand', visitDay: '', specificDate: '',
      },
    }, catalog, [{ ...client, freq }])).toThrow('AI_CLIENT_ALREADY_EXISTS');
  });

  test('builds concurrent request catalogs without mutating shared prompt or tools', async () => {
    const originalRules = SYSTEM_RULES;
    const originalTools = JSON.stringify(TOOLS);
    const catalogA = [{ id: 'only_a', label: 'Cuenta A', short: 'A', hidden: false }];
    const catalogB = [{ id: 'only_b', label: 'Cuenta B', short: 'B', hidden: false }];
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => ({
        prompt: buildProductAwareSystemRules(SYSTEM_RULES, catalogA, 'es'),
        tools: buildProductAwareTools(TOOLS, catalogA, { strict: true }),
      })),
      Promise.resolve().then(() => ({
        prompt: buildProductAwareSystemRules(SYSTEM_RULES, catalogB, 'en'),
        tools: buildProductAwareTools(TOOLS, catalogB, { strict: true }),
      })),
    ]);
    expect(a.prompt).toContain('only_a');
    expect(a.prompt).not.toContain('only_b');
    expect(b.prompt).toContain('only_b');
    expect(b.prompt).not.toContain('only_a');
    expect(Object.keys(a.tools[0].input_schema.properties.products.properties)).toEqual(['only_a']);
    expect(Object.keys(b.tools[0].input_schema.properties.products.properties)).toEqual(['only_b']);
    expect(SYSTEM_RULES).toBe(originalRules);
    expect(JSON.stringify(TOOLS)).toBe(originalTools);
  });
});
