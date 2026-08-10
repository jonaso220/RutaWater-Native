import {
  AiProductCatalogItem,
  AiProductError,
  applyAiProductChange,
  buildAiClientPayload,
  buildAiProductCatalog,
  fingerprintClientState,
  fingerprintCatalog,
  getAiLocale,
  validateAiProductResult,
} from '../aiProducts';
import { Client } from '../../types';
import { Product } from '../../constants/products';

const products: Product[] = [
  { id: 'b20', label: 'Familiar renombrado', short: 'Fam', icon: 'water', emoji: '💧' },
  { id: 'custom_ret', label: 'Retornable grande', short: 'RetG', icon: 'cube', emoji: '🧊' },
  { id: 'old_hidden', label: 'Producto anterior', short: 'Old', icon: 'cube', emoji: '📦' },
];

const catalog: AiProductCatalogItem[] = buildAiProductCatalog(products, ['old_hidden']);

const client = {
  id: 'client-1',
  name: 'Ana',
  address: 'Calle 1',
  phone: '099111222',
  mapsLink: 'https://maps.example/a',
  freq: 'weekly',
  visitDay: 'Lunes',
  specificDate: '',
  products: { b20: 2, old_hidden: 1, orphan_legacy: 4 },
  notes: 'Llamar antes',
} as unknown as Client;

const aiClients = buildAiClientPayload([client]);

const merge = (overrides: Record<string, unknown> = {}) => ({
  tool: 'merge_products_into_order',
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

const schedule = (overrides: Record<string, unknown> = {}) => ({
  tool: 'schedule_existing_client',
  input: {
    matched_client_id: 'client-1',
    matched_client_name: 'Ana',
    products: {},
    add_products: {},
    remove_products: {},
    freq: 'once',
    visitDay: '',
    specificDate: '2026-08-12',
    schedule_mode: 'replace',
    notes: '',
    notes_mode: 'keep',
    ...overrides,
  },
});

describe('productos de Pedido IA en la app', () => {
  test('sends current renamed/custom/hidden catalog and maps supported locales', () => {
    expect(catalog).toEqual([
      { id: 'b20', label: 'Familiar renombrado', short: 'Fam', hidden: false },
      { id: 'custom_ret', label: 'Retornable grande', short: 'RetG', hidden: false },
      { id: 'old_hidden', label: 'Producto anterior', short: 'Old', hidden: true },
    ]);
    expect(getAiLocale('en-US')).toBe('en');
    expect(getAiLocale('pt_BR')).toBe('pt');
    expect(getAiLocale('fr')).toBe('es');
    expect(fingerprintCatalog(catalog)).not.toBe(fingerprintCatalog([
      ...catalog.slice(0, 2),
      { ...catalog[2], hidden: false },
    ]));
    expect(fingerprintCatalog(catalog)).not.toBe(fingerprintCatalog([
      { ...catalog[0], label: 'Otro nombre' },
      ...catalog.slice(1),
    ]));
  });

  test('allows visible custom additions and present hidden removals', () => {
    expect(validateAiProductResult(
      merge({ add_products: { custom_ret: 2 }, remove_products: { old_hidden: 1 } }),
      catalog,
      aiClients,
    ).input).toMatchObject({
      add_products: { custom_ret: 2 },
      remove_products: { old_hidden: 1 },
    });
  });

  test.each([
    merge({ add_products: { old_hidden: 1 } }),
    merge({ add_products: { custom_ret: 1, invented: 3 } }),
    merge({ add_products: { custom_ret: 1.5 } }),
    schedule({ products: { b20: 1 }, add_products: { custom_ret: 1 } }),
    merge({ remove_products: { custom_ret: 1 } }),
  ])('rejects the complete operation instead of applying a valid subset', (result) => {
    expect(() => validateAiProductResult(result, catalog, aiClients)).toThrow(AiProductError);
  });

  test('preserves hidden and orphaned historical values on an absolute replacement', () => {
    const change = applyAiProductChange(
      client.products,
      { products: { custom_ret: 3 } },
      catalog,
    );
    expect(change).toEqual({
      products: { custom_ret: 3, old_hidden: 1, orphan_legacy: 4 },
      changed: true,
      hadProductIntent: true,
    });
  });

  test('detects a true no-op and never manufactures a partial update', () => {
    expect(applyAiProductChange(
      client.products,
      { add_products: {}, remove_products: {} },
      catalog,
    )).toEqual({
      products: { b20: 2, old_hidden: 1, orphan_legacy: 4 },
      changed: false,
      hadProductIntent: false,
    });
  });

  test('blocks add mode for recurring schedules and directory-only clients', () => {
    expect(() => validateAiProductResult(
      schedule({ freq: 'weekly', specificDate: '', schedule_mode: 'add' }),
      catalog,
      aiClients,
    )).toThrow('AI_SCHEDULE_MODE_INVALID');

    const directoryClient = buildAiClientPayload([{ ...client, freq: 'on_demand' } as Client]);
    expect(() => validateAiProductResult(
      schedule({ schedule_mode: 'add' }),
      catalog,
      directoryClient,
    )).toThrow('AI_SCHEDULE_MODE_INVALID');
  });

  test('client fingerprint changes for remote phone, maps or product edits in the same scope', () => {
    const base = fingerprintClientState([client]);
    expect(fingerprintClientState([{ ...client, phone: '099999999' } as Client])).not.toBe(base);
    expect(fingerprintClientState([{ ...client, mapsLink: 'https://maps.example/b' } as Client])).not.toBe(base);
    expect(fingerprintClientState([{ ...client, products: { b20: 3 } } as Client])).not.toBe(base);
    expect(fingerprintClientState([{ ...client, isCompleted: true } as Client])).not.toBe(base);
  });

  test('never mutates a completed order returned by a stale or old backend', () => {
    const completed = buildAiClientPayload([{ ...client, isCompleted: true } as Client]);
    expect(() => validateAiProductResult(
      merge({ add_products: { custom_ret: 1 } }),
      catalog,
      completed,
    )).toThrow('AI_CLIENT_COMPLETED');
  });

  test('rejects a valid client id paired with another displayed name', () => {
    expect(() => validateAiProductResult(
      merge({ matched_client_name: 'Otra persona', add_products: { custom_ret: 1 } }),
      catalog,
      aiClients,
    )).toThrow('AI_PRODUCT_CLIENT_NAME_MISMATCH');
    expect(() => validateAiProductResult(
      merge({ matched_client_name: 'ÁNA', add_products: { custom_ret: 1 } }),
      catalog,
      aiClients,
    )).not.toThrow();
  });

  test.each(['on_demand', 'weekly'] as const)('rejects creating an existing client (%s)', (freq) => {
    const existing = buildAiClientPayload([{ ...client, freq } as Client]);
    expect(() => validateAiProductResult({
      tool: 'create_new_client',
      input: {
        name: 'ÁNA', phone: '', address: '', mapsLink: '', notes: '', products: {},
        freq: 'on_demand', visitDay: '', specificDate: '',
      },
    }, catalog, existing)).toThrow('AI_CLIENT_ALREADY_EXISTS');
  });
});
