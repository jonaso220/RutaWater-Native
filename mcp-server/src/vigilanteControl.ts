import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Las pasadas programadas de las 9 y las 18 solo mandan avisos y recordatorios
// (Jonathan, 24/10/2026); contestar y agendar lo hace el vigilante. Mientras la
// pasada manda, el vigilante espera; cuando termina, se lo despierta.

const flagFile = () => (process.env.RUTAWATER_PASADA_FLAG || '').trim()
  || join(homedir(), '.rutawater-mcp/vigilante/pasada-programada.json');
const LABEL = 'com.olivera.rutawater-vigilante';

export const scheduledPass = async (estado: 'empieza' | 'termina', pasada?: string) => {
  const file = flagFile();
  if (estado === 'empieza') {
    writeFileSync(file, JSON.stringify({ pasada: pasada || '', desde: new Date().toISOString() }));
    // Marca que las tareas ya usan este aviso: el vigilante deja de usar sus pausas fijas.
    writeFileSync(`${file}.usado`, new Date().toISOString());
    return { vigilante: 'en pausa', hasta: 'que la pasada avise «termina» (o 3 h como máximo)' };
  }
  const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  rmSync(file, { force: true });
  await new Promise<void>((done) => {
    execFile('/bin/launchctl', ['kickstart', `gui/${process.getuid?.() ?? 501}/${LABEL}`], () => done());
  });
  return { vigilante: 'reanudado y despertado', pausa_desde: before?.desde || null };
};
