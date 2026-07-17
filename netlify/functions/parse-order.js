const crypto = require('crypto');
const { parseOrder } = require('./_shared/orderParser');
const { authenticateEvent } = require('./_shared/firebaseAuth');

const MAX_TEXT_LENGTH = 8000;
const MAX_CLIENTS = 1200;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: 'Servidor mal configurado: falta una API key de IA' });
  }

  // Auth SIEMPRE obligatoria: la condición vieja (env opcional || header
  // presente) dejaba pasar cualquier request SIN header, exponiendo las claves
  // del proveedor de IA a quien conociera la URL. La app manda el token de
  // Firebase desde la versión 1.36.
  let authPayload;
  try {
    authPayload = await authenticateEvent(event);
  } catch (err) {
    return json(401, { error: 'No autorizado.' });
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
  if (text.length > MAX_TEXT_LENGTH) {
    return json(413, { error: `El texto supera el máximo de ${MAX_TEXT_LENGTH} caracteres.` });
  }
  if (!Array.isArray(clients)) {
    return json(400, { error: '`clients` debe ser un array.' });
  }
  if (clients.length > MAX_CLIENTS) {
    return json(413, { error: `La lista de clientes supera el máximo de ${MAX_CLIENTS}.` });
  }
  if (!todayIso || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return json(400, { error: '`todayIso` debe ser YYYY-MM-DD.' });
  }

  try {
    // OpenAI recomienda un identificador estable pero no identificable por
    // usuario. Nunca enviamos el uid de Firebase en claro.
    const safetyIdentifier = `rutawater_${crypto
      .createHash('sha256')
      .update(authPayload.sub)
      .digest('hex')
      .slice(0, 32)}`;
    const result = await parseOrder({ text, clients, todayIso, safetyIdentifier });
    return json(200, result);
  } catch (err) {
    console.error('parse-order error:', err);
    return json(500, { error: err.message || 'Error interno' });
  }
};
