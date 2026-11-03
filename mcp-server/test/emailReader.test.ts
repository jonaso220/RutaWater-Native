import fs from 'fs';
import os from 'os';
import path from 'path';
import { readEmails } from '../src/emailReader';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rutawater-correos-'));
process.env.RUTAWATER_TELEGRAM_STATE = path.join(dir, 'state.json');
fs.writeFileSync(process.env.RUTAWATER_TELEGRAM_STATE, JSON.stringify({
  preguntas: [], respuestas: [{ id: 'R1', fecha: '2026-11-03 11:00', texto: 'fijate si tengo algo importante', consulta_id: null, aplicada: false }],
}));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('correos de Jonathan', () => {
  test('la sesión que lee solo puede leer Gmail', async () => {
    const run = jest.fn(async (_args: string[]) => 'Hay una factura de UTE.');
    const result = await readEmails('R1', 'ver si hay algo importante', new Date('2026-11-03T14:00:00Z'), run);
    expect(result.informe).toBe('Hay una factura de UTE.');
    const args = run.mock.calls[0][0];
    expect(value(args, '--tools')).toBe('');
    const allowed = value(args, '--allowedTools').split(',');
    expect(allowed).toEqual(['search_threads', 'get_thread', 'get_message', 'list_labels'].map((tool) => `mcp__claude_ai_Gmail__${tool}`));
    const blocked = value(args, '--disallowedTools').split(',');
    expect(blocked).toEqual(expect.arrayContaining(['mcp__rutawater', 'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward', 'mcp__claude_ai_Gmail__trash_thread']));
    expect(allowed.filter((tool) => blocked.includes(tool))).toEqual([]);
    expect(value(args, '-p')).toContain('fijate si tengo algo importante');
    expect(value(args, '-p')).toContain('2026-11-03');
  });

  test('sin un mensaje de Jonathan no lee nada', async () => {
    const run = jest.fn(async () => 'x');
    await expect(readEmails('R999', 'ver', new Date(), run)).rejects.toThrow('él lo pide');
    expect(run).not.toHaveBeenCalled();
  });

  test('si falla o no devuelve nada, avisa', async () => {
    await expect(readEmails('R1', 'ver', new Date(), async () => { throw new Error('sin conexión'); })).rejects.toThrow('No pude leer los correos: sin conexión');
    await expect(readEmails('R1', 'ver', new Date(), async () => '  ')).rejects.toThrow('no devolvió nada');
  });

  test('el informe tiene tope', async () => {
    const { informe } = await readEmails('R1', 'ver', new Date(), async () => 'a'.repeat(9000));
    expect(informe).toHaveLength(3000);
  });
});
