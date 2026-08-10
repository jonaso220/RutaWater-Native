const mockOpenAIParse = jest.fn();
const mockAnthropicParse = jest.fn();

jest.mock('../../../netlify/functions/_shared/openai', () => ({
  MODEL: 'gpt-5.6-luna',
  parseOrder: (...args: any[]) => mockOpenAIParse(...args),
}));

jest.mock('../../../netlify/functions/_shared/anthropic', () => ({
  MODEL: 'claude-haiku-4-5-20251001',
  parseOrder: (...args: any[]) => mockAnthropicParse(...args),
}));

const { parseOrder, getModel } = require('../../../netlify/functions/_shared/orderParser');

describe('selección de proveedor para Pedido IA', () => {
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  afterAll(() => {
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;
  });

  test('usa OpenAI cuando ambas claves están disponibles', async () => {
    process.env.OPENAI_API_KEY = 'openai-test';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    mockOpenAIParse.mockResolvedValue({ tool: 'add_standalone_note', provider: 'openai' });

    await expect(parseOrder({ text: 'nota' })).resolves.toMatchObject({ provider: 'openai' });
    expect(getModel()).toBe('gpt-5.6-luna');
    expect(mockAnthropicParse).not.toHaveBeenCalled();
  });

  test('vuelve a Anthropic si OpenAI falla', async () => {
    process.env.OPENAI_API_KEY = 'openai-test';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    mockOpenAIParse.mockRejectedValue({ status: 429, code: 'rate_limit', message: 'limit' });
    mockAnthropicParse.mockResolvedValue({ tool: 'report_not_found', input: {} });

    await expect(parseOrder({ text: 'pedido' })).resolves.toMatchObject({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
  });

  test('falla claramente cuando no hay ninguna clave', async () => {
    await expect(parseOrder({ text: 'pedido' })).rejects.toThrow(
      'Falta configurar OPENAI_API_KEY o ANTHROPIC_API_KEY',
    );
  });

  test('normaliza un producto custom con el mismo contrato después de OpenAI', async () => {
    process.env.OPENAI_API_KEY = 'openai-test';
    const productCatalog = [
      { id: 'custom_ret', label: 'Retornable grande', short: 'RetG', hidden: false },
      { id: 'old_hidden', label: 'Anterior', short: 'Old', hidden: true },
    ];
    const clients = [{
      id: 'client-1', name: 'Ana', freq: 'weekly', products: { old_hidden: 1 }, isCompleted: false,
    }];
    mockOpenAIParse.mockResolvedValue({
      tool: 'merge_products_into_order',
      input: {
        matched_client_id: 'client-1', matched_client_name: 'Ana',
        add_products: { custom_ret: 2 }, remove_products: { old_hidden: 1 },
        notes: '', notes_mode: 'keep',
      },
      provider: 'openai',
    });

    await expect(parseOrder({
      text: 'sumá dos retornables y quitá el anterior', clients, productCatalog, locale: 'es',
    })).resolves.toMatchObject({
      tool: 'merge_products_into_order',
      input: { add_products: { custom_ret: 2 }, remove_products: { old_hidden: 1 } },
    });
    expect(mockOpenAIParse).toHaveBeenCalledWith(expect.objectContaining({ productCatalog, locale: 'es' }));
  });

  test('Anthropic also turns a mixed valid/unknown result into a complete localized no-action', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    const productCatalog = [{ id: 'custom_ret', label: 'Retornável', short: 'Ret', hidden: false }];
    const clients = [{ id: 'client-1', name: 'Ana', freq: 'weekly', products: {}, isCompleted: false }];
    mockAnthropicParse.mockResolvedValue({
      tool: 'merge_products_into_order',
      input: {
        matched_client_id: 'client-1', matched_client_name: 'Ana',
        add_products: { custom_ret: 1, invented: 2 }, remove_products: {},
        notes: '', notes_mode: 'keep',
      },
    });

    const result = await parseOrder({ text: 'pedido', clients, productCatalog, locale: 'pt' });
    expect(result.tool).toBe('report_no_action');
    expect(result.input.message).toContain('Nada foi alterado');
  });
});
