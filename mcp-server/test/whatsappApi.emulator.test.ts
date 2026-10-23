process.env.TZ = 'America/Montevideo';
process.env.FIREBASE_PROJECT_ID = 'demo-rutawater';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rutawater-wa-test-'));
process.env.RUTAWATER_WHATSAPP_CONFIG = path.join(dir, 'whatsapp.json');
process.env.RUTAWATER_YCLOUD_KEY = path.join(dir, 'ycloud.key');
fs.writeFileSync(process.env.RUTAWATER_WHATSAPP_CONFIG, JSON.stringify({ negocio: '59891667066', excluidos: ['099111222'], tope_mes: 2 }));
fs.writeFileSync(process.env.RUTAWATER_YCLOUD_KEY, 'test-key\n');

// eslint-disable-next-line import/first
import { getDb } from '../src/config';
// eslint-disable-next-line import/first
import { markHandled, readInbox, sendReply } from '../src/whatsappApi';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;

const NOW = new Date('2026-10-23T15:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60e3);

const message = (id: string, data: Record<string, unknown>) => ({
  direction: 'in', phone: '59899123456', name: 'Rosa', business: '59891667066', wamid: `wamid.${id}`, replyTo: '',
  sentAt: minutesAgo(10), receivedAt: NOW, handled: false, type: 'text', text: '', media: null, ...data,
});

const okFetch = (body: Record<string, unknown> = { id: 'sent1', status: 'accepted' }) =>
  jest.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describeWithEmulator('WhatsApp por la API', () => {
  let db: Firestore;
  beforeAll(() => { db = getDb(); });
  beforeEach(async () => {
    await fetch(`http://${emulator}/emulator/v1/projects/demo-rutawater/databases/(default)/documents`, { method: 'DELETE' });
    const batch = db.batch();
    batch.set(db.doc('whatsappInbox/m1'), message('m1', { text: 'Hola', sentAt: minutesAgo(30) }));
    batch.set(db.doc('whatsappInbox/m2'), message('m2', { text: 'Mañana 2 de 20' }));
    batch.set(db.doc('whatsappInbox/o1'), message('o1', { direction: 'out', handled: true, text: 'Mañana pasamos', sentAt: minutesAgo(600) }));
    batch.set(db.doc('whatsappInbox/viejo'), message('viejo', { phone: '59898000000', name: 'Ana', text: 'Gracias', sentAt: minutesAgo(26 * 60) }));
    batch.set(db.doc('whatsappInbox/excl'), message('excl', { phone: '59899111222', text: 'privado' }));
    await batch.commit();
  });

  test('leer: pendientes por chat con su conversación, fichas y ventana; sin excluidos', async () => {
    const clients = [{ id: 'rosa', name: 'Rosa Jerez', address: 'Calle 26', freq: 'weekly', phone: '099 123 456', phones: [] }] as any;
    const { chats, uso } = await readInbox(db, clients, NOW);
    expect(chats.map((chat) => chat.telefono)).toEqual(['59898000000', '59899123456']);
    const rosa = chats[1];
    expect(rosa.fichas).toEqual([{ id: 'rosa', nombre: 'Rosa Jerez', direccion: 'Calle 26', frecuencia: 'weekly' }]);
    expect(rosa.pendientes.map((entry) => entry.texto)).toEqual(['Hola', 'Mañana 2 de 20']);
    expect(rosa.conversacion.map((entry) => entry.de)).toEqual(['nosotros (app)', 'cliente', 'cliente']);
    expect(rosa.responder_hasta).toBe('2026-10-24 11:50');
    expect(uso).toEqual({ mes: '2026-10', respuestas_api: 0, tope: 2, quedan: 2 });
  });

  test('responder: dentro de las 24 h, cuenta el uso y corta en el tope', async () => {
    const fetcher = okFetch();
    const sent = await sendReply(db, '59899123456', 'Bárbaro, quedó agendado', NOW, fetcher);
    expect(sent).toMatchObject({ enviado: true, id: 'sent1', uso: { respuestas_api: 1, quedan: 1 } });
    const [url, init] = (fetcher as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/whatsapp\/messages\/sendDirectly$/);
    expect(JSON.parse(init.body)).toEqual({ from: '+59891667066', to: '+59899123456', type: 'text', text: { body: 'Bárbaro, quedó agendado' } });
    expect((await db.doc('whatsappInbox/sent1').get()).data()).toMatchObject({ direction: 'out', source: 'api', handled: true });

    await sendReply(db, '59899123456', 'Otra', NOW, okFetch({ id: 'sent2' }));
    await expect(sendReply(db, '59899123456', 'Tercera', NOW, okFetch({ id: 'sent3' }))).rejects.toThrow('tope');
  });

  test('responder: rechaza fuera de la ventana, excluidos y no cuenta un envío fallido', async () => {
    await expect(sendReply(db, '59898000000', 'Hola', NOW, okFetch())).rejects.toThrow('24 h');
    await expect(sendReply(db, '59899111222', 'Hola', NOW, okFetch())).rejects.toThrow('excluido');
    const failing = jest.fn(async () => new Response(JSON.stringify({ error: { message: 'no' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(sendReply(db, '59899123456', 'Hola', NOW, failing)).rejects.toThrow('no lo envió');
    expect((await db.doc('whatsappUsage/2026-10').get()).data()?.sent).toBe(0);
  });

  test('atendido: sale de la lista y marca leído el último de cada chat', async () => {
    const fetcher = jest.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const result = await markHandled(db, ['m1', 'm2', 'nada'], true, fetcher);
    expect(result).toEqual({ atendidos: 2, no_encontrados: ['nada'], leidos_en_whatsapp: ['59899123456'] });
    expect((fetcher as jest.Mock).mock.calls.map(([url]) => url)).toEqual([expect.stringContaining('/inboundMessages/wamid.m2/markAsRead')]);
    const { chats } = await readInbox(db, [], NOW);
    expect(chats.map((chat) => chat.telefono)).toEqual(['59898000000']);
  });
});
