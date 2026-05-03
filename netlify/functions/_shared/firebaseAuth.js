const crypto = require('crypto');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'rutawater';
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache = {
  expiresAt: 0,
  certs: null,
};

const base64UrlToBuffer = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
};

const decodeJwtPart = (value) => {
  const raw = base64UrlToBuffer(value).toString('utf8');
  return JSON.parse(raw);
};

const getCerts = async () => {
  const now = Date.now();
  if (certCache.certs && certCache.expiresAt > now) {
    return certCache.certs;
  }

  const response = await fetch(CERTS_URL);
  if (!response.ok) {
    throw new Error('No se pudieron cargar certificados de Firebase.');
  }

  const certs = await response.json();
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 60 * 60 * 1000;

  certCache = {
    certs,
    expiresAt: now + maxAgeMs,
  };
  return certs;
};

const verifyFirebaseIdToken = async (token) => {
  if (!token) {
    throw new Error('Falta token de autenticación.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Token inválido.');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Token Firebase inválido.');
  }

  const certs = await getCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Certificado Firebase no encontrado.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const signature = base64UrlToBuffer(encodedSignature);
  const isValidSignature = verifier.verify(cert, signature);
  if (!isValidSignature) {
    throw new Error('Firma Firebase inválida.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuer = `https://securetoken.google.com/${PROJECT_ID}`;

  if (payload.aud !== PROJECT_ID) {
    throw new Error('Audiencia Firebase inválida.');
  }
  if (payload.iss !== issuer) {
    throw new Error('Issuer Firebase inválido.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new Error('Usuario Firebase inválido.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    throw new Error('Token Firebase expirado.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 300) {
    throw new Error('Token Firebase inválido.');
  }

  return payload;
};

const getBearerToken = (headers = {}) => {
  const authHeader = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match ? match[1] : '';
};

const authenticateEvent = async (event) => {
  const token = getBearerToken(event.headers || {});
  return verifyFirebaseIdToken(token);
};

module.exports = { authenticateEvent, verifyFirebaseIdToken };
