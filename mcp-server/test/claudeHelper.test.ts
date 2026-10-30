// Pedidos a Claude: solo con un mensaje de Jonathan al bot, sin repetir.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { askClaude } from '../src/claudeHelper';

describe('pedir a Claude', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ayudante-'));
  beforeAll(() => {
    process.env.RUTAWATER_AYUDANTE_DIR = path.join(dir, 'ayudante');
    process.env.RUTAWATER_TELEGRAM_STATE = path.join(dir, 'telegram.json');
    fs.writeFileSync(process.env.RUTAWATER_TELEGRAM_STATE, JSON.stringify({
      respuestas: [{ id: 'R10', texto: 'Pasame la lista de los que deben más de 1000', aplicada: false }],
    }));
  });
  afterAll(() => {
    delete process.env.RUTAWATER_AYUDANTE_DIR;
    delete process.env.RUTAWATER_TELEGRAM_STATE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('guarda el pedido con las palabras de Jonathan, despierta al ayudante y no lo repite', async () => {
    const wake = jest.fn(async () => {});
    await expect(askClaude('R99', 'algo', '', new Date(), wake)).rejects.toThrow('Telegram');
    const first = await askClaude('R10', 'Lista de deudores de más de $1000', 'listar_deudas no filtra por monto', new Date(), wake);
    expect(first).toMatchObject({ pedido_id: 'PR10', cambiado: true, en_cola: 1 });
    expect(wake).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'ayudante/pedidos/PR10.json'), 'utf8'));
    expect(stored).toMatchObject({ mensaje_de_jonathan: 'Pasame la lista de los que deben más de 1000', estado: 'pendiente' });
    expect((await askClaude('R10', 'otra vez', '', new Date(), wake)).cambiado).toBe(false);
    expect(wake).toHaveBeenCalledTimes(1);
  });
});
