import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { whatsappUrl } from './whatsapp';
import { WriteError } from './writes';

// Mensajes que Jonathan pide fuera de las 24 h, por WhatsApp del Mac: gratis y
// con el texto tal cual (30/10/2026). Abre el chat con el borrador y
// «RutaWater Enviar.app» (scripts/enviar-whatsapp.applescript, con permiso de
// Accesibilidad) aprieta Enviar solo si el borrador es exactamente el mensaje.
// Después se confirma en whatsappInbox, donde el webhook guarda lo que sale de la app.

const dir = () => (process.env.RUTAWATER_ENVIAR_DIR || '').trim() || join(homedir(), '.rutawater-mcp/enviar-whatsapp');
const INBOX = 'whatsappInbox';
const CONFIRM_MS = 45_000;

/** No se pudo intentar (o falló antes de apretar Enviar): no salió nada, se puede usar la plantilla. */
export class MacUnavailable extends Error {}

const run = (file: string, args: string[], timeout: number) => new Promise<string>((resolve, reject) => {
  execFile(file, args, { timeout }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
});
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const last8 = (value: unknown) => String(value || '').replace(/\D/g, '').slice(-8);

const screenLocked = async () => /CGSSessionScreenIsLocked"\s*=\s*Yes/.test(await run('/usr/sbin/ioreg', ['-n', 'Root', '-d1'], 10_000));
const whatsappRunning = () => run('/usr/bin/pgrep', ['-x', 'WhatsApp'], 5_000).then(() => true, () => false);

/** Espera que el mensaje aparezca como enviado desde la app a ese teléfono. */
const confirmed = async (db: Firestore, phone: string, text: string, since: Date) => {
  const deadline = Date.now() + CONFIRM_MS;
  while (Date.now() < deadline) {
    await pause(3_000);
    const snap = await db.collection(INBOX).where('sentAt', '>=', since).get();
    const found = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as any).find((message) => message.direction === 'out'
      && last8(message.phone) === last8(phone) && String(message.text || '').trim() === text.trim());
    if (found) return found.id as string;
  }
  return null;
};

export const sendViaMac = async (db: Firestore, phone: string, text: string): Promise<{ id: string }> => {
  const app = join(dir(), 'RutaWater Enviar.app');
  if (process.platform !== 'darwin' || !existsSync(app)) throw new MacUnavailable('falta RutaWater Enviar.app en el Mac');
  if (await screenLocked()) throw new MacUnavailable('la pantalla del Mac está bloqueada');
  mkdirSync(dir(), { recursive: true });
  const resultFile = join(dir(), 'resultado.txt');
  writeFileSync(join(dir(), 'texto.txt'), text);
  rmSync(resultFile, { force: true });
  const since = new Date(Date.now() - 60_000);
  const wasRunning = await whatsappRunning();
  await run('/usr/bin/open', [whatsappUrl(phone, text)], 15_000).catch((error) => {
    throw new MacUnavailable(`no se pudo abrir WhatsApp (${error.message})`);
  });
  await pause(wasRunning ? 2_500 : 9_000);
  await run('/usr/bin/open', ['-W', '-a', app], 40_000).catch(() => { /* el resultado dice qué pasó */ });
  const outcome = existsSync(resultFile) ? readFileSync(resultFile, 'utf8').trim() : 'error: la app no dejó resultado';
  if (outcome !== 'enviado') {
    const permission = /-1719|-25211|assistive|asistencia|accesibilidad/i.test(outcome);
    throw new MacUnavailable(permission ? 'falta el permiso de Accesibilidad para RutaWater Enviar' : `no apretó Enviar (${outcome})`);
  }
  const id = await confirmed(db, phone, text, since);
  if (!id) {
    throw new WriteError('Apreté Enviar en WhatsApp del Mac pero no apareció enviado en 45 s: puede haber salido igual. Fijate en el chat antes de reintentar (no lo mando por plantilla para no duplicarlo).');
  }
  return { id };
};
