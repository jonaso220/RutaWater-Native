const {
  parseOrder: parseWithAnthropic,
  MODEL: ANTHROPIC_MODEL,
} = require('./anthropic');
const {
  parseOrder: parseWithOpenAI,
  MODEL: OPENAI_MODEL,
} = require('./openai');
const {
  AiProductValidationError,
  invalidProductToolUse,
  normalizeLocale,
  normalizeProductCatalog,
  normalizeToolUse,
} = require('./aiProductCatalog');

const hasOpenAI = () => Boolean(process.env.OPENAI_API_KEY);
const hasAnthropic = () => Boolean(process.env.ANTHROPIC_API_KEY);

function errorSummary(error) {
  return {
    name: error?.name || 'Error',
    status: error?.status,
    code: error?.code,
    message: error?.message || String(error),
  };
}

function getModel() {
  return hasOpenAI() ? OPENAI_MODEL : ANTHROPIC_MODEL;
}

async function parseOrder(args) {
  // Build an immutable request-scoped catalog. Never mutate the provider
  // globals: a warm Netlify process can parse different accounts concurrently.
  const productCatalog = normalizeProductCatalog(args.productCatalog);
  const locale = normalizeLocale(args.locale);
  let previousResult;
  if (args.previousResult) {
    const normalizedPrevious = normalizeToolUse(
      { name: args.previousResult.tool, input: args.previousResult.input },
      productCatalog,
      args.clients,
    );
    previousResult = {
      tool: normalizedPrevious.name,
      input: normalizedPrevious.input,
    };
  }
  const providerArgs = {
    ...args,
    productCatalog,
    locale,
    ...(previousResult ? { previousResult } : {}),
  };
  let result;

  if (hasOpenAI()) {
    try {
      result = await parseWithOpenAI(providerArgs);
    } catch (error) {
      if (!hasAnthropic()) throw error;
      console.error('OpenAI parse failed; using Anthropic fallback:', errorSummary(error));
    }
  }

  if (!result && !hasAnthropic()) {
    throw new Error('Falta configurar OPENAI_API_KEY o ANTHROPIC_API_KEY');
  }

  if (!result) {
    result = await parseWithAnthropic(providerArgs);
    result = {
      ...result,
      provider: 'anthropic',
      model: ANTHROPIC_MODEL,
    };
  }

  // One strict normalizer protects both providers and both retry paths. A
  // mixed valid/invalid response becomes a complete no-action, never a subset.
  try {
    const normalized = normalizeToolUse(
      { name: result.tool, input: result.input },
      productCatalog,
      args.clients,
    );
    return { ...result, tool: normalized.name, input: normalized.input };
  } catch (error) {
    if (!(error instanceof AiProductValidationError)) throw error;
    const noAction = invalidProductToolUse(locale);
    return { ...result, tool: noAction.name, input: noAction.input };
  }
}

module.exports = {
  parseOrder,
  getModel,
  OPENAI_MODEL,
  ANTHROPIC_MODEL,
  errorSummary,
};
