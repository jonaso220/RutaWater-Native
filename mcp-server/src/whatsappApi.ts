import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { Client } from '../../src/types';
import { getClientPhones } from '../../src/utils/clientPhones';
import { runScript } from './audio';
import { MacUnavailable, sendViaMac } from './macSend';
import { WriteError } from './writes';

// WhatsApp por la API de YCloud (coexistencia con la app; Jonathan, 23/10/2026).
// Lo gratis va por acá: leer lo que llega (lo guarda el webhook de Netlify en
// whatsappInbox), bajar audios y comprobantes, marcar leído y contestar dentro
// de las 24 h mientras el mes no pase el tope. Lo que se cobra siempre (avisos y
// recordatorios, que son plantillas) sigue por la app en el Mac.

const home = homedir();
const env = (name: string, fallback: string) => (process.env[name] || '').trim() || fallback;
const keyFile = () => env('RUTAWATER_YCLOUD_KEY', join(home, '.rutawater-mcp/ycloud.key'));
const configFile = () => env('RUTAWATER_WHATSAPP_CONFIG', join(home, '.rutawater-mcp/whatsapp.json'));
const API = 'https://api.ycloud.com/v2';
const INBOX = 'whatsappInbox';
const USAGE = 'whatsappUsage';
// Excluidos de la base (los lee también el webhook de Netlify): los que Jonathan
// le pide al vigilante que excluya, sumados a los de whatsapp.json (27/10/2026).
const EXCLUDED_COLLECTION = 'whatsappConfig';
const EXCLUDED_DOC = 'excluidos';
const NAME_SEARCH_MS = 14 * 24 * 3600e3;
// Meta regala 1.000 respuestas por número y por mes; después ~US$0,0113 cada
// una. Jonathan acepta hasta ~US$30 por mes sobre lo gratis: 1.000 + 2.600.
const DEFAULT_MONTHLY_LIMIT = 3600;
const WINDOW_MS = 24 * 3600e3;
const CONTEXT_MS = 48 * 3600e3;
const CHAT_LIMIT = 50;
const UY_OFFSET_MS = 3 * 3600e3;

const digits = (value: unknown): string => String(value || '').replace(/\D/g, '');
const last8 = (value: unknown): string => digits(value).slice(-8);
const uyIso = (date: Date): string => new Date(date.getTime() - UY_OFFSET_MS).toISOString().replace('Z', '-03:00');
const monthKey = (date: Date): string => uyIso(date).slice(0, 7);

interface LocalConfig { negocio: string; excluidos: string[]; tope_mes: number; aquapura: string }

/** ~/.rutawater-mcp/whatsapp.json: número del negocio, chats excluidos (los mismos que en Netlify) y tope. */
export const localConfig = (): LocalConfig => {
  const raw = existsSync(configFile()) ? JSON.parse(readFileSync(configFile(), 'utf8')) : {};
  return {
    negocio: digits(raw.negocio),
    excluidos: Array.isArray(raw.excluidos) ? raw.excluidos.map(digits).filter(Boolean) : [],
    tope_mes: Number.isInteger(raw.tope_mes) && raw.tope_mes >= 0 ? raw.tope_mes : DEFAULT_MONTHLY_LIMIT,
    aquapura: digits(raw.aquapura),
  };
};

const apiKey = (): string => {
  if (!existsSync(keyFile())) throw new WriteError(`Falta la clave de YCloud en ${keyFile()}.`);
  return readFileSync(keyFile(), 'utf8').trim();
};

const excludedRef = (db: Firestore) => db.collection(EXCLUDED_COLLECTION).doc(EXCLUDED_DOC);

/** Los de whatsapp.json más los de la base. */
const loadExcluded = async (db: Firestore, config: LocalConfig): Promise<string[]> => {
  const phones = (await excludedRef(db).get()).data()?.phones;
  return [...config.excluidos, ...(Array.isArray(phones) ? phones.map(digits).filter(Boolean) : [])];
};

const isExcluded = (excluded: string[], phone: string) =>
  excluded.some((entry) => entry === phone || last8(entry) === last8(phone));

const toDate = (value: any): Date => (value?.toDate ? value.toDate() : new Date(value));

interface InboxDoc {
  id: string; direction: 'in' | 'out'; phone: string; name: string; type: string; text: string;
  media: { id: string; link: string; mime: string; filename: string } | null;
  sentAt: Date; handled: boolean; wamid: string; source?: string;
}

const readDoc = (doc: DocumentSnapshot): InboxDoc => {
  const data = doc.data() || {};
  return { ...(data as any), id: doc.id, sentAt: toDate(data.sentAt) };
};

const describe = (message: InboxDoc) => ({
  id: message.id,
  hora: uyIso(message.sentAt).slice(0, 16).replace('T', ' '),
  de: message.direction === 'in' ? 'cliente' : (message.source === 'api' ? 'nosotros (API)' : 'nosotros (app)'),
  tipo: message.type,
  texto: message.text,
  ...(message.media ? { archivo: message.media.mime || message.type } : {}),
});

