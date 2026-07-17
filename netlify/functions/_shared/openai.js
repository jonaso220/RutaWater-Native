const OpenAI = require('openai');
const { repairOrRetryDecision } = require('./orderHeuristics');
const {
  PRODUCT_IDS,
  TOOLS,
  SYSTEM_RULES,
  buildClientsBlock,
  buildTodayBlock,
} = require('./anthropic');

const MODEL = 'gpt-5.6-luna';
const PRODUCT_FIELDS = new Set(['products', 'add_products', 'remove_products']);

const createClient = () => new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const productSchema = () => ({
  type: 'object',
  properties: Object.fromEntries(
    PRODUCT_IDS.map((id) => [id, {
      type: 'number',
      description: 'Cantidad entera. Usar 0 cuando este producto no aplica.',
    }]),
  ),
  required: [...PRODUCT_IDS],
  additionalProperties: false,
});

// OpenAI strict mode exige additionalProperties=false en todos los objetos y
// que cada propiedad sea required. Las tools existentes ya requieren todos los
// campos de primer nivel; solo los mapas dinámicos de productos necesitan una
// representación cerrada. Al devolver el resultado quitamos los ceros para
// conservar el contrato actual de la app ({} significa "sin cambios").
function toStrictSchema(inputSchema) {
  const properties = {};
  for (const [key, schema] of Object.entries(inputSchema.properties || {})) {
    properties[key] = PRODUCT_FIELDS.has(key)
      ? { ...productSchema(), description: schema.description }
      : schema;
  }
  return {
    ...inputSchema,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function toOpenAITools(tools = TOOLS) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: toStrictSchema(tool.input_schema),
    strict: true,
  }));
}

function cleanProductMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const id of PRODUCT_IDS) {
    const amount = Math.round(Number(value[id]));
    if (Number.isFinite(amount) && amount > 0 && amount <= 9999) {
      result[id] = amount;
    }
  }
  return result;
}

function normalizeToolInput(input) {
  const normalized = { ...(input || {}) };
  for (const field of PRODUCT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = cleanProductMap(normalized[field]);
    }
  }
  return normalized;
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
    input: normalizeToolInput(input),
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

async function parseOrder({ text, clients, todayIso, safetyIdentifier }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Falta OPENAI_API_KEY');
  }

  const openai = createClient();
  const tools = toOpenAITools();
  const request = {
    model: MODEL,
    instructions: `${SYSTEM_RULES}\n\n${buildClientsBlock(clients)}`,
    input: `${buildTodayBlock(todayIso)}\n\nTEXTO A PARSEAR:\n\"\"\"\n${text}\n\"\"\"`,
    tools,
    tool_choice: 'required',
    parallel_tool_calls: false,
    reasoning: { effort: 'low' },
    // En Responses, este límite también incluye tokens de razonamiento. Dejamos
    // margen para fichas completas sin que el máximo incremente el costo real.
    max_output_tokens: 2048,
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
    input: normalizeToolInput(toolUse.input),
    usage,
    provider: 'openai',
    model: MODEL,
  };
}

module.exports = {
  parseOrder,
  MODEL,
  toStrictSchema,
  toOpenAITools,
  normalizeToolInput,
  extractToolUse,
  sumUsage,
};
