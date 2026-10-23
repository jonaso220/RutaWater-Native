import { createHmac } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { createWhatsappWebhookHandler, excludedPhones, toRecord, validSignature } from '../whatsapp-webhook';

const SECRET = 'whsec_test';
const NOW = new Date('2026-10-23T15:00:00Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

const sign = (body: string, t = nowSeconds) =>
  `t=${t},s=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;

const inbound = (overrides: Record<string, unknown> = {}) => ({
  id: 'evt1',
  type: 'whatsapp.inbound_message.received',
  whatsappInboundMessage: {
    id: 'msg1', wamid: 'wamid.1', from: '+59899123456', to: '+59891667066',
    customerProfile: { name: 'Rosa' }, sendTime: '2026-10-23T14:59:00.000Z',
    type: 'text', text: { body: 'Hola, mañana 2 de 20' }, ...overrides,
  },
});

const makeHandler = (env: Record<string, string | undefined> = {}) => {
  const create = jest.fn(async () => undefined);
  const doc = jest.fn(() => ({ create }));
  const db = { collection: jest.fn(() => ({ doc })) } as unknown as Firestore;
  const handler = createWhatsappWebhookHandler({
    readEnvironment: (name) => ({ YCLOUD_WEBHOOK_SECRET: SECRET, WHATSAPP_EXCLUDED_PHONES: '099 111 222', ...env })[name],
    getFirestore: () => db,
    now: () => NOW,
  });
  return { handler, create, doc };
};

const post = (body: string, signature = sign(body)) => new Request('https://x/api/whatsapp-webhook', {
  method: 'POST', headers: { 'YCloud-Signature': signature }, body,
});

describe('whatsapp-webhook', () => {
  test('firma: acepta la correcta y rechaza otra, vieja o vacía', () => {
    const body = '{"a":1}';
    expect(validSignature(sign(body), body, SECRET, nowSeconds)).toBe(true);
    expect(validSignature(sign(body), '{"a":2}', SECRET, nowSeconds)).toBe(false);
    expect(validSignature(sign(body, nowSeconds - 600), body, SECRET, nowSeconds)).toBe(false);
    expect(validSignature(null, body, SECRET, nowSeconds)).toBe(false);
  });

  test('guarda un mensaje de cliente con el id del mensaje', async () => {
    const { handler, create, doc } = makeHandler();
    const body = JSON.stringify(inbound());
    const response = await handler(post(body));
    expect(response.status).toBe(200);
    expect(doc).toHaveBeenCalledWith('msg1');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'in', phone: '59899123456', name: 'Rosa', text: 'Hola, mañana 2 de 20', handled: false, type: 'text',
    }));
  });

  test('sin firma válida no guarda nada', async () => {
    const { handler, create } = makeHandler();
    const response = await handler(post(JSON.stringify(inbound()), 't=1,s=00'));
    expect(response.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  test('chats excluidos, grupos y otros eventos no se guardan', () => {
    const excluded = excludedPhones('099 111 222, +59894000000');
    expect(toRecord(inbound({ from: '+59899111222' }), excluded, NOW)).toBeNull();
    expect(toRecord(inbound({ from: '+59894000000' }), excluded, NOW)).toBeNull();
    expect(toRecord(inbound({ groupId: '1@g.us' }), excluded, NOW)).toBeNull();
    expect(toRecord({ type: 'whatsapp.message.updated', whatsappMessage: {} }, excluded, NOW)).toBeNull();
  });

  test('audio y mensajes enviados desde la app', () => {
    const audio = toRecord(inbound({ type: 'audio', text: undefined, audio: { id: 'a1', link: 'https://api.ycloud.com/m/a1', mime_type: 'audio/ogg' } }), new Set(), NOW);
    expect(audio).toMatchObject({ type: 'audio', text: '', media: { id: 'a1', link: 'https://api.ycloud.com/m/a1', mime: 'audio/ogg' } });
    const sent = toRecord({
      type: 'whatsapp.smb.message.created',
      whatsappMessage: { id: 'out1', from: '+59891667066', to: '+59899123456', type: 'text', text: { body: 'Mañana pasamos' } },
    }, new Set(), NOW);
    expect(sent).toMatchObject({ direction: 'out', phone: '59899123456', handled: true, text: 'Mañana pasamos' });
  });

  test('un evento repetido no da error', async () => {
    const { handler, create } = makeHandler();
    create.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 6 }));
    const body = JSON.stringify(inbound());
    expect((await handler(post(body))).status).toBe(200);
  });
});
