process.env.TZ = 'America/Montevideo';
process.env.FIREBASE_PROJECT_ID = 'demo-rutawater';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rutawater-wa-test-'));
process.env.RUTAWATER_WHATSAPP_CONFIG = path.join(dir, 'whatsapp.json');
process.env.RUTAWATER_YCLOUD_KEY = path.join(dir, 'ycloud.key');
process.env.RUTAWATER_ENVIAR_DIR = path.join(dir, 'enviar');
fs.writeFileSync(process.env.RUTAWATER_WHATSAPP_CONFIG, JSON.stringify({ negocio: '59891667066', excluidos: ['099111222'], tope_mes: 2, aquapura: '59892684859' }));
fs.writeFileSync(process.env.RUTAWATER_YCLOUD_KEY, 'test-key\n');

// eslint-disable-next-line import/first
import { getDb } from '../src/config';
// eslint-disable-next-line import/first
import { excludeChat, forwardReceiptToAquapura, markHandled, readChat, readInbox, sendMessage, sendNotices, sendReply } from '../src/whatsappApi';
// eslint-disable-next-line import/first
import { WriteError } from '../src/writes';
// eslint-disable-next-line import/first
import { MacUnavailable } from '../src/macSend';

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

  test('leer un chat: trae lo ya atendido, respeta los días, no marca nada y nunca un excluido', async () => {
    await db.doc('whatsappInbox/m1').update({ handled: true });
    await db.doc('whatsappInbox/antiguo').set(message('antiguo', { text: 'Del mes pasado', handled: true, sentAt: minutesAgo(40 * 24 * 60) }));
    const clients = [{ id: 'rosa', name: 'Rosa Jerez', address: 'Calle 26', freq: 'weekly', phone: '099 123 456', phones: [] }] as any;
    const chat = await readChat(db, clients, '099123456', 14, NOW);
    expect(chat.telefono).toBe('59899123456');
    expect(chat.fichas.map((ficha) => ficha.id)).toEqual(['rosa']);
    expect(chat.mensajes.map((entry) => [entry.texto, entry.atendido])).toEqual([
      ['Mañana pasamos', true], ['Hola', true], ['Mañana 2 de 20', false],
    ]);
    expect(chat).toMatchObject({ sin_atender: 1, ultimo_del_cliente: '2026-10-23 11:50', ultimo_nuestro: '2026-10-23 02:00', responder_hasta: '2026-10-24 11:50' });
    expect((await db.doc('whatsappInbox/m2').get()).data()).toMatchObject({ handled: false });
    const empty = await readChat(db, [], '59897000000', 14, NOW);
    expect(empty).toMatchObject({ mensajes: [], sin_atender: 0, ultimo_del_cliente: null, responder_hasta: null });
    await expect(readChat(db, [], '099111222', 14, NOW)).rejects.toThrow(/excluido/);
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

  const noMac = jest.fn(async () => { throw new MacUnavailable('la pantalla del Mac está bloqueada'); });

  test('mensaje de Jonathan: texto común con la ventana abierta, plantilla en blanco si no', async () => {
    const open = okFetch({ id: 'out1' });
    const inside = await sendMessage(db, '099123456', 'Mañana pasamos a las 10', 'Rosa', NOW, open, noMac);
    expect(noMac).not.toHaveBeenCalled();
    expect(inside).toMatchObject({ enviado: true, como: expect.stringContaining('texto común') });
    expect(JSON.parse((open as jest.Mock).mock.calls[0][1].body)).toMatchObject({ type: 'text', text: { body: 'Mañana pasamos a las 10' } });

    const closed = okFetch({ id: 'out2' });
    const outside = await sendMessage(db, '59898000000', 'El lunes no pasamos.\nPasamos el martes', 'Ana', NOW, closed, noMac);
    expect(outside.como).toContain('pantalla del Mac está bloqueada');
    expect(outside.mensaje).toBe('Hola Ana, te escribo por el agua: El lunes no pasamos. Pasamos el martes\n\nCualquier cosa, respondeme por acá. ¡Gracias!');
    expect(JSON.parse((closed as jest.Mock).mock.calls[0][1].body).template).toEqual({
      name: 'mensaje_cliente', language: { code: 'es' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'El lunes no pasamos. Pasamos el martes' }] }],
    });
    expect((await db.doc('whatsappInbox/out2').get()).data()).toMatchObject({ direction: 'out', type: 'template', handled: true });
    await expect(sendMessage(db, '099111222', 'Hola', 'X', NOW, okFetch(), noMac)).rejects.toThrow('excluido');
  });

  test('mensaje de Jonathan: fuera de las 24 h va por el Mac, gratis; si no se confirma, no usa la plantilla', async () => {
    const api = okFetch();
    const viaMac = await sendMessage(db, '59898000000', 'El lunes no pasamos.\nPasamos el martes', 'Ana', NOW, api, async () => ({ id: 'mac1' }));
    expect(viaMac).toMatchObject({ id: 'mac1', como: expect.stringContaining('WhatsApp del Mac'), mensaje: 'El lunes no pasamos.\nPasamos el martes' });
    expect(api).not.toHaveBeenCalled();
    const unconfirmed = async () => { throw new Error('no apareció enviado'); };
    await expect(sendMessage(db, '59898000000', 'Hola', 'Ana', NOW, api, unconfirmed)).rejects.toThrow('no apareció');
    expect(api).not.toHaveBeenCalled();
  });

  describe('avisos por WhatsApp del Mac', () => {
    const AVISO = 'Buenas 👋 Te escribo para recordarte que mañana andaremos por tu casa 🚛💧\n\n¡Saludos! 😃';
    // Como el Mac de verdad: lo que sale queda en la bandeja (lo guarda el webhook).
    const macOk = () => jest.fn(async (database: Firestore, phone: string, text: string) => {
      const id = `mac-${phone}-${Date.now()}-${Math.random()}`;
      await database.doc(`whatsappInbox/${id}`).set(message(id, { direction: 'out', handled: true, phone, text, sentAt: NOW }));
      return { id };
    });
    beforeEach(() => { fs.rmSync(path.join(dir, 'enviar'), { recursive: true, force: true }); });

    test('manda cada uno una sola vez: repetir la llamada no duplica', async () => {
      const mac = macOk();
      const items = [{ telefono: '099123456', texto: AVISO, cliente: 'Rosa' }, { telefono: '59898000000', texto: AVISO, cliente: 'Ana' }];
      const first = await sendNotices(db, items, NOW, mac);
      expect(first.resultados.map((entry) => [entry.telefono, entry.cliente, entry.estado])).toEqual([['59899123456', 'Rosa', 'enviado'], ['59898000000', 'Ana', 'enviado']]);
      expect(first.seguir).toBe('Lote completo.');
      expect(mac.mock.calls.map((call) => [call[1], call[2]])).toEqual([['59899123456', AVISO], ['59898000000', AVISO]]);
      const again = await sendNotices(db, items, NOW, mac);
      expect(again.resumen).toMatchObject({ enviados: 0, ya_enviados: 2 });
      expect(mac).toHaveBeenCalledTimes(2);
      // Otro texto al mismo número sí sale (el recordatorio de las 18 después del aviso).
      const reminder = await sendNotices(db, [{ telefono: '59899123456', texto: 'Recordatorio' }], NOW, mac);
      expect(reminder.resumen.enviados).toBe(1);
    });

    test('el mismo texto de ayer no cuenta como enviado hoy', async () => {
      await db.doc('whatsappInbox/ayer').set(message('ayer', { direction: 'out', handled: true, text: AVISO, sentAt: minutesAgo(24 * 60) }));
      const mac = macOk();
      expect((await sendNotices(db, [{ telefono: '59899123456', texto: AVISO }], NOW, mac)).resumen.enviados).toBe(1);
    });

    test('excluidos e inválidos no se mandan y no frenan al resto', async () => {
      const mac = macOk();
      const result = await sendNotices(db, [
        { telefono: '099111222', texto: AVISO }, { telefono: '123', texto: AVISO }, { telefono: '59898000000', texto: '  ' }, { telefono: '59898000000', texto: AVISO },
      ], NOW, mac);
      expect(result.resultados.map((entry) => entry.estado)).toEqual(['excluido', 'invalido', 'invalido', 'enviado']);
      expect(mac).toHaveBeenCalledTimes(1);
    });

    test('un chat excluido recibe el aviso solo si se pide, sin confirmación y una sola vez', async () => {
      const mac = jest.fn(async () => ({ id: '' }));
      const item = { telefono: '099111222', texto: AVISO, cliente: 'Excluida', aunqueExcluido: true };
      const first = await sendNotices(db, [item, { telefono: '099111222', texto: AVISO }], NOW, mac);
      expect(first.resultados.map((entry) => entry.estado)).toEqual(['enviado', 'excluido']);
      expect(mac.mock.calls.map((call: unknown[]) => [call[1], call[3]])).toEqual([['59899111222', false]]);
      const again = await sendNotices(db, [item], NOW, mac);
      expect(again.resultados.map((entry) => entry.estado)).toEqual(['ya_enviado']);
      expect(mac).toHaveBeenCalledTimes(1);
    });

    test('pantalla bloqueada: no sale nada y corta el lote', async () => {
      const locked = jest.fn(async () => { throw new MacUnavailable('la pantalla del Mac está bloqueada'); });
      const result = await sendNotices(db, [{ telefono: '59899123456', texto: AVISO }, { telefono: '59898000000', texto: AVISO }], NOW, locked);
      expect(result.resultados.map((entry) => entry.estado)).toEqual(['no_enviado', 'sin_intentar']);
      expect(result.seguir).toContain('pantalla del Mac está bloqueada');
      expect(locked).toHaveBeenCalledTimes(1);
    });

    test('borrador que todavía no está: reintenta una vez; si sigue, pasa al siguiente', async () => {
      const ok = macOk();
      let calls = 0;
      const slow = jest.fn(async (database: Firestore, phone: string, text: string) => {
        calls += 1;
        if (calls === 1) throw new MacUnavailable('no apretó Enviar (error: el borrador no coincide con el mensaje (0 letras))');
        return ok(database, phone, text);
      });
      expect((await sendNotices(db, [{ telefono: '59899123456', texto: AVISO }], NOW, slow, 60_000, 1)).resultados[0].estado).toBe('enviado');
      expect(slow).toHaveBeenCalledTimes(2);

      const stuck = jest.fn(async (database: Firestore, phone: string, text: string) => {
        if (phone === '59899123456') throw new MacUnavailable('no apretó Enviar (error: el borrador no coincide con el mensaje (12 letras))');
        return ok(database, phone, text);
      });
      const result = await sendNotices(db, [{ telefono: '59899123456', texto: 'Otro texto' }, { telefono: '59898000000', texto: 'Otro texto' }], NOW, stuck, 60_000, 1);
      expect(result.resultados.map((entry) => entry.estado)).toEqual(['no_enviado', 'enviado']);
      expect(result.resultados[0].motivo).toContain('otro borrador');
    });

    test('envío sin confirmar: corta, no se reintenta solo y se aclara cuando aparece', async () => {
      const unconfirmed = jest.fn(async () => { throw new WriteError('Apreté Enviar en WhatsApp del Mac pero no apareció enviado en 45 s'); });
      const items = [{ telefono: '59899123456', texto: AVISO }, { telefono: '59898000000', texto: AVISO }];
      const first = await sendNotices(db, items, NOW, unconfirmed);
      expect(first.resultados.map((entry) => entry.estado)).toEqual(['incierto', 'sin_intentar']);
      expect(first.seguir).toContain('sin confirmar');
      // Otra llamada: el incierto no se vuelve a mandar; el resto sigue.
      const mac = macOk();
      const second = await sendNotices(db, items, NOW, mac);
      expect(second.resultados.map((entry) => entry.estado)).toEqual(['incierto', 'enviado']);
      expect(mac).toHaveBeenCalledTimes(1);
      // El registro llegó tarde: ahora figura como ya enviado y deja de estar incierto.
      await db.doc('whatsappInbox/tarde').set(message('tarde', { direction: 'out', handled: true, text: AVISO, sentAt: NOW }));
      expect((await sendNotices(db, items, NOW, mac)).resumen).toMatchObject({ ya_enviados: 2, inciertos: 0 });
      expect(mac).toHaveBeenCalledTimes(1);
    });

    test('incierto comprobado que no salió: con reintentar se manda', async () => {
      const unconfirmed = jest.fn(async () => { throw new WriteError('no apareció enviado en 45 s'); });
      await sendNotices(db, [{ telefono: '59899123456', texto: AVISO }], NOW, unconfirmed);
      const mac = macOk();
      expect((await sendNotices(db, [{ telefono: '59899123456', texto: AVISO, reintentar: true }], NOW, mac)).resultados[0].estado).toBe('enviado');
    });

    test('ya escribió desde el aviso: no se le manda el recordatorio y vuelven sus mensajes', async () => {
      const mac = macOk();
      // Rosa escribió hace 10 y 30 minutos; Ana, hace 26 horas.
      const result = await sendNotices(db, [
        { telefono: '59899123456', texto: 'Recordatorio', cliente: 'Rosa', frenarDesde: minutesAgo(60) },
        { telefono: '59898000000', texto: 'Recordatorio', cliente: 'Ana', frenarDesde: minutesAgo(60) },
        { telefono: '59899123456', texto: 'Recordatorio', cliente: 'Rosa sin freno' },
      ], NOW, mac);
      expect(result.resultados.map((entry) => entry.estado)).toEqual(['escribio', 'enviado', 'enviado']);
      expect(result.resultados[0].mensajes_del_cliente?.map((entry) => entry.texto)).toEqual(['Hola', 'Mañana 2 de 20']);
      expect(result.resumen.escribieron).toBe(1);
    });

    test('se acabó el tiempo: lo que falta vuelve sin intentar', async () => {
      const mac = macOk();
      const result = await sendNotices(db, [{ telefono: '59899123456', texto: AVISO }, { telefono: '59898000000', texto: AVISO }], NOW, mac, -1);
      expect(result.resultados.map((entry) => entry.estado)).toEqual(['sin_intentar', 'sin_intentar']);
      expect(result.seguir).toContain('Volvé a llamar');
      expect(mac).not.toHaveBeenCalled();
    });
  });

  test('mensaje de Jonathan: plantilla sin aprobar no cuenta en el uso', async () => {
    const rejected = jest.fn(async () => new Response(JSON.stringify({ error: { message: 'Template name does not exist' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(sendMessage(db, '59898000000', 'Hola', 'Ana', NOW, rejected, noMac)).rejects.toThrow('aprobada por Meta');
    expect((await db.doc('whatsappUsage/2026-10').get()).data()?.sent ?? 0).toBe(0);
  });

  test('comprobante a Aquapura: solo el archivo con la ventana abierta, plantilla si no', async () => {
    await db.doc('whatsappInbox/pdf1').set(message('pdf1', { type: 'document', media: { id: 'm', link: 'https://api.ycloud.com/m/pdf1', mime: 'application/pdf', filename: 'recibo.pdf' } }));
    const calls: any[] = [];
    const fetcher = jest.fn(async (url: string, init: any = {}) => {
      calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      if (url.includes('/media/') && url.endsWith('/upload')) return new Response(JSON.stringify({ id: 'media1' }));
      if (url.endsWith('/sendDirectly')) return new Response(JSON.stringify({ id: 'out9', status: 'accepted' }));
      return new Response(new Uint8Array([37, 80, 68, 70]));
    }) as unknown as typeof fetch;

    const closed = await forwardReceiptToAquapura(db, 'pdf1', 'Letu Bianchi', 473, NOW, fetcher);
    expect(closed.como).toContain('plantilla');
    const tpl = calls.find((c) => c.url.endsWith('/sendDirectly')).body;
    expect(tpl).toMatchObject({ to: '+59892684859', type: 'template', template: { name: 'comprobante_cliente_brou' } });
    expect(tpl.template.components[1].parameters.map((p: any) => p.text)).toEqual(['Letu Bianchi', '473']);

    await db.doc('whatsappWindows/59892684859').set({ lastInboundAt: minutesAgo(60) });
    calls.length = 0;
    const open = await forwardReceiptToAquapura(db, 'pdf1', 'Letu Bianchi', 473, NOW, fetcher);
    expect(open.como).toContain('solo el archivo');
    expect(calls.find((c) => c.url.endsWith('/sendDirectly')).body).toEqual({
      from: '+59891667066', to: '+59892684859', type: 'document', document: { id: 'media1', filename: 'recibo.pdf' },
    });
  });

  test('excluir: por nombre del perfil, borra lo guardado y deja de aparecer; deshacer lo vuelve a incluir', async () => {
    const rosa = [{ id: 'rosa', name: 'Rosa Jerez', address: 'Calle 26', freq: 'weekly', phone: '099 123 456', phones: [] }] as any;
    await expect(excludeChat(db, rosa, { nombre: 'rosa' }, NOW)).rejects.toThrow(/Rosa Jerez \(Calle 26\).*aunque_sea_cliente/);
    await expect(excludeChat(db, [], { nombre: 'nadie' }, NOW)).rejects.toThrow(/No hay mensajes/);
    await db.doc('whatsappInbox/lucho').set(message('lucho', { phone: '59894007047', name: 'Lucho_Arriola24', text: 'el finde?' }));
    await db.doc('whatsappInbox/otro').set(message('otro', { phone: '59894001111', name: 'Marta Arriola', text: 'hola' }));
    await expect(excludeChat(db, [], { nombre: 'Luciano Arriola' }, NOW)).rejects.toThrow(/Hay 2 chats.*Lucho_Arriola24 …7047/);
    await db.doc('whatsappInbox/otro').delete();
    expect(await excludeChat(db, [], { nombre: 'Luciano Arriola' }, NOW)).toMatchObject({ excluido: '59894007047', nombre: 'Lucho_Arriola24' });

    const result = await excludeChat(db, [], { nombre: 'ROSA', motivo: 'amiga de Jonathan' }, NOW);
    expect(result).toMatchObject({ excluido: '59899123456', nombre: 'Rosa', mensajes_borrados_de_la_bandeja: 3, fichas: [] });
    expect((await db.doc('whatsappConfig/excluidos').get()).data()).toMatchObject({
      phones: ['59894007047', '59899123456'], detalle: { '59899123456': { nombre: 'Rosa', motivo: 'amiga de Jonathan' } },
    });
    const { chats } = await readInbox(db, [], NOW);
    expect(chats.map((chat) => chat.telefono)).toEqual(['59898000000']);
    await expect(sendReply(db, '59899123456', 'hola', NOW, okFetch())).rejects.toThrow(/excluido/);

    await excludeChat(db, [], { telefono: '099123456', deshacer: true }, NOW);
    expect((await db.doc('whatsappConfig/excluidos').get()).data()?.phones).toEqual(['59894007047']);
    await expect(excludeChat(db, [], { telefono: '099111222', deshacer: true }, NOW)).rejects.toThrow(/whatsapp.json/);
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
