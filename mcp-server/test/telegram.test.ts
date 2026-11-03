import fs from 'fs';
import os from 'os';
import path from 'path';
import { answerText, askJonathan, downloadPhoto, markAnswersApplied, readAnswers } from '../src/telegram';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rutawater-tg-test-'));
process.env.RUTAWATER_TELEGRAM_TOKEN = path.join(dir, 'token');
process.env.RUTAWATER_TELEGRAM_STATE = path.join(dir, 'state.json');
fs.writeFileSync(process.env.RUTAWATER_TELEGRAM_TOKEN, '123:abc\n');

/** Bot falso: devuelve en getUpdates lo que se cargue en `pending` y guarda lo enviado. */
const fakeBot = () => {
  let nextId = 100;
  const pending: any[] = [];
  const sent: any[] = [];
  const fetcher = jest.fn(async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/getUpdates')) {
      const result = pending.filter((update) => body.offset === undefined || update.update_id >= body.offset);
      return new Response(JSON.stringify({ ok: true, result }));
    }
    nextId += 1;
    sent.push({ ...body, message_id: nextId });
    return new Response(JSON.stringify({ ok: true, result: { message_id: nextId } }));
  }) as unknown as typeof fetch;
  const message = (update_id: number, chatId: number, text: string, replyTo?: number) => pending.push({
    update_id, message: { message_id: 500 + update_id, chat: { id: chatId, type: 'private' }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) },
  });
  return { fetcher, sent, message };
};

describe('dudas por Telegram', () => {
  beforeEach(() => fs.rmSync(process.env.RUTAWATER_TELEGRAM_STATE!, { force: true }));

  test('sin «hola» no hay a quién preguntar', async () => {
    const bot = fakeBot();
    await expect(askJonathan({ pregunta: '¿12 o 20?' }, bot.fetcher)).rejects.toThrow('hola');
  });

  test('pregunta, respuesta citada, otra sin citar y chats ajenos ignorados', async () => {
    const bot = fakeBot();
    bot.message(1, 42, 'hola');
    const first = await askJonathan({ pregunta: '¿12 o 20 L?', cliente: 'Noelia', mensaje_cliente: 'Si un bidón gracias', whatsapp_ids: ['w1'] }, bot.fetcher);
    expect(first).toEqual({ enviada: true, consulta_id: 'D1' });
    expect(bot.sent[0].chat_id).toBe(42);
    expect(bot.sent[0].text).toContain('Duda D1');
    expect(bot.sent[0].text).toContain('«Si un bidón gracias»');
    const second = await askJonathan({ pregunta: '¿Le cobro el cambio?' }, bot.fetcher);

    bot.message(2, 42, '20 litros', bot.sent[0].message_id);
    bot.message(3, 99, 'soy otro');
    bot.message(4, 42, 'no se cobra');
    const { respuestas, preguntas_sin_respuesta } = await readAnswers(bot.fetcher);
    expect(respuestas.map((r) => [r.texto, r.consulta_id])).toEqual([['20 litros', 'D1'], ['no se cobra', second.consulta_id]]);
    expect(respuestas[0].consulta).toMatchObject({ cliente: 'Noelia', whatsapp_ids: ['w1'] });
    expect(preguntas_sin_respuesta).toEqual([]);

    expect(respuestas.map((r) => r.tipo)).toEqual(['respuesta', 'respuesta']);
    expect(markAnswersApplied(respuestas.map((r) => r.id)).aplicadas).toHaveLength(2);

    await askJonathan({ pregunta: '¿12 o 20?', cliente: 'Ana' }, bot.fetcher);
    await askJonathan({ pregunta: '¿Le cobro?', cliente: 'Luis' }, bot.fetcher);
    bot.message(5, 42, 'Regla: a los de Solymar llevarles siempre 20 L');
    bot.message(6, 42, 'A Ana 20 litros y a Luis no le cobres');
    const many = await readAnswers(bot.fetcher);
    expect(many.respuestas.map((r) => [r.tipo, r.consulta_id])).toEqual([['instruccion', null], ['respuesta_varias', null]]);
    expect(many.preguntas_sin_respuesta.map((q) => q.cliente)).toEqual(['Ana', 'Luis']);
    const closed = markAnswersApplied(many.respuestas.map((r) => r.id), many.preguntas_sin_respuesta.map((q) => q.id));
    expect(closed.dudas_cerradas).toHaveLength(2);
    expect((await readAnswers(bot.fetcher)).preguntas_sin_respuesta).toEqual([]);
  });
});