const clientsByPhone = (clients: Client[], phone: string) => clients
  .filter((client) => !client.isNote && getClientPhones(client).some((entry) => last8(entry.number) === last8(phone)))
  .map((client) => ({ id: client.id, nombre: client.name, direccion: client.address, frecuencia: client.freq }));

const usage = async (db: Firestore, now: Date, config: LocalConfig) => {
  const snap = await db.collection(USAGE).doc(monthKey(now)).get();
  const sent = Number(snap.data()?.sent || 0);
  return { mes: monthKey(now), respuestas_api: sent, tope: config.tope_mes, quedan: Math.max(0, config.tope_mes - sent) };
};

/**
 * Lo que espera respuesta: los mensajes de clientes sin atender, agrupados por
 * chat, con las últimas 48 h de esa conversación (incluido lo que Jonathan
 * mandó desde la app) y las fichas de RutaWater con ese teléfono. Dos consultas
 * chicas: pendientes y últimas 48 h.
 */
export const readInbox = async (db: Firestore, clients: Client[], now = new Date()) => {
  const config = localConfig();
  const [pendingSnap, recentSnap, excluded] = await Promise.all([
    db.collection(INBOX).where('handled', '==', false).get(),
    db.collection(INBOX).where('sentAt', '>=', new Date(now.getTime() - CONTEXT_MS)).get(),
    loadExcluded(db, config),
  ]);
  const pending = pendingSnap.docs.map(readDoc).filter((message) => message.direction === 'in' && !isExcluded(excluded, message.phone));
  const recent = recentSnap.docs.map(readDoc);
  const phones = [...new Set(pending.map((message) => message.phone))];
  const chats = phones.map((phone) => {
    const own = pending.filter((message) => message.phone === phone).sort((a, b) => +a.sentAt - +b.sentAt);
    const history = recent.filter((message) => message.phone === phone).sort((a, b) => +a.sentAt - +b.sentAt).slice(-15);
    const lastIn = Math.max(...[...own, ...history].filter((message) => message.direction === 'in').map((message) => +message.sentAt));
    return {
      telefono: phone,
      nombre_perfil: own[own.length - 1]?.name || '',
      fichas: clientsByPhone(clients, phone),
      pendientes: own.map(describe),
      conversacion: history.map(describe),
      responder_hasta: uyIso(new Date(lastIn + WINDOW_MS)).slice(0, 16).replace('T', ' '),
    };
  }).sort((a, b) => a.pendientes[0].hora.localeCompare(b.pendientes[0].hora));
  return { chats, uso: await usage(db, now, config) };
};

/**
 * Un chat entero de la bandeja, aunque no tenga nada pendiente (Jonathan,
 * 4/11/2026: ve mensajes sin leer en el teléfono que leer_whatsapp no trae).
 * Dice qué llegó a la API, si ya se atendió y lo último de cada lado; lo que no
 * está acá no llegó a la API. Solo lectura: no marca nada como leído.
 */
export const readChat = async (db: Firestore, clients: Client[], phoneInput: string, days: number, now = new Date()) => {
  const phone = fullPhone(phoneInput);
  if (phone.length < 10) throw new WriteError('Teléfono inválido: pasá el número con código de país (598…).');
  if (isExcluded(await loadExcluded(db, localConfig()), phone)) throw new WriteError('Ese chat está excluido: no se lee.');
  const since = now.getTime() - days * 24 * 3600e3;
  const all = (await db.collection(INBOX).where('phone', '==', phone).get()).docs.map(readDoc)
    .sort((a, b) => +a.sentAt - +b.sentAt);
  const inbound = all.filter((message) => message.direction === 'in');
  const hour = (message?: InboxDoc) => (message ? uyIso(message.sentAt).slice(0, 16).replace('T', ' ') : null);
  const lastIn = inbound[inbound.length - 1];
  return {
    telefono: phone,
    fichas: clientsByPhone(clients, phone),
    dias: days,
    mensajes: all.filter((message) => +message.sentAt >= since).slice(-CHAT_LIMIT)
      .map((message) => ({ ...describe(message), atendido: Boolean(message.handled) })),
    sin_atender: inbound.filter((message) => !message.handled).length,
    ultimo_del_cliente: hour(lastIn),
    ultimo_nuestro: hour(all.filter((message) => message.direction === 'out').pop()),
    responder_hasta: lastIn ? uyIso(new Date(+lastIn.sentAt + WINDOW_MS)).slice(0, 16).replace('T', ' ') : null,
  };
};

