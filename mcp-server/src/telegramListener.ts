import { execFile } from 'node:child_process';
import { pullAnswers, touchHeartbeat } from './telegram';

// Escucha del bot de Telegram (Jonathan, 23/10/2026): queda conectada esperando
// mensajes (long polling) y, apenas Jonathan escribe, despierta al vigilante
// para que lo aplique enseguida, sin esperar la vuelta de cada 10 minutos.
// launchd (com.olivera.rutawater-telegram) la mantiene viva.

const VIGILANTE = `gui/${process.getuid?.() ?? 501}/com.olivera.rutawater-vigilante`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const stamp = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

const pending = (state: { respuestas: Array<{ id: string; aplicada: boolean }> }) =>
  new Set(state.respuestas.filter((answer) => !answer.aplicada).map((answer) => answer.id));

const wakeVigilante = () => new Promise<void>((done) => {
  execFile('/bin/launchctl', ['kickstart', VIGILANTE], () => done());
});

const main = async () => {
  console.log(`${stamp()} escucha de Telegram arrancada`);
  for (;;) {
    touchHeartbeat();
    try {
      const before = pending(await pullAnswers(fetch, 0));
      const state = await pullAnswers(fetch, 50);
      const fresh = [...pending(state)].filter((id) => !before.has(id));
      if (fresh.length) {
        console.log(`${stamp()} ${fresh.length} mensajes de Jonathan: despierto al vigilante`);
        await wakeVigilante();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${stamp()} ${message}`);
      // Otro lector lo cortó (no debería pasar): reintentar enseguida. Sin internet: sin apurar.
      await sleep(/Conflict/.test(message) ? 2000 : 30000);
    }
  }
};

main();