describe('fotos de Jonathan', () => {
  beforeEach(() => fs.rmSync(process.env.RUTAWATER_TELEGRAM_STATE!, { force: true }));

  const withPhotos = (updates: any[]) => {
    const fetcher = jest.fn(async (url: string, init?: any) => {
      if (url.endsWith('/getUpdates')) {
        const { offset } = JSON.parse(init.body);
        return new Response(JSON.stringify({ ok: true, result: updates.filter((update) => offset === undefined || update.update_id >= offset) }));
      }
      if (url.endsWith('/getFile')) {
        const { file_id: fileId } = JSON.parse(init.body);
        return new Response(JSON.stringify({ ok: true, result: { file_path: fileId === 'heic' ? 'documents/a.heic' : 'photos/a.jpg' } }));
      }
      return new Response(Buffer.from('imagen'));
    }) as unknown as typeof fetch;
    return fetcher;
  };
  const chat = { id: 7, type: 'private' };
  const hello = { update_id: 1, message: { message_id: 1, chat, text: 'hola' } };

  test('con texto: la foto más grande y lo que escribió, como instrucción', async () => {
    const fetcher = withPhotos([hello, {
      update_id: 2, message: { message_id: 2, chat, caption: 'añadime este evento', photo: [{ file_id: 'chica' }, { file_id: 'grande' }] },
    }]);
    const { respuestas } = await readAnswers(fetcher);
    expect(respuestas).toEqual([expect.objectContaining({ id: 'R2', texto: 'añadime este evento', foto: true, tipo: 'instruccion' })]);
    expect(respuestas[0]).not.toHaveProperty('foto_file_id');
    const { data, mime } = await downloadPhoto('R2', fetcher);
    expect(mime).toBe('image/jpeg');
    expect(data.toString()).toBe('imagen');
    const getFile = (fetcher as jest.Mock).mock.calls.find(([url]) => url.endsWith('/getFile'));
    expect(JSON.parse(getFile[1].body).file_id).toBe('grande');
  });

  test('sin texto: no cierra una duda abierta y no se pierde', async () => {
    const updates: any[] = [hello];
    const fetcher = jest.fn(async (url: string, init: any) => {
      if (url.endsWith('/getUpdates')) {
        const { offset } = JSON.parse(init.body);
        return new Response(JSON.stringify({ ok: true, result: updates.filter((update) => offset === undefined || update.update_id >= offset) }));
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 50 } }));
    }) as unknown as typeof fetch;
    await askJonathan({ pregunta: '¿12 o 20?' }, fetcher);
    updates.push({ update_id: 2, message: { message_id: 2, chat, photo: [{ file_id: 'a' }] } });
    const { respuestas, preguntas_sin_respuesta: open } = await readAnswers(fetcher);
    expect(respuestas).toEqual([expect.objectContaining({ id: 'R2', texto: '', foto: true, tipo: 'instruccion' })]);
    expect(open).toHaveLength(1);
    expect(answerText('R2')).toBe('(foto sin texto)');
  });

  test('una imagen como archivo se recibe; un formato que no se puede mirar avisa', async () => {
    const fetcher = withPhotos([hello, {
      update_id: 2, message: { message_id: 2, chat, caption: 'mirá', document: { file_id: 'heic', mime_type: 'image/heic' } },
    }, {
      update_id: 3, message: { message_id: 3, chat, caption: 'un pdf', document: { file_id: 'pdf', mime_type: 'application/pdf' } },
    }]);
    const { respuestas } = await readAnswers(fetcher);
    expect(respuestas.map((answer) => answer.id)).toEqual(['R2']);
    await expect(downloadPhoto('R2', fetcher)).rejects.toThrow('formato');
    await expect(downloadPhoto('R9', fetcher)).rejects.toThrow('no tiene una foto');
  });
});