/** Marca atendidos esos mensajes y, por chat, el último como leído en WhatsApp (gratis; azul también en la app). */
export const markHandled = async (db: Firestore, ids: string[], markRead: boolean, fetcher = fetch) => {
  const snaps = await db.getAll(...ids.map((id) => db.collection(INBOX).doc(id)));
  const found = snaps.filter((snap) => snap.exists).map(readDoc);
  const missing = ids.filter((id) => !found.some((message) => message.id === id));
  const batch = db.batch();
  found.forEach((message) => batch.update(db.collection(INBOX).doc(message.id), { handled: true, handledAt: new Date() }));
  await batch.commit();
  const read: string[] = [];
  if (markRead) {
    const lastPerChat = new Map<string, InboxDoc>();
    found.filter((message) => message.direction === 'in').forEach((message) => {
      const current = lastPerChat.get(message.phone);
      if (!current || message.sentAt > current.sentAt) lastPerChat.set(message.phone, message);
    });
    for (const message of lastPerChat.values()) {
      const response = await fetcher(`${API}/whatsapp/inboundMessages/${encodeURIComponent(message.wamid || message.id)}/markAsRead`, {
        method: 'POST', headers: { 'X-API-Key': apiKey() },
      });
      if (response.ok) read.push(message.phone);
    }
  }
  return { atendidos: found.length, no_encontrados: missing, leidos_en_whatsapp: read };
};

/**
 * Contesta por la API. Solo dentro de las 24 h desde el último mensaje del
 * cliente (si no, Meta exige plantilla, que se paga: va por el Mac), nunca a un
 * chat excluido y sin pasar el tope del mes. Reserva el lugar en el contador
 * antes de enviar y lo devuelve si el envío falla.
 */
export const sendReply = async (db: Firestore, phoneInput: string, body: string, now = new Date(), fetcher = fetch) => {
  const config = localConfig();
  const phone = digits(phoneInput);
  if (phone.length < 10) throw new WriteError('Teléfono inválido: pasá el número con código de país (598…).');
  if (!config.negocio) throw new WriteError(`Falta «negocio» en ${configFile()}.`);
  if (isExcluded(await loadExcluded(db, config), phone)) throw new WriteError('Ese chat está excluido: no se contesta.');
  const text = body.trim();
  if (!text) throw new WriteError('El mensaje está vacío.');
  const inbound = (await db.collection(INBOX).where('phone', '==', phone).where('direction', '==', 'in').get()).docs.map(readDoc);
  const lastIn = Math.max(0, ...inbound.map((message) => +message.sentAt));
  if (!lastIn || now.getTime() - lastIn > WINDOW_MS) {
    throw new WriteError('Pasaron más de 24 h desde el último mensaje del cliente: por la API costaría una plantilla. Contestar desde la app en el Mac.');
  }
  const usageRef = db.collection(USAGE).doc(monthKey(now));
  await db.runTransaction(async (transaction) => {
    const sent = Number((await transaction.get(usageRef)).data()?.sent || 0);
    if (sent >= config.tope_mes) {
      throw new WriteError(`Se llegó al tope de ${config.tope_mes} respuestas por API este mes: contestar desde la app en el Mac.`);
    }
    transaction.set(usageRef, { sent: sent + 1, updatedAt: now }, { merge: true });
  });
  let result: any;
  try {
    const response = await fetcher(`${API}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `+${config.negocio}`, to: `+${phone}`, type: 'text', text: { body: text } }),
    });
    result = await response.json().catch(() => ({}));
    if (!response.ok) throw new WriteError(`YCloud no lo envió: ${result?.error?.message || response.status}.`);
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const sent = Number((await transaction.get(usageRef)).data()?.sent || 0);
      transaction.set(usageRef, { sent: Math.max(0, sent - 1) }, { merge: true });
    });
    throw error;
  }
  const id = String(result.id || result.wamid || `api-${now.getTime()}`);
  await db.collection(INBOX).doc(id).set({
    direction: 'out', source: 'api', phone, name: '', business: config.negocio, wamid: String(result.wamid || ''),
    replyTo: '', sentAt: now, receivedAt: now, handled: true, type: 'text', text, media: null,
  });
  return { enviado: true, id, estado: result.status || 'accepted', telefono: phone, uso: await usage(db, now, config) };
};

/**
 * Un mensaje que Jonathan pide mandarle a un cliente, aunque no sea respuesta
 * (30/10/2026). Con la ventana de 24 h abierta va como texto común
 * (sendReply). Fuera de ella Meta no deja mandar texto libre por la API, ni
 * pagando: va por WhatsApp del Mac (macSend, gratis y tal cual) y, si el Mac no
 * puede, con la plantilla en blanco «mensaje_cliente», que lleva el texto con
 * un saludo y se cobra.
 */
export const FREE_TEMPLATE = 'mensaje_cliente';
export const FREE_TEMPLATE_BODY = 'Hola {{1}}, te escribo por el agua: {{2}}\n\nCualquier cosa, respondeme por acá. ¡Gracias!';

export const sendMessage = async (
  db: Firestore, phoneInput: string, body: string, greeting: string, now = new Date(), fetcher = fetch,
  mac: (db: Firestore, phone: string, text: string) => Promise<{ id: string }> = sendViaMac,
) => {
  const config = localConfig();
  const phone = fullPhone(phoneInput);
  if (phone.length < 10) throw new WriteError('Teléfono inválido: pasá el número con código de país (598…).');
  if (!config.negocio) throw new WriteError(`Falta «negocio» en ${configFile()}.`);
  if (isExcluded(await loadExcluded(db, config), phone)) throw new WriteError('Ese chat está excluido: no se le escribe.');
  const text = body.trim();
  if (!text) throw new WriteError('El mensaje está vacío.');
  const inbound = (await db.collection(INBOX).where('phone', '==', phone).where('direction', '==', 'in').get()).docs.map(readDoc);
  const lastIn = Math.max(0, ...inbound.map((message) => +message.sentAt));
  // Diez minutos de margen: que la ventana no se cierre mientras sale.
  if (lastIn && now.getTime() - lastIn < WINDOW_MS - 10 * 60e3) {
    return { ...(await sendReply(db, phone, text, now, fetcher)), como: 'texto común (escribió en las últimas 24 h, gratis)' };
  }
  let macReason: string;
  try {
    const { id } = await mac(db, phone, text);
    return { enviado: true, id, telefono: phone, como: 'WhatsApp del Mac (fuera de las 24 h, gratis)', mensaje: text };
  } catch (error) {
    if (!(error instanceof MacUnavailable)) throw error;
    macReason = error.message;
  }
  // Meta no acepta saltos de línea, tabulaciones ni más de 4 espacios seguidos dentro de una variable.
  const param = text.replace(/\s*\n\s*/g, ' ').replace(/\s{4,}/g, '   ');
  if (param.length > 900) throw new WriteError('Fuera de las 24 h el mensaje va en una plantilla: que tenga menos de 900 letras.');
  const name = greeting.trim() || 'qué tal';
  const release = await reserveSend(db, now, config);
  let result: any;
  try {
    const response = await fetcher(`${API}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `+${config.negocio}`, to: `+${phone}`, type: 'template',
        template: {
          name: FREE_TEMPLATE, language: { code: 'es' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: name.slice(0, 60) }, { type: 'text', text: param }] }],
        },
      }),
    });
    result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = String(result?.error?.message || response.status);
      throw new WriteError(/template/i.test(reason)
        ? `YCloud no lo envió (${reason}): la plantilla «${FREE_TEMPLATE}» tiene que estar aprobada por Meta.`
        : `YCloud no lo envió: ${reason}.`);
    }
  } catch (error) {
    await release();
    throw error;
  }
  const id = String(result.id || result.wamid || `api-${now.getTime()}`);
  const rendered = FREE_TEMPLATE_BODY.replace('{{1}}', name).replace('{{2}}', param);
  await db.collection(INBOX).doc(id).set({
    direction: 'out', source: 'api', phone, name: '', business: config.negocio, wamid: String(result.wamid || ''),
    replyTo: '', sentAt: now, receivedAt: now, handled: true, type: 'template', text: rendered, media: null,
  });
  return {
    enviado: true, id, estado: result.status || 'accepted', telefono: phone, como: `plantilla mensaje_cliente (fuera de las 24 h, se cobra; por el Mac no: ${macReason})`,
    mensaje: rendered, uso: await usage(db, now, config),
  };
};

