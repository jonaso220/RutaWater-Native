import fs from 'fs';
import os from 'os';
import path from 'path';
import { askJonathan, markAnswersApplied, readAnswers } from '../src/telegram';

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

    await askJonathan({ pregunta: '¿Otra?' }, bot.fetcher);
    bot.message(5, 42, 'Regla: a los de Solymar llevarles siempre 20 L');
    const rule = (await readAnswers(bot.fetcher)).respuestas;
    expect(rule.map((r) => [r.tipo, r.consulta_id])).toEqual([['instruccion', null]]);
  });
});
