// Arma la lista de avisos (9 hs) o recordatorios (18 hs) con las excepciones
// guardadas como datos, y la compara con lo que hizo la pasada (27/11/2026).
// Por ahora solo mira: las pasadas siguen mandando con sus reglas de siempre.
//
//   node lista-avisos.cjs [--fecha aaaa-mm-dd] [--tipo aviso|recordatorio]   muestra la lista (por defecto, aviso de mañana)
//   node lista-avisos.cjs --guardar ...      además guarda la foto en state/comparacion (sin teléfonos)
//   node lista-avisos.cjs --comparar ...     compara la foto guardada con el registro de la pasada
//   node lista-avisos.cjs --historia aaaa-mm-dd   revisa las excepciones contra los registros desde esa fecha
//
// Mismas variables que el servidor (GOOGLE_APPLICATION_CREDENTIALS y RUTAWATER_EMAIL o RUTAWATER_UID).
process.env.TZ = process.env.RUTAWATER_TZ || 'America/Montevideo';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Client } from '../../src/types';
import { getDb, loadConfig } from '../src/config';
import { buildNoticeList, exceptionFor, NoticeKind, NoticeList, NoticeRules, Progress } from '../src/noticeList';
import { ReadBudget, setReadBudget } from '../src/readBudget';
import { Store } from '../src/store';
import { notifyJonathan } from '../src/telegram';
import { addDays, todayKey, whatsappTemplates } from '../src/views';

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);

const SKILL = process.env.RUTAWATER_AVISOS_DIR || path.join(os.homedir(), '.codex', 'skills', 'next-day-delivery-preparation');
const RULES = path.join(SKILL, 'avisos-excepciones.json');
const STATE = path.join(SKILL, 'state');
const COMPARE = path.join(STATE, 'comparacion');
const kind: NoticeKind = arg('--tipo') === 'recordatorio' ? 'recordatorio' : 'aviso';
const date = arg('--fecha') || addDays(todayKey(), 1);

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const progressOf = (isoDate: string, which: NoticeKind): Progress =>
  readJson<{ clients?: Progress }>(path.join(STATE, which === 'aviso' ? '' : 'second-pass', `${isoDate}.json`), {}).clients || {};
const idOf = (key: string): string => (key.split('|').pop() || '').split('::')[0];

interface Snapshot {
  fecha: string; tipo: NoticeKind; tomada: string;
  mandar: Array<{ cliente_id: string; cliente: string; destinatario: string; clave: string; excepcion?: string }>;
  omitidos: NoticeList['omitidos']; revisar: NoticeList['revisar'];
}
const snapshotPath = () => path.join(COMPARE, `${date}-${kind}.json`);

const loadAll = async () => {
  const config = await loadConfig();
  setReadBudget(new ReadBudget(config.loadsDir, config.dailyLoads, undefined, config.hourlyDocs));
  const store = new Store(getDb(), config.uid);
  const account = await store.getAccount();
  const template = whatsappTemplates(await store.getSettings()).aviso_manana;
  const routes: Array<{ name: string; clients: Client[] }> = [];
  for (const route of account.routes) routes.push({ name: route.name, clients: await store.getClients(route) });
  store.close();
  return { routes, template };
};

const TIMING = /favorit|estrella|ya respondi|escribi|una vez|confirm/i;
const EXCLUDED = /exclu|nunca abrir|reserv|segundo mensaje|sin recordatorio/i;

const resultPath = () => path.join(COMPARE, `${date}-${kind}.resultado.json`);

