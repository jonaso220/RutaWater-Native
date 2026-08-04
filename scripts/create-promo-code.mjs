import crypto from 'crypto';
import { execFileSync } from 'node:child_process';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const keychainAccount = 'rutawater-admin';
const keychainServices = {
  serviceAccount: 'RutaWater Promo Service Account',
  pepper: 'RutaWater Promo Pepper',
};

const readKeychainSecret = service => {
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-a', keychainAccount, '-s', service, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return '';
  }
};

const argument = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : fallback;
};

const generateCode = () => {
  const bytes = crypto.randomBytes(16);
  let value = 'RW-';
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value;
};

const encodedAccount = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  || readKeychainSecret(keychainServices.serviceAccount);
const pepper = process.env.PROMO_CODE_PEPPER
  || readKeychainSecret(keychainServices.pepper);
if (!encodedAccount || pepper.length < 32) {
  throw new Error(
    'Configura FIREBASE_SERVICE_ACCOUNT_BASE64 y PROMO_CODE_PEPPER (>=32 caracteres), '
    + 'o guárdalos en el Llavero de RutaWater.',
  );
}

const serviceAccount = JSON.parse(Buffer.from(encodedAccount, 'base64').toString('utf8'));
const projectId = process.env.FIREBASE_PROJECT_ID || 'rutawater';
if (serviceAccount.project_id !== projectId) {
  throw new Error('La cuenta de servicio no coincide con FIREBASE_PROJECT_ID.');
}

if (process.argv.includes('--check-config')) {
  console.log('Configuración administrativa de promociones válida.');
  process.exit(0);
}

const maxUses = Number(argument('max-uses', '1'));
if (!Number.isInteger(maxUses) || maxUses < 1) {
  throw new Error('--max-uses debe ser un entero positivo.');
}

const label = argument('label', 'Promo');
const expirationRaw = argument('expires');
const expirationMillis = expirationRaw ? Date.parse(expirationRaw) : null;
if (expirationRaw && !Number.isFinite(expirationMillis)) {
  throw new Error('--expires debe ser una fecha ISO válida.');
}

const app = initializeApp({
  credential: cert({
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
  }),
  projectId,
});
const db = getFirestore(app);

let code = '';
let digest = '';
let promoRef;
for (let attempt = 0; attempt < 5; attempt += 1) {
  code = generateCode();
  digest = crypto.createHmac('sha256', pepper).update(code, 'utf8').digest('hex');
  promoRef = db.collection('promoCodes').doc(digest);
  if (!(await promoRef.get()).exists) break;
  promoRef = undefined;
}
if (!promoRef) throw new Error('No se pudo generar un identificador promocional único.');

const data = {
  active: true,
  type: 'lifetime',
  label,
  maxUses,
  usedCount: 0,
  createdAt: FieldValue.serverTimestamp(),
};
if (expirationMillis !== null) data.expiresAt = Timestamp.fromMillis(expirationMillis);

await promoRef.create(data);

console.log(`Código nuevo: ${code}`);
console.log(`Etiqueta: ${label}`);
console.log(`Usos máximos: ${maxUses}`);
console.log(`Vence: ${expirationRaw || 'sin vencimiento de canje'}`);
