import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import type { Client } from '../../src/types';
import { getClientPhones } from '../../src/utils/clientPhones';
import { WriteError } from './writes';

// Tareas con hora (Jonathan, 30/10/2026): «mañana a las 6, si tal cliente no
// contestó, pasalo a la semana que viene». Jonathan se lo pide al vigilante, que
// la guarda acá; el vigilante (launchd, cada 20 min) arranca una pasada cuando
// alguna vence, aunque no haya mensajes, y la pasada la hace y la cierra. El
// archivo es local: lo comparten el servidor de la app de Claude y el del vigilante.

const file = () => (process.env.RUTAWATER_TAREAS || '').trim()
  || join(homedir(), '.rutawater-mcp/vigilante/tareas.json');
const UY_OFFSET_MS = 3 * 3600e3;
const MAX_DAYS_AHEAD = 60;
const INBOX = 'whatsappInbox';

export type TaskState = 'pendiente' | 'hecha' | 'cancelada' | 'fallida';

export interface Task {
  id: string;
  /** «aaaa-mm-dd HH:MM», hora de Uruguay. */
  cuando: string;
  instruccion: string;
  clientes: Array<{ id: string; nombre: string }>;
  /** Desde cuándo cuenta «contestó» (por defecto, cuando se programó). */
  desde: string;
  creada: string;
  estado: TaskState;
  resultado?: string;
  cerrada?: string;
}

const uyText = (date: Date) => new Date(date.getTime() - UY_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
const fromUy = (text: string) => new Date(`${text.replace(' ', 'T')}:00-03:00`);

const load = (): Task[] => (existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : []);
const save = (tasks: Task[]) => {
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(tasks, null, 1));
  renameSync(tmp, file());
};

/** Guarda una tarea para `date` (aaaa-mm-dd) a la hora `time` (HH:MM) de Uruguay. */
export const scheduleTask = (
  date: string, time: string, instruction: string, clients: Client[], since?: string, now = new Date(),
): Task => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new WriteError(`Hora inválida: ${time}. Usá HH:MM (por ejemplo 06:00).`);
  const when = `${date} ${time}`;
  const at = fromUy(when);
  if (Number.isNaN(at.getTime())) throw new WriteError(`Fecha inválida: ${date}.`);
  if (at.getTime() <= now.getTime()) throw new WriteError(`${when} ya pasó.`);
  if (at.getTime() - now.getTime() > MAX_DAYS_AHEAD * 86_400_000) throw new WriteError(`Más de ${MAX_DAYS_AHEAD} días: anotalo en la ficha o en la agenda.`);
  if (since !== undefined && Number.isNaN(fromUy(since).getTime())) throw new WriteError(`desde inválido: ${since}. Usá «aaaa-mm-dd HH:MM».`);
  const text = instruction.trim();
  if (!text) throw new WriteError('Falta qué hacer.');
  const tasks = load();
  const same = tasks.find((task) => task.estado === 'pendiente' && task.cuando === when && task.instruccion === text);
  if (same) return same;
  const task: Task = {
    id: `t${now.getTime().toString(36)}`,
    cuando: when,
    instruccion: text,
    clientes: clients.map((client) => ({ id: client.id, nombre: client.name })),
    desde: since || uyText(now),
    creada: uyText(now),
    estado: 'pendiente',
  };
  save([...tasks, task]);
  return task;
};

/** Mensajes que mandó cada cliente de la tarea desde `desde` (atendidos o no), para saber si contestó. */
const repliesSince = async (db: Firestore, task: Task, clients: Client[]) => {
  if (!task.clientes.length) return undefined;
  const snap = await db.collection(INBOX).where('sentAt', '>=', fromUy(task.desde)).get();
  const inbound = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as any).filter((message) => message.direction === 'in');
  return task.clientes.map(({ id, nombre }) => {
    const client = clients.find((candidate) => candidate.id === id);
    const phones = client ? getClientPhones(client).map((phone) => phone.number.replace(/\D/g, '').slice(-8)) : [];
    const own = inbound.filter((message) => phones.includes(String(message.phone || '').replace(/\D/g, '').slice(-8)))
      .map((message) => ({
        id: message.id,
        hora: uyText(message.sentAt?.toDate ? message.sentAt.toDate() : new Date(message.sentAt)),
        tipo: message.type,
        texto: message.text || '',
      }))
      .sort((a, b) => a.hora.localeCompare(b.hora));
    return { cliente_id: id, nombre, contesto: own.length > 0, mensajes: own };
  });
};

/** Las tareas pendientes (o solo las vencidas), con lo que contestó cada cliente desde que se programó. */
export const listTasks = async (db: Firestore, clients: Client[], onlyDue: boolean, now = new Date()) => {
  const pending = load().filter((task) => task.estado === 'pendiente'
    && (!onlyDue || fromUy(task.cuando).getTime() <= now.getTime()));
  return Promise.all(pending.map(async (task) => {
    const replies = await repliesSince(db, task, clients);
    return { ...task, vencida: fromUy(task.cuando).getTime() <= now.getTime(), ...(replies ? { respuestas_desde: replies } : {}) };
  }));
};

export const closeTask = (id: string, state: Exclude<TaskState, 'pendiente'>, result: string, now = new Date()) => {
  const tasks = load();
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) throw new WriteError(`No hay una tarea ${id}.`);
  if (task.estado !== 'pendiente') return { ...task, cambiado: false };
  Object.assign(task, { estado: state, resultado: result.trim(), cerrada: uyText(now) });
  save(tasks);
  return { ...task, cambiado: true };
};
