import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import os from 'os';
import path from 'path';

const APP_NAME = 'rutawater-mcp';

export interface ServerConfig {
  uid: string;
  readOnly: boolean;
  auditPath: string;
  /** Tope de cargas completas por día de cuota (0 = sin tope). */
  dailyLoads: number;
  /** Tope de documentos leídos por hora en un mismo proceso (0 = sin tope). */
  hourlyDocs: number;
  loadsDir: string;
}

const env = (name: string): string => (process.env[name] || '').trim();

// Cada carga trae unos 200 documentos: 250 cargas son unas 50.000 lecturas, el
// límite gratis de Firestore por día (Jonathan lo subió de 60 el 20/10/2026, con
// el plan Blaze; lo que la app lea de más se cobra por centavos).
const DEFAULT_DAILY_LOADS = 250;
// Un proceso normal lee pocos miles por día; 10.000 en una hora es un bucle (22/10/2026).
const DEFAULT_HOURLY_DOCS = 10000;

/**
 * Credenciales, en este orden:
 * - FIRESTORE_EMULATOR_HOST: emulador local, sin credenciales (tests).
 * - FIREBASE_SERVICE_ACCOUNT_BASE64: mismo formato que las Netlify Functions.
 * - GOOGLE_APPLICATION_CREDENTIALS / ADC: archivo JSON de cuenta de servicio
 *   o `gcloud auth application-default login`.
 */
export const getDb = (): Firestore => {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return getFirestore(existing);
  const projectId = env('FIREBASE_PROJECT_ID') || 'rutawater';
  let app;
  if (env('FIRESTORE_EMULATOR_HOST')) {
    app = initializeApp({ projectId }, APP_NAME);
  } else if (env('FIREBASE_SERVICE_ACCOUNT_BASE64')) {
    const parsed = JSON.parse(Buffer.from(env('FIREBASE_SERVICE_ACCOUNT_BASE64'), 'base64').toString('utf8'));
    app = initializeApp({ projectId: parsed.project_id || projectId, credential: cert(parsed) }, APP_NAME);
  } else {
    app = initializeApp({ projectId, credential: applicationDefault() }, APP_NAME);
  }
  return getFirestore(app);
};

/** La cuenta de RutaWater por la que actúa el servidor: RUTAWATER_UID o RUTAWATER_EMAIL. */
export const loadConfig = async (): Promise<ServerConfig> => {
  let uid = env('RUTAWATER_UID');
  if (!uid && env('RUTAWATER_EMAIL')) {
    getDb();
    const app = getApps().find((candidate) => candidate.name === APP_NAME)!;
    uid = (await getAuth(app).getUserByEmail(env('RUTAWATER_EMAIL'))).uid;
  }
  if (!uid) throw new Error('Falta RUTAWATER_UID o RUTAWATER_EMAIL.');
  return {
    uid,
    readOnly: env('RUTAWATER_MCP_READONLY') === '1',
    auditPath: env('RUTAWATER_MCP_AUDIT') || path.join(os.homedir(), '.rutawater-mcp', 'audit.jsonl'),
    dailyLoads: env('RUTAWATER_MCP_CARGAS_DIARIAS') ? Number(env('RUTAWATER_MCP_CARGAS_DIARIAS')) : DEFAULT_DAILY_LOADS,
    hourlyDocs: env('RUTAWATER_MCP_LECTURAS_POR_HORA') ? Number(env('RUTAWATER_MCP_LECTURAS_POR_HORA')) : DEFAULT_HOURLY_DOCS,
    loadsDir: env('RUTAWATER_MCP_CARGAS_DIR') || path.join(os.homedir(), '.rutawater-mcp', 'cargas'),
  };
};
