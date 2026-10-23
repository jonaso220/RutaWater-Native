import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WriteError } from './writes';

// Dudas para Jonathan por Telegram (23/10/2026). El vigilante y las pasadas le
// mandan la pregunta a su bot; él contesta en Telegram (mejor respondiendo al
// mensaje) y la próxima pasada lee la respuesta y la aplica. Solo se aceptan
// mensajes del chat de Jonathan, que queda fijado la primera vez que le escribe
// al bot.

const home = homedir();
const env = (name: string, fallback: string) => (process.env[name] || '').trim() || fallback;
const tokenFile = () => env('RUTAWATER_TELEGRAM_TOKEN', join(home, '.rutawater-mcp/telegram.token'));
const stateFile = () => env('RUTAWATER_TELEGRAM_STATE', join(home, '.rutawater-mcp/telegram.json'));
const API = 'https://api.telegram.org';

interface Question {
  id: string; message_id: number; fecha: string; pregunta: string;
  cliente?: string; telefono?: string; mensaje_cliente?: string; whatsapp_ids?: string[]; respondida?: boolean;
}
interface Answer {
  id: string; fecha: string; texto: string; consulta_id: string | null; aplicada: boolean;
}
interface State { chat_id?: number; offset?: number; seq?: number; preguntas: Question[]; respuestas: Answer[] }

const load = (): State => {
  const raw = existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), 'utf8')) : {};
  return { preguntas: [], respuestas: [], ...raw };
};
const save = (state: State) => {
  // Se reescribe entero: varias copias del servidor pueden tocarlo.
  const tmp = `${stateFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  renameSync(tmp, stateFile());
};
const token = (): string => {
  if (!existsSync(tokenFile())) throw new WriteError(`Falta el token del bot de Telegram en ${tokenFile()}.`);
  return readFileSync(tokenFile(), 'utf8').trim();
};
const uyNow = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

const call = async (method: string, body: Record<string, unknown>, fetcher: typeof fetch) => {
  const response = await fetcher(`${API}/bot${token()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!data.ok) throw new WriteError(`Telegram rechazó ${method}: ${data.description || response.status}.`);
  return data.result;
};

/**
 * Trae lo nuevo del bot. La primera vez fija el chat de quien le escribió (Jonathan);
 * después ignora cualquier otro chat. Las respuestas quedan guardadas hasta aplicarlas.
 */
export const pullAnswers = async (fetcher: typeof fetch = fetch): Promise<State> => {
  const state = load();
  const updates: any[] = await call('getUpdates', { offset: state.offset, timeout: 0, allowed_updates: ['message'] }, fetcher);
  for (const update of updates) {
    state.offset = update.update_id + 1;
    const message = update.message;
    if (!message?.chat || message.chat.type !== 'private') continue;
    // El primer mensaje (el «hola») solo fija el chat.
    if (state.chat_id === undefined) { state.chat_id = message.chat.id; continue; }
    if (message.chat.id !== state.chat_id || !message.text || message.text === '/start') continue;
    const replied = message.reply_to_message?.message_id;
    let question = state.preguntas.find((q) => q.message_id === replied);
    // Sin «responder», se asume la última pregunta abierta.
    if (!question) question = [...state.preguntas].reverse().find((q) => !q.respondida);
    if (question) question.respondida = true;
    state.respuestas.push({
      id: `R${message.message_id}`, fecha: uyNow(), texto: String(message.text).slice(0, 2000),
      consulta_id: question?.id || null, aplicada: false,
    });
  }
  // Solo lo de las últimas semanas: el archivo no crece sin fin.
  state.preguntas = state.preguntas.slice(-200);
  state.respuestas = state.respuestas.slice(-200);
  save(state);
  return state;
};

export const askJonathan = async (
  input: { pregunta: string; cliente?: string; telefono?: string; mensaje_cliente?: string; whatsapp_ids?: string[] },
  fetcher: typeof fetch = fetch,
) => {
  const state = await pullAnswers(fetcher);
  if (state.chat_id === undefined) throw new WriteError('El bot todavía no conoce el chat de Jonathan: tiene que mandarle «hola» al bot.');
  const seq = (state.seq || 0) + 1;
  const id = `D${seq}`;
  const lines = [
    `❓ Duda ${id}`,
    input.cliente ? `Cliente: ${input.cliente}` : '',
    input.mensaje_cliente ? `Escribió: «${input.mensaje_cliente.slice(0, 1500)}»` : '',
    '',
    input.pregunta,
    '',
    'Respondé a este mensaje (deslizá a la izquierda) con lo que hay que hacer.',
  ].filter((line, index, all) => line || all[index - 1]);
  const sent = await call('sendMessage', { chat_id: state.chat_id, text: lines.join('\n') }, fetcher);
  state.seq = seq;
  state.preguntas.push({
    id, message_id: sent.message_id, fecha: uyNow(), pregunta: input.pregunta,
    cliente: input.cliente, telefono: input.telefono, mensaje_cliente: input.mensaje_cliente, whatsapp_ids: input.whatsapp_ids,
  });
  save(state);
  return { enviada: true, consulta_id: id };
};

/** Respuestas de Jonathan sin aplicar, cada una con la pregunta que contesta. */
export const readAnswers = async (fetcher: typeof fetch = fetch) => {
  const state = await pullAnswers(fetcher);
  return {
    respuestas: state.respuestas.filter((answer) => !answer.aplicada).map((answer) => ({
      ...answer, consulta: state.preguntas.find((q) => q.id === answer.consulta_id) || null,
    })),
    preguntas_sin_respuesta: state.preguntas.filter((q) => !q.respondida).map(({ id, fecha, cliente, pregunta }) => ({ id, fecha, cliente, pregunta })),
  };
};

export const markAnswersApplied = (ids: string[]) => {
  const state = load();
  const done = state.respuestas.filter((answer) => ids.includes(answer.id));
  done.forEach((answer) => { answer.aplicada = true; });
  save(state);
  return { aplicadas: done.map((answer) => answer.id), no_encontradas: ids.filter((id) => !done.some((answer) => answer.id === id)) };
};

/** Aviso corto a Jonathan (sin esperar respuesta), por ejemplo el resumen de una pasada. */
export const notifyJonathan = async (text: string, fetcher: typeof fetch = fetch) => {
  const state = await pullAnswers(fetcher);
  if (state.chat_id === undefined) throw new WriteError('El bot todavía no conoce el chat de Jonathan: tiene que mandarle «hola» al bot.');
  await call('sendMessage', { chat_id: state.chat_id, text: text.slice(0, 3500) }, fetcher);
  return { enviado: true };
};
