import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScript } from './audio';
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
  id: string; fecha: string; texto: string; consulta_id: string | null; tipo?: 'respuesta' | 'respuesta_varias' | 'instruccion'; aplicada: boolean;
  /** Audio de Telegram todavía sin transcribir. */
  audio_file_id?: string; por_audio?: boolean; dudoso?: boolean;
}
interface State { chat_id?: number; offset?: number; seq?: number; preguntas: Question[]; respuestas: Answer[] }

const load = (): State => {
  const raw = existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), 'utf8')) : {};
  return { preguntas: [], respuestas: [], ...raw };
};
const save = (state: State) => {
  const tmp = `${stateFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  renameSync(tmp, stateFile());
};
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Leer, cambiar y guardar el estado con un candado: lo tocan a la vez la escucha
 * de Telegram, el servidor de la app de Claude y el del vigilante.
 */
const withState = <T>(change: (state: State) => T): T => {
  const lock = `${stateFile()}.lock`;
  for (let tries = 0; ; tries += 1) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch {
      // Un candado de más de 15 s quedó de un proceso que se cortó.
      try { if (Date.now() - statSync(lock).mtimeMs > 15000) rmSync(lock, { force: true }); } catch { /* ya no está */ }
      if (tries > 100) throw new WriteError('El estado del bot de Telegram está ocupado; reintentar.');
      pause(50);
    }
  }
  try {
    const state = load();
    const result = change(state);
    save(state);
    return result;
  } finally {
    rmSync(lock, { force: true });
  }
};

// La escucha (telegram-escucha) toca este archivo en cada vuelta: mientras está
// viva, ella es la única que le pide mensajes a Telegram (dos lectores a la vez
// se cortan entre sí) y los demás leen lo que dejó guardado.
const heartbeatFile = () => `${stateFile()}.escucha`;
const listenerAlive = () => {
  try { return Date.now() - statSync(heartbeatFile()).mtimeMs < 120000; } catch { return false; }
};
export const touchHeartbeat = () => writeFileSync(heartbeatFile(), new Date().toISOString());
const token = (): string => {
  if (!existsSync(tokenFile())) throw new WriteError(`Falta el token del bot de Telegram en ${tokenFile()}.`);
  return readFileSync(tokenFile(), 'utf8').trim();
};
const INSTRUCTION = /^\s*(regla|orden|cambio|nuevo|nueva)\b/i;

/**
 * A qué duda contesta un mensaje sin citar: con una sola abierta, a esa; con
 * varias, a ninguna en particular («respuesta_varias»: la pasada reparte por
 * cliente); «Regla: …», «Orden: …» o sin dudas abiertas, es una instrucción.
 */
const classify = (state: State, text: string, cited?: Question) => {
  if (cited) { cited.respondida = true; return { consulta_id: cited.id, tipo: 'respuesta' as const }; }
  const open = state.preguntas.filter((q) => !q.respondida);
  if (INSTRUCTION.test(text) || !open.length) return { consulta_id: null, tipo: 'instruccion' as const };
  if (open.length === 1) { open[0].respondida = true; return { consulta_id: open[0].id, tipo: 'respuesta' as const }; }
  return { consulta_id: null, tipo: 'respuesta_varias' as const };
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

/** Guarda en el estado los mensajes nuevos (los de update_id >= offset). */
const applyUpdates = (state: State, updates: any[]) => {
  for (const update of updates) {
    if (state.offset !== undefined && update.update_id < state.offset) continue;
    state.offset = update.update_id + 1;
    const message = update.message;
    if (!message?.chat || message.chat.type !== 'private') continue;
    // El primer mensaje (el «hola») solo fija el chat.
    if (state.chat_id === undefined) { state.chat_id = message.chat.id; continue; }
    const voice = message.voice || message.audio;
    if (message.chat.id !== state.chat_id || (!message.text && !voice) || message.text === '/start') continue;
    const cited = state.preguntas.find((q) => q.message_id === message.reply_to_message?.message_id);
    if (voice) {
      // El audio se clasifica cuando se transcribe (al leer las respuestas), salvo que cite una duda.
      if (cited) cited.respondida = true;
      state.respuestas.push({
        id: `R${message.message_id}`, fecha: uyNow(), texto: '', consulta_id: cited?.id || null,
        tipo: cited ? 'respuesta' : undefined, aplicada: false, audio_file_id: voice.file_id, por_audio: true,
      });
      continue;
    }
    const text = String(message.text).slice(0, 2000);
    state.respuestas.push({ id: `R${message.message_id}`, fecha: uyNow(), texto: text, ...classify(state, text, cited), aplicada: false });
  }
  // Solo lo de las últimas semanas: el archivo no crece sin fin.
  state.preguntas = state.preguntas.slice(-200);
  state.respuestas = state.respuestas.slice(-200);
};

/**
 * Trae lo nuevo del bot. La primera vez fija el chat de quien le escribió (Jonathan);
 * después ignora cualquier otro chat. Las respuestas quedan guardadas hasta aplicarlas.
 * Con `waitSeconds` espera a que llegue algo (lo usa la escucha). Si la escucha
 * está viva, una lectura sin espera no va a Telegram: usa lo que ella guardó.
 */
export const pullAnswers = async (fetcher: typeof fetch = fetch, waitSeconds = 0): Promise<State> => {
  if (!waitSeconds && listenerAlive()) return load();
  const updates: any[] = await call('getUpdates', { offset: load().offset, timeout: waitSeconds, allowed_updates: ['message'] }, fetcher);
  return withState((state) => { applyUpdates(state, updates); return state; });
};

export const askJonathan = async (
  input: { pregunta: string; cliente?: string; telefono?: string; mensaje_cliente?: string; whatsapp_ids?: string[] },
  fetcher: typeof fetch = fetch,
) => {
  const state = await pullAnswers(fetcher);
  if (state.chat_id === undefined) throw new WriteError('El bot todavía no conoce el chat de Jonathan: tiene que mandarle «hola» al bot.');
  // El número se reserva con el candado: dos pasadas a la vez no repiten «D…».
  const seq = withState((fresh) => { fresh.seq = (fresh.seq || 0) + 1; return fresh.seq; });
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
  withState((fresh) => {
    fresh.seq = Math.max(fresh.seq || 0, seq);
    fresh.preguntas.push({
      id, message_id: sent.message_id, fecha: uyNow(), pregunta: input.pregunta,
      cliente: input.cliente, telefono: input.telefono, mensaje_cliente: input.mensaje_cliente, whatsapp_ids: input.whatsapp_ids,
    });
  });
  return { enviada: true, consulta_id: id };
};

/** Baja los audios pendientes del bot y los transcribe con el Whisper del Mac. */
const transcribeVoices = async (state: State, fetcher: typeof fetch) => {
  const pending = state.respuestas.filter((answer) => answer.audio_file_id && !answer.texto);
  if (!pending.length) return;
  const work = mkdtempSync(join(tmpdir(), 'rutawater-tg-audio-'));
  try {
    const files: Array<{ answer: Answer; name: string }> = [];
    for (const answer of pending) {
      const file = await call('getFile', { file_id: answer.audio_file_id }, fetcher);
      const response = await fetcher(`${API}/file/bot${token()}/${file.file_path}`);
      if (!response.ok) continue;
      const stamp = answer.fecha.replace(' ', ' at ').replace(':', '.');
      const name = `WhatsApp Audio ${stamp}.00 ${answer.id}.ogg`;
      writeFileSync(join(work, name), Buffer.from(await response.arrayBuffer()));
      files.push({ answer, name });
    }
    if (!files.length) return;
    const results = await runScript(files.map(({ name }) => join(work, name)), work);
    withState((fresh) => {
      for (const { answer, name } of files) {
        const result: any = results.find((entry) => entry.archivo === name);
        const stored = fresh.respuestas.find((entry) => entry.id === answer.id);
        if (!result || result.error || !stored || stored.texto) continue;
        stored.texto = String(result.texto || '').trim() || '(audio vacío)';
        stored.dudoso = !!result.dudoso;
        delete stored.audio_file_id;
        if (!stored.tipo) Object.assign(stored, classify(fresh, stored.texto));
      }
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/** Respuestas de Jonathan sin aplicar, cada una con la pregunta que contesta. */
export const readAnswers = async (fetcher: typeof fetch = fetch) => {
  await transcribeVoices(await pullAnswers(fetcher), fetcher);
  const state = load();
  return {
    respuestas: state.respuestas.filter((answer) => !answer.aplicada && answer.texto).map(({ audio_file_id: _pending, ...answer }) => ({
      ...answer, consulta: state.preguntas.find((q) => q.id === answer.consulta_id) || null,
    })),
    // Con sus datos: una «respuesta_varias» se reparte entre estas por cliente.
    preguntas_sin_respuesta: state.preguntas.filter((q) => !q.respondida)
      .map(({ id, fecha, cliente, pregunta, mensaje_cliente, telefono, whatsapp_ids }) => ({ id, fecha, cliente, pregunta, mensaje_cliente, telefono, whatsapp_ids })),
  };
};

/** Da por aplicadas esas respuestas y, si se indican, cierra esas dudas (las que contestó una «respuesta_varias»). */
export const markAnswersApplied = (ids: string[], questionIds: string[] = []) => withState((state) => {
  const done = state.respuestas.filter((answer) => ids.includes(answer.id));
  done.forEach((answer) => { answer.aplicada = true; });
  const closed = state.preguntas.filter((q) => questionIds.includes(q.id));
  closed.forEach((q) => { q.respondida = true; });
  return {
    aplicadas: done.map((answer) => answer.id),
    dudas_cerradas: closed.map((q) => q.id),
    no_encontradas: [...ids, ...questionIds].filter((id) => !done.some((a) => a.id === id) && !closed.some((q) => q.id === id)),
  };
});

/** Aviso corto a Jonathan (sin esperar respuesta), por ejemplo el resumen de una pasada. */
export const notifyJonathan = async (text: string, fetcher: typeof fetch = fetch) => {
  const state = await pullAnswers(fetcher);
  if (state.chat_id === undefined) throw new WriteError('El bot todavía no conoce el chat de Jonathan: tiene que mandarle «hola» al bot.');
  await call('sendMessage', { chat_id: state.chat_id, text: text.slice(0, 3500) }, fetcher);
  return { enviado: true };
};
