const OpenAI = require('openai');
const { repairOrRetryDecision } = require('./orderHeuristics');
const {
  TOOLS,
  SYSTEM_RULES,
  buildClientsBlock,
} = require('./anthropic');
const {
  LEGACY_PRODUCT_CATALOG,
  buildProductAwareSystemRules,
  buildProductAwareTools,
} = require('./aiProductCatalog');
const { buildOrderUserMessage } = require('./orderCorrection');

const MODEL = 'gpt-5.6-luna';
// Strict product maps require every catalog ID (with 0 for unused entries).
// Keep enough room for the maximum 64-product schedule, its three maps and
// low-effort reasoning. The model supports a much larger ceiling; usage is
// billed on generated tokens, not on this configured maximum.
const MAX_OUTPUT_TOKENS = 32768;

const createClient = () => new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// OpenAI strict mode exige additionalProperties=false en todos los objetos y
// que cada propiedad sea required. Las tools existentes ya requieren todos los
// campos de primer nivel; solo los mapas dinámicos de productos necesitan una
// representación cerrada. El normalizador compartido quita luego los ceros
// para conservar el contrato actual de la app ({} significa "sin cambios").
function toStrictSchema(inputSchema) {
  return {
    ...inputSchema,
    properties: { ...(inputSchema.properties || {}) },
    required: Object.keys(inputSchema.properties || {}),
    additionalProperties: false,
  };
}

function toOpenAITools(tools = TOOLS, catalog = LEGACY_PRODUCT_CATALOG) {
  const requestTools = buildProductAwareTools(tools, catalog, { strict: true });
  return requestTools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: toStrictSchema(tool.input_schema),
    strict: true,
  }));
}

function extractToolUse(response) {
  const call = response?.output?.find((item) => item.type === 'function_call');
  if (!call) throw new Error('Modelo no devolvió function_call');

  let input;
  try {
    input = JSON.parse(call.arguments || '{}');
  } catch {
    throw new Error('Modelo devolvió argumentos inválidos');
  }

  return {
    name: call.name,
    input,
  };
}

function sumUsage(first, second) {
  if (!second) return first || null;
  return {
    input_tokens: (first?.input_tokens || 0) + (second?.input_tokens || 0),
    output_tokens: (first?.output_tokens || 0) + (second?.output_tokens || 0),
    total_tokens: (first?.total_tokens || 0) + (second?.total_tokens || 0),
  };
}

async function parseOrder({
  text,
  clients,
  todayIso,
  safetyIdentifier,
  productCatalog = LEGACY_PRODUCT_CATALOG,
  locale = 'es',
  correction,
  previousResult,
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Falta OPENAI_API_KEY');
  }

  const openai = createClient();
  const requestSystemRules = buildProductAwareSystemRules(SYSTEM_RULES, productCatalog, locale);
  const tools = toOpenAITools(TOOLS, productCatalog);
  const request = {
    model: MODEL,
    instructions: `${requestSystemRules}\n\n${buildClientsBlock(clients)}`,
    input: buildOrderUserMessage({ text, todayIso, correction, previousResult }),
    tools,
    tool_choice: 'required',
    parallel_tool_calls: false,
    reasoning: { effort: 'low' },
    // En Responses, este límite también incluye tokens de razonamiento. Dejamos
    // margen para fichas completas sin que el máximo incremente el costo real.
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
  };
  if (safetyIdentifier) request.safety_identifier = safetyIdentifier;

  const response = await openai.responses.create(request);
  let toolUse = extractToolUse(response);

  // Conserva las mismas defensas determinísticas que ya protegen el flujo de
  // Anthropic: reparar IDs inventados y recuperar fichas completas nuevas.
  const decision = repairOrRetryDecision(toolUse, text, clients);
  toolUse = decision.toolUse;
  let usage = response.usage;

  if (decision.retryAsCreate) {
    const retry = await openai.responses.create({
      ...request,
      tool_choice: { type: 'function', name: 'create_new_client' },
    });
    const createTool = extractToolUse(retry);
    if (createTool.name !== 'create_new_client') {
      throw new Error('Modelo no pudo convertir la ficha en cliente nuevo');
    }
    toolUse = createTool;
    usage = sumUsage(response.usage, retry.usage);
  }

  return {
    tool: toolUse.name,
    input: toolUse.input,
    usage,
    provider: 'openai',
    model: MODEL,
  };
}

module.exports = {
  parseOrder,
  MODEL,
  MAX_OUTPUT_TOKENS,
  toStrictSchema,
  toOpenAITools,
  extractToolUse,
  sumUsage,
};
