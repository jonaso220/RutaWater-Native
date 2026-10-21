import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// Transcribe en el Mac los audios de WhatsApp guardados en Descargas, con el
// script de la skill whatsapp-rutawater y su Python con faster-whisper. Las
// tareas programadas del chat de Claude corren los comandos en una VM que no ve
// ~/Downloads ni ese Python (20/10/2026); este servidor sí corre en el Mac.
//
// Python nunca toca Descargas (21/10/2026): la app de Claude lanza el servidor
// con `disclaimer`, así que macOS le pide a cada programa su propio permiso de
// Descargas. Node lo tiene; el Python de Whisper no, y se quedaba esperando un
// aviso en la pantalla del Mac que nadie veía desde la nube. Node copia los
// audios a una carpeta temporal, Python transcribe las copias y Node borra.
const home = homedir();
const env = (name: string, fallback: string) => (process.env[name] || '').trim() || fallback;
const PYTHON = env('RUTAWATER_WHISPER_PYTHON', join(home, '.rutawater-mcp/whisper-venv/bin/python'));
const SCRIPT = env('RUTAWATER_TRANSCRIBIR', join(home, '.codex/skills/whatsapp-rutawater/scripts/transcribir_audio.py'));
const DESCARGAS = env('RUTAWATER_DESCARGAS', join(home, 'Downloads'));
// Con medium la primera vez descarga el modelo (~1 min); varios audios suman.
const TIMEOUT_MS = 10 * 60 * 1000;
// Mismas extensiones que el script.
const AUDIO = /^WhatsApp Audio .*\.(opus|ogg|oga|m4a|mp3|aac|wav|mp4|caf)$/i;
// El archivo puede tardar unos segundos en aparecer después de «Guardar en Descargas».
const ESPERA_MS = 10 * 1000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const newestAudios = async (cantidad: number): Promise<string[]> => {
  const deadline = Date.now() + ESPERA_MS;
  for (;;) {
    const found = readdirSync(DESCARGAS).filter((name) => AUDIO.test(name));
    if (found.length || Date.now() > deadline) {
      return found
        .map((name) => ({ name, mtime: statSync(join(DESCARGAS, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, cantidad)
        .reverse() // en orden cronológico, como el script
        .map(({ name }) => name);
    }
    await sleep(1000);
  }
};

interface Resultado { archivo: string; dudoso?: boolean; error?: string; borrado?: boolean }

export const transcribeAudios = async (cantidad: number, borrar: boolean): Promise<unknown> => {
  for (const [what, path] of [['el Python de Whisper', PYTHON], ['el script de transcripción', SCRIPT], ['la carpeta Descargas', DESCARGAS]]) {
    if (!existsSync(path)) throw new Error(`No encuentro ${what} en ${path}.`);
  }
  const names = await newestAudios(cantidad);
  if (!names.length) {
    throw new Error('No hay archivos «WhatsApp Audio …» en Descargas tras esperar 10 s. Revisar con zoom que el clic cayó en «Guardar en Descargas» y repetir.');
  }
  const work = mkdtempSync(join(tmpdir(), 'rutawater-audio-'));
  try {
    // El nombre se conserva: el script lee de ahí la hora del mensaje.
    for (const name of names) copyFileSync(join(DESCARGAS, name), join(work, name));
    const audios = await runScript(names.map((name) => join(work, name)), work);
    if (borrar) {
      for (const audio of audios) {
        if (audio.error || audio.dudoso) continue;
        try {
          unlinkSync(join(DESCARGAS, audio.archivo));
          audio.borrado = true;
        } catch {
          audio.borrado = false;
        }
      }
    }
    return { descargas: DESCARGAS, audios };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

const runScript = (files: string[], cwd: string): Promise<Resultado[]> => new Promise((resolve, reject) => {
  execFile(PYTHON, ['-I', SCRIPT, ...files, '--json'], {
    // Por la misma razón, nunca la carpeta del servidor (puede estar en un disco externo).
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    // Lanzado desde la app de Claude el PATH no incluye Homebrew (ffmpeg).
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}` },
  }, (error, stdout, stderr) => {
    const out = stdout.trim();
    if (out.startsWith('[')) {
      try {
        return resolve(JSON.parse(out));
      } catch {
        // cae al error de abajo
      }
    }
    const detail = out.replace(/^ERROR:\s*/, '') || stderr.trim().split('\n').slice(-3).join('\n') || error?.message;
    reject(new Error(`No se pudo transcribir: ${detail}`));
  });
});
