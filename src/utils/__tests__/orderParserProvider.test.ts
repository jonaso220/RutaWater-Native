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
});
