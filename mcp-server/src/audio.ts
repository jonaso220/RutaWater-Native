import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Transcribe en el Mac los audios de WhatsApp guardados en Descargas, con el
// script de la skill whatsapp-rutawater y su Python con faster-whisper. Las
// tareas programadas del chat de Claude corren los comandos en una VM que no ve
// ~/Downloads ni ese Python (20/10/2026); este servidor sí corre en el Mac.
const home = homedir();
const env = (name: string, fallback: string) => (process.env[name] || '').trim() || fallback;
const PYTHON = env('RUTAWATER_WHISPER_PYTHON', join(home, '.rutawater-mcp/whisper-venv/bin/python'));
const SCRIPT = env('RUTAWATER_TRANSCRIBIR', join(home, '.codex/skills/whatsapp-rutawater/scripts/transcribir_audio.py'));
const DESCARGAS = env('RUTAWATER_DESCARGAS', join(home, 'Downloads'));
// Con medium la primera vez descarga el modelo (~1 min); varios audios suman.
const TIMEOUT_MS = 10 * 60 * 1000;

export const transcribeAudios = (cantidad: number, borrar: boolean): Promise<unknown> => {
  for (const [what, path] of [['el Python de Whisper', PYTHON], ['el script de transcripción', SCRIPT], ['la carpeta Descargas', DESCARGAS]]) {
    if (!existsSync(path)) return Promise.reject(new Error(`No encuentro ${what} en ${path}.`));
  }
  const args = ['-I', SCRIPT, '--ultimo', String(cantidad), '--json', ...(borrar ? ['--borrar'] : [])];
  return new Promise((resolve, reject) => {
    execFile(PYTHON, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      // Lanzado desde la app de Claude el PATH no incluye Homebrew (ffmpeg).
      env: { ...process.env, RUTAWATER_DESCARGAS: DESCARGAS, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}` },
    }, (error, stdout, stderr) => {
      const out = stdout.trim();
      if (out.startsWith('[')) {
        try {
          return resolve({ descargas: DESCARGAS, audios: JSON.parse(out) });
        } catch {
          // cae al error de abajo
        }
      }
      const detail = out.replace(/^ERROR:\s*/, '') || stderr.trim().split('\n').slice(-3).join('\n') || error?.message;
      reject(new Error(`No se pudo transcribir: ${detail}`));
    });
  });
};