const compare = async () => {
  // El vigilante puede pasar dos veces por la misma ventana: se compara una sola vez.
  if (fs.existsSync(resultPath()) && !has('--otra-vez')) return;
  const snapshot = readJson<Snapshot | null>(snapshotPath(), null);
  if (!snapshot) throw new Error(`No hay foto guardada de ${kind} para el ${date}.`);
  const pass = progressOf(date, kind);
  if (!Object.keys(pass).length) throw new Error(`La pasada no dejó registro de ${kind} para el ${date}.`);
  const status = new Map<string, { status: string; note: string; client: string }>();
  Object.entries(pass).forEach(([key, entry]) => {
    const id = idOf(key);
    const previous = status.get(id);
    // Con dos destinatarios alcanza con que uno haya salido.
    if (!previous || entry.status === 'sent') status.set(id, { status: String(entry.status), note: String(entry.note || ''), client: String(entry.client || '') });
  });
  const ours = new Map(snapshot.mandar.map((item) => [item.cliente_id, item.cliente]));
  const skipped = new Map(snapshot.omitidos.concat(snapshot.revisar).map((item) => [item.cliente_id, item]));
  let same = 0;
  const timing: string[] = [];
  const real: string[] = [];
  ours.forEach((name, id) => {
    const entry = status.get(id);
    if (entry?.status === 'sent') { same += 1; return; }
    if (!entry) real.push(`${name}: el programa le mandaba y la pasada no lo registró`);
    else if (EXCLUDED.test(entry.note) && !/ya respondi/i.test(entry.note)) real.push(`${name}: el programa le mandaba y la pasada lo salteó (${entry.note})`);
    else if (TIMING.test(entry.note)) timing.push(`${name}: contestó o cambió entre la foto y el envío (${entry.note})`);
    else timing.push(`${name}: la pasada lo dejó ${entry.status} (${entry.note})`);
  });
  status.forEach((entry, id) => {
    if (ours.has(id)) return;
    const mine = skipped.get(id);
    if (entry.status === 'sent') {
      if (!mine) timing.push(`${entry.client}: la pasada le mandó y no estaba en la agenda cuando se sacó la foto`);
      else real.push(`${entry.client}: la pasada le mandó y el programa lo salteaba (${mine.motivo})`);
    } else if (mine) same += 1;
  });
  const summary = { fecha: date, tipo: kind, coinciden: same, por_horario: timing, diferencias: real };
  fs.writeFileSync(resultPath(), JSON.stringify(summary, null, 1));
  fs.appendFileSync(path.join(COMPARE, 'registro.log'), `${new Date().toISOString()} ${kind} ${date}: coinciden ${same}, por horario ${timing.length}, diferencias ${real.length}${real.length ? ` — ${real.join(' | ')}` : ''}\n`);
  console.log(JSON.stringify(summary, null, 1));
  if (has('--avisar') && real.length) {
    await notifyJonathan(`Comparación de ${kind === 'aviso' ? 'avisos' : 'recordatorios'} del ${date}: el programa nuevo y la pasada no coincidieron en ${real.length}:\n${real.map((line) => `• ${line}`).join('\n')}\n(Solo es la prueba en paralelo: lo que salió lo mandó la pasada de siempre.)`).catch(() => undefined);
  }
  // Los viernes, después de los recordatorios, el resumen de la semana de prueba.
  if (has('--avisar') && kind === 'recordatorio' && new Date().getDay() === 5) {
    const since = addDays(todayKey(), -6);
    const week = fs.readdirSync(COMPARE).filter((name) => name.endsWith('.resultado.json') && name.slice(0, 10) >= since)
      .map((name) => readJson<{ coinciden: number; por_horario: string[]; diferencias: string[] }>(path.join(COMPARE, name), { coinciden: 0, por_horario: [], diferencias: [] }));
    const total = (pick: (item: (typeof week)[number]) => number) => week.reduce((sum, item) => sum + pick(item), 0);
    await notifyJonathan(`Prueba de la lista de avisos por programa, semana al ${todayKey()}: ${week.length} comparaciones con las pasadas. Coincidieron ${total((item) => item.coinciden)} decisiones, ${total((item) => item.por_horario.length)} cambiaron solo por la hora (el cliente contestó entre medio) y hubo ${total((item) => item.diferencias.length)} diferencias de verdad.`).catch(() => undefined);
  }
};

