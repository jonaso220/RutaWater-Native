import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Client } from '../../src/types';
import { exceptionFor, NoticeException, NoticeKind, NoticeRules, Progress } from './noticeList';

// Archivos de la skill de avisos que usa la lista: las excepciones (datos) y
// el registro de lo que ya salió para cada fecha de reparto.

export const noticeDir = (): string => process.env.RUTAWATER_AVISOS_DIR
  || path.join(os.homedir(), '.codex', 'skills', 'next-day-delivery-preparation');
export const noticeRulesPath = (): string => path.join(noticeDir(), 'avisos-excepciones.json');

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

export const readNoticeRules = (): NoticeRules => {
  const rules = readJson<NoticeRules | null>(noticeRulesPath(), null);
  if (!rules || !Array.isArray(rules.excepciones)) throw new Error(`No pude leer las excepciones de avisos (${noticeRulesPath()}).`);
  return rules;
};

export const readProgress = (isoDate: string, kind: NoticeKind): Progress =>
  readJson<{ clients?: Progress }>(path.join(noticeDir(), 'state', kind === 'aviso' ? '' : 'second-pass', `${isoDate}.json`), {}).clients || {};

const normalize = (value: unknown): string => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface NoticeChange {
  aviso?: boolean;
  recordatorio?: boolean;
  /** Texto en lugar de «por tu casa»; '' vuelve al texto común. */
  texto_por_tu_casa?: string;
  motivo?: string;
}

const describe = (exception: NoticeException | null) => ({
  aviso: exception ? exception.aviso : true,
  recordatorio: exception ? exception.recordatorio : true,
  texto: exception?.reemplazo_por_tu_casa || 'por tu casa',
});

const isDefault = (exception: NoticeException): boolean => exception.aviso && exception.recordatorio
  && !exception.reemplazo_por_tu_casa && !exception.destinatarios && !exception.texto_propio && !exception.si_no_contesta;

/** Cambia qué recibe un cliente (aviso, recordatorio, texto). Vale para todas sus fichas. */
export const setNoticeException = (client: Client, clients: Client[], change: NoticeChange, today: string) => {
  const file = noticeRulesPath();
  const rules = readNoticeRules() as NoticeRules & Record<string, unknown>;
  const current = exceptionFor(client, clients, rules);
  const before = describe(current);
  const person = client.customerId || client.id;
  const same = clients.filter((candidate) => !candidate.isNote && ((candidate.customerId || candidate.id) === person
    || (normalize(candidate.name) === normalize(client.name) && normalize(candidate.address) === normalize(client.address))));
  const target: NoticeException = current || {
    clave: `${normalize(client.name).replace(/ /g, '-').slice(0, 30)}-${client.id.slice(0, 4).toLowerCase()}`,
    nombre: client.name, direccion: client.address, fichas: [], aviso: true, recordatorio: true,
  };
  target.fichas = [...new Set([...target.fichas, ...same.map((candidate) => candidate.id), client.id])];
  if (change.aviso !== undefined) target.aviso = change.aviso;
  if (change.recordatorio !== undefined) target.recordatorio = change.recordatorio;
  // Sin aviso de la mañana no hay recordatorio.
  if (!target.aviso) target.recordatorio = false;
  if (change.texto_por_tu_casa !== undefined) {
    const text = change.texto_por_tu_casa.trim();
    if (text) target.reemplazo_por_tu_casa = text;
    else delete target.reemplazo_por_tu_casa;
  }
  const after = describe(target);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) {
    const note = `${change.motivo ? `${change.motivo.trim()} ` : ''}(Jonathan, ${today})`;
    target.motivo = target.motivo && current ? `${target.motivo}; ${note}` : note;
    const others = rules.excepciones.filter((exception) => exception !== current);
    rules.excepciones = isDefault(target) ? others : [...others, target];
    rules.actualizado = today;
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.anterior`);
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(rules, null, 1)}\n`);
    fs.renameSync(`${file}.tmp`, file);
  }
  return { cambiado: changed, antes: before, despues: after, fichas: target.fichas.length };
};
