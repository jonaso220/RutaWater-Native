import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { Client } from '../../src/types';
import { getClientPhones } from '../../src/utils/clientPhones';
import { runScript } from './audio';
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

const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

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
      .map(readDoc).filter((message) => message.direction === 'in' && !isExcluded(excluded, message.phone)
        && normalizeName(message.name || '').includes(wanted));
    const found = [...new Map(recent.map((message) => [message.phone, message.name])).entries()];
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
