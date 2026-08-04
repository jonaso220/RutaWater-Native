import { App, cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

const APP_NAME = 'rutawater-promo-netlify';

export type EnvironmentReader = (name: string) => string | undefined;

interface ParsedServiceAccount {
  credential: ServiceAccount;
  projectId: string;
}

const parseServiceAccount = (encoded: string): ParsedServiceAccount => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 no es un JSON base64 válido.');
  }

  if (
    typeof parsed.project_id !== 'string'
    || typeof parsed.client_email !== 'string'
    || typeof parsed.private_key !== 'string'
  ) {
    throw new Error('La cuenta de servicio Firebase está incompleta.');
  }

  return {
    projectId: parsed.project_id,
    credential: {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    },
  };
};

const findPromoApp = (): App | undefined => getApps().find((app) => app.name === APP_NAME);

const getAdminApp = (readEnvironment: EnvironmentReader): App => {
  const existing = findPromoApp();
  if (existing) return existing;

  const projectId = readEnvironment('FIREBASE_PROJECT_ID') || 'rutawater';
  const encodedAccount = readEnvironment('FIREBASE_SERVICE_ACCOUNT_BASE64');
  if (!encodedAccount) {
    throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_BASE64.');
  }

  const serviceAccount = parseServiceAccount(encodedAccount);
  if (serviceAccount.projectId !== projectId) {
    throw new Error('La cuenta de servicio no pertenece al proyecto Firebase configurado.');
  }

  return initializeApp(
    {
      credential: cert(serviceAccount.credential),
      projectId,
    },
    APP_NAME,
  );
};

export const getAdminFirestore = (readEnvironment: EnvironmentReader): Firestore =>
  getFirestore(getAdminApp(readEnvironment));

export const getAdminAuth = (readEnvironment: EnvironmentReader): Auth => {
  // Keep firebase-admin/auth out of the module's eager dependency graph. Its
  // ESM-only transitive dependencies otherwise make Firestore-only handlers
  // fail during Jest module loading, even when Auth is never used.
  const { getAuth } = require('firebase-admin/auth') as typeof import('firebase-admin/auth');
  return getAuth(getAdminApp(readEnvironment));
};

// Backwards-compatible name used by the promo endpoint.
export const getPromoFirestore = getAdminFirestore;
