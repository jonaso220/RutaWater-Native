import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { answerText } from './telegram';
import { WriteError } from './writes';

// Lo que el vigilante no puede hacer con sus herramientas se lo pasa a Claude
// Code (Jonathan, 30/10/2026): «antes de decirme que no puede, que se lo pase a
// Claude; si se puede crear la herramienta que la cree, y si no que lo haga, y a
// mí que me llegue el resultado por el bot». El pedido queda en
// ~/.rutawater-mcp/ayudante/pedidos; launchd (com.olivera.rutawater-ayudante)
// arranca ayudante.mjs, que corre una sesión de Claude Code en el repo y le
// avisa a Jonathan por Telegram. Solo con un mensaje de Jonathan al bot: nunca
// por lo que escriba un cliente.

const dir = () => (process.env.RUTAWATER_AYUDANTE_DIR || '').trim() || join(homedir(), '.rutawater-mcp/ayudante');
const LABEL = 'com.olivera.rutawater-ayudante';

const kick = () => new Promise<void>((done) => {
  execFile('/bin/launchctl', ['kickstart', `gui/${process.getuid?.() ?? 501}/${LABEL}`], () => done());
});

export const askClaude = async (
  answerId: string, request: string, context: string, now = new Date(), wake: () => Promise<void> = kick,
) => {
  const literal = answerText(answerId.trim());
  if (!literal) {
    throw new WriteError('Solo para lo que Jonathan pide por Telegram: pasá el id de su mensaje (R…) que dio leer_respuestas_jonathan, ya transcripto si era audio.');
  }
  const pedidos = join(dir(), 'pedidos');
  const hechos = join(dir(), 'hechos');
  mkdirSync(pedidos, { recursive: true });
  const id = `P${answerId.trim().replace(/[^\w-]/g, '')}`;
  const previous = [pedidos, hechos].map((folder) => join(folder, `${id}.json`)).find((file) => existsSync(file));
  if (previous) {
    const stored = JSON.parse(readFileSync(previous, 'utf8'));
    return { pedido_id: id, estado: stored.estado || 'pendiente', cambiado: false, aviso: 'Ese pedido ya se le pasó a Claude.' };
  }
  writeFileSync(join(pedidos, `${id}.json`), JSON.stringify({
    id, respuesta_id: answerId.trim(), mensaje_de_jonathan: literal, pedido: request.trim(), contexto: context.trim(),
    creado: now.toISOString(), estado: 'pendiente',
  }, null, 1));
  await wake();
  const waiting = readdirSync(pedidos).filter((name) => name.endsWith('.json')).length;
  return {
    pedido_id: id, estado: 'pendiente', cambiado: true, en_cola: waiting,
    aviso: 'Claude lo resuelve (si hace falta crea la herramienta) y le avisa a Jonathan por Telegram. Decile que lo estás resolviendo.',
  };
};