const history = async (since: string) => {
  const rules = readJson<NoticeRules>(RULES, { excepciones: [] });
  const { routes } = await loadAll();
  const clients = routes.flatMap((route) => route.clients);
  const byId = new Map(clients.map((client) => [client.id, client]));
  const out = { registros: 0, entradas: 0, coinciden: 0, sin_ficha: 0, diferencias: [] as string[] };
  for (const which of ['aviso', 'recordatorio'] as NoticeKind[]) {
    const dir = path.join(STATE, which === 'aviso' ? '' : 'second-pass');
    for (const file of fs.readdirSync(dir).filter((name) => /^\d{4}-\d\d-\d\d\.json$/.test(name) && name.slice(0, 10) >= since).sort()) {
      out.registros += 1;
      Object.entries(progressOf(file.slice(0, 10), which)).forEach(([key, entry]) => {
        const note = String(entry.note || '');
        const client = byId.get(idOf(key));
        if (!client) { out.sin_ficha += 1; return; }
        const exception = exceptionFor(client, clients, rules);
        const allowed = !exception || (which === 'aviso' ? exception.aviso : exception.recordatorio);
        const where = `${file.slice(0, 10)} ${which} · ${client.name}`;
        if (entry.status === 'sent') {
          out.entradas += 1;
          if (allowed) out.coinciden += 1;
          else out.diferencias.push(`${where}: la pasada le mandó y los datos dicen que no (${exception?.motivo || exception?.clave})`);
        } else if (entry.status === 'skipped' && EXCLUDED.test(note) && !/ya respondi/i.test(note)) {
          out.entradas += 1;
          if (!allowed) out.coinciden += 1;
          else out.diferencias.push(`${where}: la pasada lo salteó (${note}) y los datos dicen que recibe`);
        }
      });
    }
  }
  console.log(JSON.stringify(out, null, 1));
};

const main = async () => {
  if (has('--comparar')) return compare();
  if (arg('--historia')) return history(arg('--historia')!);
  const rules = readJson<NoticeRules>(RULES, { excepciones: [] });
  if (!rules.excepciones.length) throw new Error(`No pude leer las excepciones de ${RULES}.`);
  const { routes, template } = await loadAll();
  const firstPass = progressOf(date, 'aviso');
  const secondPass = progressOf(date, 'recordatorio');
  const list: NoticeList = { fecha: date, tipo: kind, mandar: [], omitidos: [], revisar: [] };
  routes.forEach((route) => {
    const partial = buildNoticeList({ clients: route.clients, date, kind, rules, template, firstPass, secondPass });
    list.mandar.push(...partial.mandar);
    list.omitidos.push(...partial.omitidos);
    list.revisar.push(...partial.revisar);
  });
  const snapshot: Snapshot = {
    fecha: date, tipo: kind, tomada: new Date().toISOString(),
    mandar: list.mandar.map(({ cliente_id, cliente, destinatario, clave, excepcion }) => ({ cliente_id, cliente, destinatario, clave, ...(excepcion ? { excepcion } : {}) })),
    omitidos: list.omitidos, revisar: list.revisar,
  };
  if (has('--guardar')) {
    fs.mkdirSync(COMPARE, { recursive: true });
    fs.writeFileSync(snapshotPath(), JSON.stringify(snapshot, null, 1));
  }
  const reasons: Record<string, number> = {};
  list.omitidos.forEach((item) => { const reason = item.motivo.split(':')[0]; reasons[reason] = (reasons[reason] || 0) + 1; });
  console.log(JSON.stringify({
    fecha: date, tipo: kind, mandar: list.mandar.length, omitidos: reasons, revisar: list.revisar,
    ...(has('--detalle') ? { lista: snapshot.mandar, omitidos_detalle: list.omitidos } : {}),
  }, null, 1));
  return undefined;
};

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
