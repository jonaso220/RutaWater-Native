const { parseOrder } = require('./_shared/anthropic');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: 'Servidor mal configurado: falta ANTHROPIC_API_KEY' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Body inválido (no es JSON).' });
  }

  const { text, clients, todayIso } = payload;

  if (typeof text !== 'string' || !text.trim()) {
    return json(400, { error: 'Falta `text` (string no vacío).' });
  }
  if (!Array.isArray(clients)) {
    return json(400, { error: '`clients` debe ser un array.' });
  }
  if (!todayIso || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return json(400, { error: '`todayIso` debe ser YYYY-MM-DD.' });
  }

  try {
    const result = await parseOrder({ text, clients, todayIso });
    return json(200, result);
  } catch (err) {
    console.error('parse-order error:', err);
    return json(500, { error: err.message || 'Error interno' });
  }
};
