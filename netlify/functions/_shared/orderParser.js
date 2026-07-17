const {
  parseOrder: parseWithAnthropic,
  MODEL: ANTHROPIC_MODEL,
} = require('./anthropic');
const {
  parseOrder: parseWithOpenAI,
  MODEL: OPENAI_MODEL,
} = require('./openai');

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
  if (hasOpenAI()) {
    try {
      return await parseWithOpenAI(args);
    } catch (error) {
      if (!hasAnthropic()) throw error;
      console.error('OpenAI parse failed; using Anthropic fallback:', errorSummary(error));
    }
  }

  if (!hasAnthropic()) {
    throw new Error('Falta configurar OPENAI_API_KEY o ANTHROPIC_API_KEY');
  }

  const result = await parseWithAnthropic(args);
  return {
    ...result,
    provider: 'anthropic',
    model: ANTHROPIC_MODEL,
  };
}

module.exports = {
  parseOrder,
  getModel,
  OPENAI_MODEL,
  ANTHROPIC_MODEL,
  errorSummary,
};
