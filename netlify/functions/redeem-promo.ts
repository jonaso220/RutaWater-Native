import type { Config } from '@netlify/functions';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import { EnvironmentReader, getPromoFirestore } from './_shared/firebaseAdmin';
import { createPromoCodeDigest, isPromoCodeShapeValid } from './_shared/promoCode';
import { PromoRedeemStatus, redeemPromo } from './_shared/promoService';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });

const bearerToken = (request: Request): string => {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1] || '';
};

interface RedeemPromoHandlerDependencies {
  readEnvironment: EnvironmentReader;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  redeem: (input: {
    db: Firestore;
    uid: string;
    promoDigest: string;
  }) => Promise<PromoRedeemStatus>;
}

export const createRedeemPromoHandler = (dependencies: RedeemPromoHandlerDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json(405, { error: 'Method Not Allowed' });
    }

    let authPayload: { sub: string };
    try {
      authPayload = await dependencies.verifyToken(bearerToken(request));
    } catch {
      return json(401, { error: 'No autorizado.' });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'Body inválido.' });
    }

    const code = typeof body === 'object' && body !== null && 'code' in body
      ? (body as { code?: unknown }).code
      : undefined;
    if (typeof code !== 'string' || !isPromoCodeShapeValid(code)) {
      return json(200, { success: false, status: 'invalid' });
    }

    try {
      const pepper = dependencies.readEnvironment('PROMO_CODE_PEPPER') || '';
      const promoDigest = createPromoCodeDigest(code, pepper);
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      const status = await dependencies.redeem({
        db,
        uid: authPayload.sub,
        promoDigest,
      });
      return json(200, { success: status !== 'invalid', status });
    } catch (error) {
      // Nunca registrar el body ni el código. El mensaje solo sirve para
      // diagnosticar configuración/Firestore en los logs privados de Netlify.
      console.error('redeem-promo error:', error instanceof Error ? error.message : 'unknown');
      return json(500, { error: 'No se pudo procesar el canje.' });
    }
  };

const productionHandler = createRedeemPromoHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getFirestore: getPromoFirestore,
  redeem: redeemPromo,
});

export default productionHandler;

export const config: Config = {
  path: '/api/redeem-promo',
};
