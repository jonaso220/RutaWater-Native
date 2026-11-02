import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WriteError } from './writes';

// Contactos del Mac (iCloud, los mismos del iPhone y de WhatsApp). Jonathan,
// 24/10/2026: cada cliente queda como «Nombre - Dirección -» con el link de
// Maps al final (en el apellido, como los que ya tenía), con mayúscula inicial.
// Si ya hay un contacto con ese teléfono se le cambia el nombre; si no, se crea.

// Lo hace «RutaWater Contactos.app» (scripts/guardar-contacto.js), que tiene el
// permiso de Contactos: en node se pierde con cada actualización de Homebrew.

const dir = () => (process.env.RUTAWATER_CONTACTOS_DIR || '').trim() || join(homedir(), '.rutawater-mcp/guardar-contacto');
const WAIT_MS = 60_000;
const STALE_LOCK_MS = 2 * 60_000;

const openApp = (app: string) => new Promise<void>((resolve, reject) => {
  execFile('/usr/bin/open', ['-W', '-a', app], { timeout: WAIT_MS }, (error) => (error ? reject(error) : resolve()));
});
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Un contacto por vez: el vigilante y la app de Claude comparten el pedido y el resultado. */
const lock = async (path: string) => {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) rmSync(path, { recursive: true, force: true });
      else if (Date.now() > deadline) throw new Error('hay otro contacto guardándose');
      else await pause(500);
    }
  }
};

/** Le pasa el pedido a la app y devuelve lo que dejó en resultado.json. */
const askApp = async (request: { first: string; last: string; phone: string }, open: (app: string) => Promise<void>) => {
  mkdirSync(dir(), { recursive: true });
  const busy = join(dir(), 'ocupado');
  await lock(busy);
  try {
    const app = join(dir(), 'RutaWater Contactos.app');
    const resultFile = join(dir(), 'resultado.json');
    rmSync(resultFile, { force: true });
    writeFileSync(join(dir(), 'pedido.json'), JSON.stringify(request));
    await open(app);
    if (!existsSync(resultFile)) throw new Error('la app no dejó resultado');
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    if (result.error) throw new Error(`${result.error}${result.numero ? ` (${result.numero})` : ''}`);
    return result as { actualizados: number; creado: boolean };
  } finally {
    rmSync(busy, { recursive: true, force: true });
  }
};

const digits = (value: string) => value.replace(/\D/g, '');

/** Teléfono uruguayo en formato internacional: 099 123 456 → +59899123456. */
export const uyPhone = (value: string): string => {
  const d = digits(value);
  if (d.startsWith('598') && d.length >= 11) return `+${d}`;
  if (d.startsWith('0') && d.length === 9) return `+598${d.slice(1)}`;
  if (d.length === 8 && d.startsWith('9')) return `+598${d}`;
  throw new WriteError(`Teléfono inválido: ${value}. Usá 099123456 o +59899123456.`);
};

export const contactName = (name: string, address: string, mapsLink: string) => {
  const parts = [name.trim(), address.trim()].filter(Boolean);
  const link = mapsLink.trim();
  return { first: parts.join(' - ') + (link ? ' -' : ''), last: link };
};

export const saveContact = async (
  input: { nombre: string; direccion?: string; link_maps?: string; telefono: string }, open = openApp,
) => {
  const phone = uyPhone(input.telefono);
  const { first, last } = contactName(input.nombre, input.direccion || '', input.link_maps || '');
  if (!input.nombre.trim()) throw new WriteError('Falta el nombre.');
  try {
    return { contacto: `${first} ${last}`.trim(), telefono: phone, ...(await askApp({ first, last, phone }, open)) };
  } catch (error) {
    throw new WriteError(`No se pudo guardar el contacto: ${(error as Error).message}. Puede faltar el permiso de Contactos en el Mac (o quedó esperando que lo acepten): el cliente en RutaWater no se toca; anotarlo en state/contactos-pendientes.jsonl para guardarlo después.`);
  }
};
