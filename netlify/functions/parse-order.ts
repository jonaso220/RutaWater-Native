import type { Config } from '@netlify/functions';

const crypto = require('crypto');
const { parseOrder } = require('./_shared/orderParser');
const {
  AiProductValidationError,
  normalizeLocale,
  normalizeProductCatalog,
} = require('./_shared/aiProductCatalog');
const { normalizeCorrectionRequest } = require('./_shared/orderCorrection');
const { authenticateEvent } = require('./_shared/firebaseAuth');
const {
  AiAccountInactiveError,
  AiPlanUnavailableError,
  assertAiAccountActive,
  reserveAiUsage,
  resolveAiPlan,
} = require('./_shared/aiQuota');

const MAX_TEXT_LENGTH = 8000;
const MAX_CLIENTS = 1200;
// The largest current production-shaped payload remains below 200 KB. A
// 400 KB ceiling leaves ample growth room while keeping the request compatible
// with the smaller Anthropic fallback context before quota is used.
const MAX_BODY_BYTES = 400_000;

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

const readEnvironment = (name) => process.env[name];

export const createParseOrderHandler = (dependencies = {}) => {
  const environment = dependencies.readEnvironment || readEnvironment;
  const authenticate = dependencies.authenticate || authenticateEvent;
  const parse = dependencies.parse || parseOrder;
  const getFirestore = dependencies.getFirestore
    || (() => {
      // Carga diferida: los preflight, errores de validación y tests puros no
      // necesitan inicializar Firebase Admin ni su cadena de dependencias.
      const { getAdminFirestore } = require('./_shared/firebaseAdmin');
      return getAdminFirestore(environment);
    });
  const resolvePlan = dependencies.resolvePlan || resolveAiPlan;
  const assertAccountActive = dependencies.assertAccountActive || assertAiAccountActive;
  const reserveUsage = dependencies.reserveUsage || reserveAiUsage;
  const now = dependencies.now || (() => new Date());
  const fetchImpl = dependencies.fetchImpl || fetch;

  return async (event) => {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method Not Allowed' });
    }
    if (!environment('OPENAI_API_KEY') && !environment('ANTHROPIC_API_KEY')) {
      return json(500, { error: 'Servidor mal configurado: falta una API key de IA' });
    }

    // Auth SIEMPRE obligatoria: la condición vieja (env opcional || header
    // presente) dejaba pasar cualquier request SIN header, exponiendo las claves
    // del proveedor de IA a quien conociera la URL. La app manda el token de
    // Firebase desde la versión 1.36.
    let authPayload;
    try {
      authPayload = await authenticate(event);
    } catch (err) {
      return json(401, { error: 'No autorizado.' });
    }

    const rawBody = event.body || '';
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return json(413, { error: `El body supera el máximo de ${MAX_BODY_BYTES} bytes.` });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      return json(400, { error: 'Body inválido (no es JSON).' });
    }

    const { text, clients, todayIso } = payload;
    let productCatalog;
    let locale;
    let correctionRequest;
    try {
      productCatalog = normalizeProductCatalog(payload.catalog ?? payload.productCatalog);
      locale = normalizeLocale(payload.locale);
      correctionRequest = normalizeCorrectionRequest(payload.correction, payload.previousResult);
    } catch (error) {
      if (error instanceof AiProductValidationError) {
        return json(400, { code: error.code, error: 'Catálogo o idioma inválido.' });
      }
      return json(400, { error: error.message || 'Corrección inválida.' });
    }

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

    let db;
    let reservation;
    try {
      db = getFirestore();
      const requestNow = now();
      // Evita incluso la consulta externa a RevenueCat cuando una eliminación
      // ya comenzó. La reserva repite el chequeo dentro de su transacción para
      // cerrar la carrera entre esta lectura y el incremento del contador.
      await assertAccountActive({ db, uid: authPayload.sub });
      const plan = await resolvePlan({
        db,
        uid: authPayload.sub,
        readEnvironment: environment,
        fetchImpl,
        nowMillis: requestNow.getTime(),
      });
      reservation = await reserveUsage({
        db,
        uid: authPayload.sub,
        plan,
        now: requestNow,
      });
    } catch (err) {
      const inactive = err instanceof AiAccountInactiveError
        || err?.name === 'AiAccountInactiveError';
      if (inactive) {
        return json(401, {
          code: 'ACCOUNT_INACTIVE',
          error: 'La cuenta ya no está activa.',
        });
      }
      const unavailable = err instanceof AiPlanUnavailableError
        || err?.name === 'AiPlanUnavailableError';
      console.error('parse-order quota error:', err?.message || err);
      return json(503, {
        code: unavailable ? 'AI_PLAN_UNAVAILABLE' : 'AI_QUOTA_UNAVAILABLE',
        error: unavailable
          ? 'No se pudo verificar tu plan. Intentá de nuevo en unos minutos.'
          : 'No se pudo verificar el cupo de IA. Intentá de nuevo.',
      });
    }

    if (!reservation.allowed) {
      return json(429, {
        code: 'AI_LIMIT_REACHED',
        error: `Llegaste al límite de ${reservation.limit} interpretaciones de IA este mes.`,
        quota: reservation,
      });
    }

    try {
      // OpenAI recomienda un identificador estable pero no identificable por
      // usuario. Nunca enviamos el uid de Firebase en claro.
      const safetyIdentifier = `rutawater_${crypto
        .createHash('sha256')
        .update(authPayload.sub)
        .digest('hex')
        .slice(0, 32)}`;
      const result = await parse({
        text,
        clients,
        todayIso,
        safetyIdentifier,
        productCatalog,
        locale,
        ...(correctionRequest || {}),
      });
      return json(200, { ...result, quota: reservation });
    } catch (err) {
      console.error('parse-order error:', err);
      // La reserva representa un intento que ya fue enviado al proveedor. No
      // se devuelve ante 500: permitir fallos repetibles sin consumir cupo
      // habilitaría generar costo ilimitado de forma deliberada.
      return json(500, { error: err.message || 'Error interno' });
    }
  };
};

const productionLegacyHandler = createParseOrderHandler();

// Keep the proven quota/parser core above while exposing the web-standard
// Request/Response contract required by the modern Netlify Functions runtime.
// This removes the legacy Lambda environment-size limit without changing the
// mobile API response shape.
export const createModernParseOrderHandler = (legacyHandler = productionLegacyHandler) =>
  async (request: Request): Promise<Response> => {
    const legacyResponse = await legacyHandler({
      httpMethod: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.method === 'POST' ? await request.text() : '',
    });
    return new Response(
      legacyResponse.statusCode === 204 ? null : legacyResponse.body,
      {
        status: legacyResponse.statusCode,
        headers: legacyResponse.headers,
      },
    );
  };

export default createModernParseOrderHandler();

export const config: Config = {
  path: '/api/parse-order',
};
