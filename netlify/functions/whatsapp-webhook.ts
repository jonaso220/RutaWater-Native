import { createHmac, timingSafeEqual } from 'crypto';
import type { Config } from '@netlify/functions';
import type { Firestore } from 'firebase-admin/firestore';
import { EnvironmentReader, getAdminFirestore } from './_shared/firebaseAdmin';

// Receptor de los webhooks de YCloud para el WhatsApp Business de Jonathan
// (coexistencia: el mismo número sigue en la app). Guarda en whatsappInbox los
// mensajes que mandan los clientes y los que Jonathan manda desde la app, para
// que el servidor MCP los lea sin abrir WhatsApp en la Mac. Los chats excluidos
// (WHATSAPP_EXCLUDED_PHONES) y los grupos no se guardan. La colección no tiene
// reglas: solo se accede con la cuenta de servicio.

export const INBOX = 'whatsappInbox';
// Solo la hora del último mensaje de los chats excluidos, sin contenido: con eso
// se sabe si su ventana de 24 h está abierta (p. ej. para mandarle a Aquapura un
// comprobante gratis).
export const WINDOWS = 'whatsappWindows';
const TOLERANCE_SECONDS = 300;

const digits = (value: unknown): string => String(value || '').replace(/\D/g, '');

/** YCloud-Signature: t=<segundos>,s=<hex de HMAC-SHA256 de «t.body»>. */
export const validSignature = (header: string | null, body: string, secret: string, nowSeconds: number): boolean => {
  const parts = Object.fromEntries((header || '').split(',').map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const timestamp = Number(parts.t);
  if (!parts.s || !Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${body}`).digest('hex');
  const received = Buffer.from(parts.s, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return received.length === wanted.length && timingSafeEqual(received, wanted);
};

interface Media { id?: string; link?: string; mime_type?: string; caption?: string; filename?: string }

/** Lo que se guarda de un mensaje: texto o pie de foto y, si hay, el archivo para bajarlo con la clave. */
const content = (message: Record<string, any>) => {
  const type = String(message.type || '');
  const media: Media | undefined = ['image', 'audio', 'video', 'document', 'sticker'].includes(type) ? message[type] : undefined;
  const text = message.text?.body
    || media?.caption
    || message.button?.text
    || message.interactive?.button_reply?.title
    || message.interactive?.list_reply?.title
    || (message.reaction ? `reacción ${message.reaction.emoji || ''}`.trim() : '')
    || (message.location ? `ubicación ${message.location.latitude},${message.location.longitude}` : '')
    || '';
  return {
    type,
    text: String(text).slice(0, 4000),
    media: media ? {
      id: media.id || '', link: media.link || '', mime: media.mime_type || '', filename: media.filename || '',
    } : null,
  };
};

export interface InboxRecord {
  id: string;
  direction: 'in' | 'out';
  phone: string;
  name: string;
  business: string;
  wamid: string;
  replyTo: string;
  sentAt: Date;
  receivedAt: Date;
  handled: boolean;
  type: string;
  text: string;
  media: { id: string; link: string; mime: string; filename: string } | null;
}

/**
 * Convierte un evento en lo que se guarda, o null si no interesa: solo
 * mensajes entrantes (whatsapp.inbound_message.received) y los que salen desde
 * la app de WhatsApp Business (whatsapp.smb.message.created; .echoes por si
 * YCloud lo manda con ese nombre, el id evita guardarlo dos veces). Los que manda la
 * API ya los registra el servidor MCP.
 */
export const toRecord = (event: Record<string, any>, excluded: Set<string>, now: Date): InboxRecord | null => {
  let message: Record<string, any> | undefined;
  let direction: 'in' | 'out';
  if (event.type === 'whatsapp.inbound_message.received') {
    message = event.whatsappInboundMessage;
    direction = 'in';
  } else if (event.type === 'whatsapp.smb.message.created' || event.type === 'whatsapp.smb.message.echoes') {
    message = event.whatsappMessage;
    direction = 'out';
  } else {
    return null;
  }
  if (!message || message.groupId) return null;
  const phone = digits(direction === 'in' ? message.from : message.to);
  const business = digits(direction === 'in' ? message.to : message.from);
  if (!phone || excluded.has(phone) || excluded.has(phone.slice(-8))) return null;
  const sent = new Date(message.sendTime || message.createTime || event.createTime || now);
  return {
    id: String(message.id || message.wamid || event.id),
    direction,
    phone,
    name: String(message.customerProfile?.name || ''),
    business,
    wamid: String(message.wamid || ''),
    replyTo: String(message.context?.id || ''),
    sentAt: Number.isNaN(sent.getTime()) ? now : sent,
    receivedAt: now,
    handled: direction === 'out',
    ...content(message),
  };
};

/** Teléfono del cliente de un mensaje entrante de un chat excluido (fuera de grupos), o null. */
export const excludedInbound = (event: Record<string, any>, excluded: Set<string>): string | null => {
  if (event.type !== 'whatsapp.inbound_message.received') return null;
  const message = event.whatsappInboundMessage;
  const phone = digits(message?.from);
  if (!message || message.groupId || !phone) return null;
  return excluded.has(phone) || excluded.has(phone.slice(-8)) ? phone : null;
};

export const excludedPhones = (value: string | undefined): Set<string> => {
  const set = new Set<string>();
  (value || '').split(',').map(digits).filter(Boolean).forEach((phone) => {
    set.add(phone);
    set.add(phone.slice(-8));
  });
  return set;
};

interface WebhookDependencies {
  readEnvironment: EnvironmentReader;
  getFirestore: (readEnvironment: EnvironmentReader) => Firestore;
  now: () => Date;
}

export const createWhatsappWebhookHandler = (dependencies: WebhookDependencies) => async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const secret = dependencies.readEnvironment('YCLOUD_WEBHOOK_SECRET');
  if (!secret) return new Response(null, { status: 503 });
  const body = await request.text();
  const now = dependencies.now();
  if (!validSignature(request.headers.get('ycloud-signature'), body, secret, Math.floor(now.getTime() / 1000))) {
    return new Response(null, { status: 401 });
  }
  let event: Record<string, any>;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const excluded = excludedPhones(dependencies.readEnvironment('WHATSAPP_EXCLUDED_PHONES'));
  const record = toRecord(event, excluded, now);
  const windowPhone = record ? null : excludedInbound(event, excluded);
  // Solo el tipo de evento y qué se hizo: nunca teléfonos ni contenido.
  console.log('whatsapp-webhook', String(event.type || '?'), record ? `guardado ${record.direction}` : (windowPhone ? 'ventana' : 'descartado'));
  if (windowPhone) {
    try {
      await dependencies.getFirestore(dependencies.readEnvironment).collection(WINDOWS).doc(windowPhone).set({ lastInboundAt: now });
    } catch (error) {
      console.error('whatsapp-webhook error:', error instanceof Error ? error.name : 'unknown');
      return new Response(null, { status: 500 });
    }
    return new Response(null, { status: 200 });
  }
  if (!record) return new Response(null, { status: 204 });
  try {
    const db = dependencies.getFirestore(dependencies.readEnvironment);
    // YCloud puede repetir un evento: el id del mensaje evita duplicarlo.
    await db.collection(INBOX).doc(record.id).create(record);
  } catch (error) {
    if ((error as { code?: unknown })?.code === 6) return new Response(null, { status: 200 });
    // Nunca registrar el contenido ni el teléfono.
    console.error('whatsapp-webhook error:', error instanceof Error ? error.name : 'unknown');
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
};

export default createWhatsappWebhookHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  getFirestore: getAdminFirestore,
  now: () => new Date(),
});

export const config: Config = {
  path: '/api/whatsapp-webhook',
};