/**
 * Avisos y recordatorios del reparto por WhatsApp del Mac, sin control de
 * pantalla (Jonathan, 23/11/2026). Las pasadas de las 9 y las 18 dependían del
 * permiso de pantalla de la tarea de la nube; esto usa lo mismo que
 * mandar_mensaje fuera de las 24 h (macSend): abre el chat con el borrador,
 * aprieta Enviar solo si el borrador es exactamente el texto y confirma que
 * salió a ese número en whatsappInbox. Nunca usa la API ni plantillas pagas.
 *
 * - No manda dos veces: si hoy ya salió ese mismo texto a ese número, devuelve
 *   «ya_enviado». Sirve para repetir una llamada que se cortó.
 * - «incierto» (se apretó Enviar y no apareció como enviado): queda anotado y no
 *   se reintenta solo; corta el lote para no seguir mandando a ciegas.
 * - Si el Mac no puede (pantalla bloqueada, sin permiso), no salió nada y corta
 *   el lote: lo que falta vuelve «sin_intentar».
 * - frenarDesde: si el cliente escribió desde esa hora, no manda y devuelve
 *   «escribio» con sus últimos mensajes (lo que antes se veía en la pantalla
 *   antes de apretar Enviar: ya respondió el aviso, ya hizo el pedido).
 * - Empieza envíos nuevos solo durante budgetMs, para que la llamada no se
 *   pase del tiempo de espera de quien la hizo.
 */
export const NOTICE_BATCH = 8;
const NOTICE_BUDGET_MS = 60_000;
const uncertainFile = () => join(env('RUTAWATER_ENVIAR_DIR', join(home, '.rutawater-mcp/enviar-whatsapp')), 'inciertos.json');
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export interface NoticeInput {
  telefono: string; texto: string; cliente?: string; reintentar?: boolean; frenarDesde?: Date;
  /** Mandarlo aunque el chat esté excluido de la API: Jonathan quiere que ese cliente reciba el aviso (27/11/2026). */
  aunqueExcluido?: boolean;
}
type NoticeState = 'enviado' | 'ya_enviado' | 'escribio' | 'no_enviado' | 'incierto' | 'excluido' | 'invalido' | 'sin_intentar';
export interface NoticeResult {
  telefono: string; cliente?: string; estado: NoticeState; id?: string; hora?: string; motivo?: string;
  mensajes_del_cliente?: Array<{ hora: string; tipo: string; texto: string }>;
}

export const sendNotices = async (
  db: Firestore, items: NoticeInput[], now = new Date(),
  mac: (db: Firestore, phone: string, text: string, confirm?: boolean) => Promise<{ id: string }> = sendViaMac,
  budgetMs = NOTICE_BUDGET_MS, retryPauseMs = 3_000,
) => {
  const excluded = await loadExcluded(db, localConfig());
  const started = Date.now();
  const day = uyIso(now).slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00-03:00`).getTime();
  const hour = (date: Date) => uyIso(date).slice(11, 16);
  // Envíos sin confirmar de hoy: { "<teléfono>|<huella del texto>": hora }.
  const saved = existsSync(uncertainFile()) ? JSON.parse(readFileSync(uncertainFile(), 'utf8')) : {};
  const uncertain: Record<string, string> = saved.dia === day ? saved.envios || {} : {};
  // Enviados hoy a chats excluidos de la API (sin registro en la bandeja).
  const blind: Record<string, string> = saved.dia === day ? saved.sin_confirmar || {} : {};
  const saveUncertain = () => {
    mkdirSync(join(uncertainFile(), '..'), { recursive: true });
    writeFileSync(uncertainFile(), JSON.stringify({ dia: day, envios: uncertain, sin_confirmar: blind }));
  };
  const results: NoticeResult[] = [];
  let stop = '';
  let macFailures = 0;
  for (const item of items) {
    const phone = fullPhone(item.telefono);
    const text = String(item.texto || '').trim();
    const base = { telefono: phone, ...(item.cliente ? { cliente: item.cliente } : {}) };
    if (phone.length < 10 || !text) {
      results.push({ ...base, estado: 'invalido', motivo: text ? 'Teléfono inválido: pasá el número con código de país (598…).' : 'El mensaje está vacío.' });
      continue;
    }
    const outside = isExcluded(excluded, phone);
    if (outside && !item.aunqueExcluido) { results.push({ ...base, estado: 'excluido', motivo: 'Ese chat está excluido: no se le escribe.' }); continue; }
    if (!stop && Date.now() - started > budgetMs) stop = 'se acabó el tiempo de esta llamada';
    if (stop) { results.push({ ...base, estado: 'sin_intentar', motivo: stop }); continue; }
    const key = `${phone}|${createHash('sha1').update(text).digest('hex').slice(0, 16)}`;
    // Un chat excluido no deja nada en la bandeja: no se puede ver si escribió ni confirmar el envío por la API.
    // Lo que salió hoy se anota acá para no repetirlo.
    if (outside) {
      if (blind[key]) { results.push({ ...base, estado: 'ya_enviado', hora: blind[key] }); continue; }
      if (!stop && Date.now() - started > budgetMs) stop = 'se acabó el tiempo de esta llamada';
      if (stop) { results.push({ ...base, estado: 'sin_intentar', motivo: stop }); continue; }
      try {
        await mac(db, phone, text, false);
        blind[key] = hour(new Date());
        saveUncertain();
        results.push({ ...base, estado: 'enviado', motivo: 'Chat excluido de la API: se apretó Enviar con el borrador exacto, sin confirmación por la API.' });
      } catch (error) {
        if (!(error instanceof MacUnavailable)) throw error;
        macFailures += 1;
        results.push({ ...base, estado: 'no_enviado', motivo: `${error.message}. No salió nada.` });
        if (!/borrador no coincide/.test(error.message) || macFailures >= 2) stop = `el Mac no pudo mandar (${error.message})`;
      }
      continue;
    }
    const chat = (await db.collection(INBOX).where('phone', '==', phone).get()).docs.map(readDoc).sort((a, b) => +a.sentAt - +b.sentAt);
    const already = chat.find((message) => message.direction === 'out' && +message.sentAt >= dayStart && String(message.text || '').trim() === text);
    if (already) {
      if (uncertain[key]) { delete uncertain[key]; saveUncertain(); }
      results.push({ ...base, estado: 'ya_enviado', id: already.id, hora: hour(already.sentAt) });
      continue;
    }
    const wrote = item.frenarDesde ? chat.filter((message) => message.direction === 'in' && +message.sentAt >= +item.frenarDesde!) : [];
    if (wrote.length) {
      results.push({
        ...base, estado: 'escribio', motivo: `Escribió desde las ${uyIso(item.frenarDesde!).slice(0, 16).replace('T', ' ')}: no se le mandó.`,
        mensajes_del_cliente: wrote.slice(-3).map((message) => ({ hora: uyIso(message.sentAt).slice(0, 16).replace('T', ' '), tipo: message.type, texto: String(message.text || '').slice(0, 200) })),
      });
      continue;
    }
    if (uncertain[key] && !item.reintentar) {
      results.push({ ...base, estado: 'incierto', motivo: `Se apretó Enviar a las ${uncertain[key]} y todavía no figura como enviado. No se reintenta solo: mirá el chat o consultale a Jonathan y, solo si no salió, repetilo con reintentar=true.` });
      continue;
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { id } = await mac(db, phone, text);
        if (uncertain[key]) { delete uncertain[key]; saveUncertain(); }
        macFailures = 0;
        results.push({ ...base, estado: 'enviado', id });
      } catch (error) {
        if (error instanceof MacUnavailable) {
          // No se apretó Enviar: no salió nada. El chat a veces tarda en cambiar
          // y el borrador todavía no está: un segundo intento alcanza.
          const draft = /borrador no coincide/.test(error.message);
          if (draft && attempt === 0) { await wait(retryPauseMs); continue; }
          macFailures += 1;
          results.push({ ...base, estado: 'no_enviado', motivo: draft
            ? `${error.message}. No salió nada: el chat tiene otro borrador (borralo en WhatsApp o pasáselo a Jonathan).`
            : `${error.message}. No salió nada.` });
          if (!draft || macFailures >= 2) stop = `el Mac no pudo mandar (${error.message})`;
        } else if (error instanceof WriteError) {
          uncertain[key] = hour(new Date());
          saveUncertain();
          results.push({ ...base, estado: 'incierto', motivo: `${error.message}` });
          stop = 'un envío quedó sin confirmar';
        } else {
          throw error;
        }
      }
      break;
    }
  }
  const count = (state: NoticeState) => results.filter((result) => result.estado === state).length;
  const pending = Object.keys(uncertain).length;
  return {
    resultados: results,
    resumen: {
      enviados: count('enviado'), ya_enviados: count('ya_enviado'), escribieron: count('escribio'), no_enviados: count('no_enviado'), inciertos: count('incierto'),
      excluidos: count('excluido'), invalidos: count('invalido'), sin_intentar: count('sin_intentar'),
    },
    seguir: stop
      ? `Corté el lote: ${stop}. ${stop.startsWith('se acabó') ? 'Volvé a llamar con los «sin_intentar».' : 'Resolvé eso antes de mandar los «sin_intentar» (si es la pantalla bloqueada o un permiso, avisale a Jonathan).'}`
      : 'Lote completo.',
    ...(pending >= 2 ? { alerta: `Hoy hay ${pending} envíos sin confirmar: puede que no esté llegando el registro de lo que sale. Pará y avisale a Jonathan.` } : {}),
  };
};

const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const nameWords = (value: string) => normalizeName(value).split(/[^a-zñ]+/).filter((word) => word.length >= 3);

/** Teléfono con código de país: un celular uruguayo 09… pasa a 5989…. */
const fullPhone = (value: string) => {
  const phone = digits(value);
  return phone.length === 9 && phone.startsWith('09') ? `598${phone.slice(1)}` : phone;
};

/**
 * Excluye un chat que no es de clientes (Jonathan, 27/10/2026: un amigo, un
 * familiar): lo suma a la lista de la base, que leen el webhook y este servidor,
 * y borra de la bandeja lo que ya se había guardado de ese chat (el chat sigue
 * intacto en WhatsApp). Si el teléfono es de una ficha de RutaWater pide
 * confirmarlo, para no dejar de atender a un cliente. Con deshacer lo vuelve a
 * incluir (lo borrado no vuelve).
 */
export const excludeChat = async (
  db: Firestore,
  clients: Client[],
  input: { telefono?: string; nombre?: string; motivo?: string; aunque_sea_cliente?: boolean; deshacer?: boolean },
  now = new Date(),
) => {
  const config = localConfig();
  let phone = fullPhone(input.telefono || '');
  let profile = '';
  if (!phone) {
    const wanted = normalizeName(input.nombre || '');
    if (!wanted) throw new WriteError('Pasá el teléfono o el nombre del chat.');
    const excluded = await loadExcluded(db, config);
    const recent = (await db.collection(INBOX).where('sentAt', '>=', new Date(now.getTime() - NAME_SEARCH_MS)).get()).docs
      .map(readDoc).filter((message) => message.direction === 'in' && !isExcluded(excluded, message.phone));
    // El perfil puede ser un apodo («Lucho_Arriola24» por «Luciano Arriola»): si
    // el nombre entero no aparece, alcanza con una de sus palabras; si eso da más
    // de un chat, se pide el teléfono.
    const byName = (match: (name: string) => boolean) =>
      [...new Map(recent.filter((message) => match(message.name || '')).map((message) => [message.phone, message.name])).entries()];
    let found = byName((name) => normalizeName(name).includes(wanted));
    if (!found.length) found = byName((name) => nameWords(name).some((word) => nameWords(wanted).includes(word)));
    if (!found.length) throw new WriteError(`No hay mensajes de «${input.nombre}» en los últimos 14 días: pasá el teléfono.`);
    if (found.length > 1) {
      throw new WriteError(`Hay ${found.length} chats con ese nombre (${found.map(([p, n]) => `${n} …${p.slice(-4)}`).join(', ')}): pasá el teléfono.`);
    }
    [[phone, profile]] = found;
  }
  if (phone.length < 10) throw new WriteError('Teléfono inválido: pasá el número con código de país (598…).');
  if (last8(phone) === last8(config.negocio)) throw new WriteError('Ese es el número del negocio.');
  const ref = excludedRef(db);
  if (input.deshacer) {
    const stored = ((await ref.get()).data()?.phones || []) as string[];
    const matches = stored.filter((entry) => last8(entry) === last8(phone));
    if (!matches.length) {
      const fixed = config.excluidos.some((entry) => last8(entry) === last8(phone));
      throw new WriteError(fixed ? 'Ese chat está en whatsapp.json y en Netlify: se saca a mano de los dos.' : 'Ese chat no estaba excluido.');
    }
    await ref.set({
      phones: FieldValue.arrayRemove(...matches),
      ...Object.fromEntries(matches.map((entry) => [`detalle.${entry}`, FieldValue.delete()])),
      updatedAt: now,
    }, { merge: true });
    return { vuelve_a_incluirse: phone, nota: 'Sus mensajes nuevos vuelven a llegar; los que se borraron no vuelven.' };
  }
  const fichas = clientsByPhone(clients, phone);
  if (fichas.length && !input.aunque_sea_cliente) {
    throw new WriteError(`Ese teléfono es de ${fichas.map((ficha) => `${ficha.nombre} (${ficha.direccion})`).join(', ')}: confirmalo con Jonathan y pasá aunque_sea_cliente=true.`);
  }
  await ref.set({
    phones: FieldValue.arrayUnion(phone),
    detalle: { [phone]: { nombre: profile || input.nombre || '', motivo: input.motivo || '', fecha: now } },
    updatedAt: now,
  }, { merge: true });
  const stored = await db.collection(INBOX).where('phone', '==', phone).get();
  for (let index = 0; index < stored.docs.length; index += 400) {
    const batch = db.batch();
    stored.docs.slice(index, index + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  return { excluido: phone, nombre: profile || input.nombre || '', mensajes_borrados_de_la_bandeja: stored.size, fichas };
};

/** Baja con la clave los audios de esos mensajes y los transcribe con Whisper en el Mac. */
export const transcribeInboxAudios = async (db: Firestore, ids: string[], fetcher = fetch) => {
  const snaps = await db.getAll(...ids.map((id) => db.collection(INBOX).doc(id)));
  const audios = snaps.filter((snap) => snap.exists).map(readDoc).filter((message) => message.type === 'audio' && message.media?.link);
  if (!audios.length) throw new WriteError('Esos mensajes no son audios con archivo.');
  const work = mkdtempSync(join(tmpdir(), 'rutawater-wa-audio-'));
  try {
    const files: Array<{ id: string; file: string }> = [];
    for (const message of audios) {
      const response = await fetcher(message.media!.link, { headers: { 'X-API-Key': apiKey() } });
      if (!response.ok) throw new WriteError(`No se pudo bajar el audio ${message.id} (${response.status}).`);
      // El script lee la hora del nombre, como en los que se guardan desde WhatsApp.
      const stamp = uyIso(message.sentAt);
      const name = `WhatsApp Audio ${stamp.slice(0, 10)} at ${stamp.slice(11, 19).replace(/:/g, '.')} ${message.id.slice(-6)}.ogg`;
      writeFileSync(join(work, name), Buffer.from(await response.arrayBuffer()));
      files.push({ id: message.id, file: name });
    }
    const results = await runScript(files.map(({ file }) => join(work, file)), work);
    return results.map((result) => ({ id: files.find(({ file }) => file === result.archivo)?.id, ...result }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/** Baja una foto o documento (comprobante) a una carpeta temporal para mirarlo; devuelve la ruta. */
export const downloadInboxMedia = async (db: Firestore, id: string, fetcher = fetch) => {
  const snap = await db.collection(INBOX).doc(id).get();
  if (!snap.exists) throw new WriteError(`No existe el mensaje ${id}.`);
  const message = readDoc(snap);
  if (!message.media?.link) throw new WriteError('Ese mensaje no tiene archivo.');
  const response = await fetcher(message.media.link, { headers: { 'X-API-Key': apiKey() } });
  if (!response.ok) throw new WriteError(`No se pudo bajar el archivo (${response.status}).`);
  const extension = (message.media.mime.split('/')[1] || 'bin').replace('jpeg', 'jpg').split(';')[0];
  const dir = mkdtempSync(join(tmpdir(), 'rutawater-wa-media-'));
  const path = join(dir, message.media.filename || `${message.id}.${extension}`);
  const data = Buffer.from(await response.arrayBuffer());
  writeFileSync(path, data);
  // Las fotos vuelven también como imagen: en la nube la ruta del Mac no se puede abrir.
  return { id, tipo: message.type, mime: message.media.mime, archivo: path, texto: message.text, data };
};

const AQUAPURA_TEMPLATE = 'comprobante_cliente_brou';

/** Reserva un envío en el contador del mes; devuelve cómo devolverlo si el envío falla. */
const reserveSend = async (db: Firestore, now: Date, config: LocalConfig) => {
  const usageRef = db.collection(USAGE).doc(monthKey(now));
  await db.runTransaction(async (transaction) => {
    const sent = Number((await transaction.get(usageRef)).data()?.sent || 0);
    if (sent >= config.tope_mes) throw new WriteError(`Se llegó al tope de ${config.tope_mes} mensajes por API este mes: hacerlo desde la app en el Mac.`);
    transaction.set(usageRef, { sent: sent + 1, updatedAt: now }, { merge: true });
  });
  return () => db.runTransaction(async (transaction) => {
    const sent = Number((await transaction.get(usageRef)).data()?.sent || 0);
    transaction.set(usageRef, { sent: Math.max(0, sent - 1) }, { merge: true });
  });
};

/**
 * Le manda a Aquapura el comprobante de una transferencia a su cuenta BROU
 * (Jonathan, 24/10/2026). Si Aquapura escribió en las últimas 24 h (lo anota el
 * webhook en whatsappWindows), va solo el archivo, gratis; si no, con la
 * plantilla de utilidad «comprobante_cliente_brou» (cliente y monto), que se
 * cobra como utilidad. Nunca reenvía lo que escribió el cliente.
 */
export const forwardReceiptToAquapura = async (
  db: Firestore, id: string, cliente: string, monto: number, now = new Date(), fetcher = fetch,
) => {
  const config = localConfig();
  if (!config.negocio || !config.aquapura) throw new WriteError(`Faltan «negocio» o «aquapura» en ${configFile()}.`);
  const snap = await db.collection(INBOX).doc(id).get();
  if (!snap.exists) throw new WriteError(`No existe el mensaje ${id}.`);
  const message = readDoc(snap);
  if (!message.media?.link || !['document', 'image'].includes(message.type)) throw new WriteError('Ese mensaje no es un comprobante (foto o PDF).');
  const download = await fetcher(message.media.link, { headers: { 'X-API-Key': apiKey() } });
  if (!download.ok) throw new WriteError(`No se pudo bajar el comprobante (${download.status}).`);
  const mime = message.media.mime.split(';')[0] || 'application/pdf';
  const filename = message.media.filename || `comprobante.${message.type === 'image' ? 'jpg' : 'pdf'}`;
  const form = new FormData();
  form.append('file', new Blob([await download.arrayBuffer()], { type: mime }), filename);
  const upload = await fetcher(`${API}/whatsapp/media/${encodeURIComponent(`+${config.negocio}`)}/upload`, {
    method: 'POST', headers: { 'X-API-Key': apiKey() }, body: form,
  });
  const uploaded: any = await upload.json().catch(() => ({}));
  if (!upload.ok || !uploaded.id) throw new WriteError(`YCloud no aceptó el archivo: ${uploaded?.error?.message || upload.status}.`);

  const window = (await db.collection('whatsappWindows').doc(config.aquapura).get()).data();
  const lastIn = window?.lastInboundAt ? toDate(window.lastInboundAt).getTime() : 0;
  const free = now.getTime() - lastIn < WINDOW_MS - 10 * 60e3;
  const media = message.type === 'image' ? { image: { id: uploaded.id } } : { document: { id: uploaded.id, filename } };
  const body = free
    ? { from: `+${config.negocio}`, to: `+${config.aquapura}`, type: message.type, ...media }
    : {
      from: `+${config.negocio}`, to: `+${config.aquapura}`, type: 'template',
      template: {
        name: AQUAPURA_TEMPLATE, language: { code: 'es' },
        components: [
          { type: 'header', parameters: [{ type: message.type === 'image' ? 'image' : 'document', ...media }] },
          { type: 'body', parameters: [{ type: 'text', text: cliente.slice(0, 60) }, { type: 'text', text: String(monto) }] },
        ],
      },
    };
  const release = await reserveSend(db, now, config);
  let result: any;
  try {
    const response = await fetcher(`${API}/whatsapp/messages/sendDirectly`, {
      method: 'POST', headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    result = await response.json().catch(() => ({}));
    if (!response.ok) throw new WriteError(`YCloud no lo envió: ${result?.error?.message || response.status}. Reenviarlo por la app en el Mac.`);
  } catch (error) {
    await release();
    throw error;
  }
  return { enviado: true, id: result.id || '', como: free ? 'solo el archivo (ventana abierta, gratis)' : 'plantilla de utilidad (se cobra)', estado: result.status || 'accepted' };
};
