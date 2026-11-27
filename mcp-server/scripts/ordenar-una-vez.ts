// Ubica en el recorrido los pedidos de una vez que Jonathan carga desde la app
// (27/11/2026). Lo corre el vigilante en cada vuelta, sin Claude:
//
//   node ordenar-una-vez.cjs           ubica los que siguen primeros del día
//   node ordenar-una-vez.cjs --probar  muestra qué haría, sin mover nada
//   node ordenar-una-vez.cjs --probar --sin-registro  lo mismo, como si ninguna se hubiera tratado
//
// Mismas variables que el servidor (GOOGLE_APPLICATION_CREDENTIALS y
// RUTAWATER_EMAIL o RUTAWATER_UID). Cuida la cuota de Firestore: cada vuelta
// lee solo las fichas de una vez (unas pocas) y carga todas las fichas del
// reparto únicamente cuando hay alguna para ubicar. Cada ficha se trata una
// sola vez: las ya vistas quedan en ~/.rutawater-mcp/una-vez-ubicados.json.
process.env.TZ = process.env.RUTAWATER_TZ || 'America/Montevideo';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Client } from '../../src/types';
import { withDefaults } from '../../src/utils/clientDefaults';
import { belongsToProfileScope } from '../../src/utils/profileScope';
import { appendAudit } from '../src/audit';
import { getDb, loadConfig } from '../src/config';
import { onceKey, onceNotice, orderOnceVisits, OnceResult } from '../src/onceOrder';
import { ReadBudget, setReadBudget } from '../src/readBudget';
import { scopeQueries, Store } from '../src/store';
import { notifyJonathan } from '../src/telegram';
import { addDays, todayKey, weekdayOf } from '../src/views';

interface Seen { cuando: string; como: string; nombre: string; fecha: string; actualizado?: string }

const home = path.join(os.homedir(), '.rutawater-mcp');
const statePath = process.env.RUTAWATER_UNA_VEZ_ESTADO || path.join(home, 'una-vez-ubicados.json');
const logPath = path.join(home, 'vigilante', 'vigilante.log');
const dryRun = process.argv.includes('--probar');
const DAYS = 7;
const QUIET_MS = 2 * 60e3;
const MOVE_TOOLS = /"tool":"(cambiar_posicion|agendar_una_vez|cambiar_fecha)"/;

const readState = (): Record<string, Seen> => {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
};

const log = (line: string) => {
  try {
    fs.appendFileSync(logPath, `${new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} ${line}\n`);
  } catch { /* sin registro no se frena */ }
};

/** Claves «ficha|fecha» que ya movió o ubicó una herramienta, según el registro de escrituras. */
const movedByTools = (auditPath: string, since: number): { exact: Set<string>; recent: Set<string> } => {
  const exact = new Set<string>();
  const recent = new Set<string>();
  let text = '';
  try {
    text = fs.readFileSync(auditPath, 'utf8');
  } catch {
    return { exact, recent };
  }
  for (const line of text.split('\n')) {
    if (!MOVE_TOOLS.test(line)) continue;
    try {
      const entry = JSON.parse(line);
      if (new Date(entry.at).getTime() < since) continue;
      const date = String(entry.despues?.fecha || entry.args?.fecha || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (entry.tool !== 'cambiar_posicion' && entry.args?.ubicar !== true) continue;
      for (const id of [entry.args?.cliente_id, entry.despues?.ficha_id]) {
        if (!id) continue;
        exact.add(`${id}|${date}`);
        // cambiar_posicion toma solo el día de semana de la fecha que le pasan.
        if (entry.tool === 'cambiar_posicion') recent.add(`${id}|${weekdayOf(date)}`);
      }
    } catch { /* línea cortada */ }
  }
  return { exact, recent };
};

const main = async () => {
  const config = await loadConfig();
  setReadBudget(new ReadBudget(config.loadsDir, config.dailyLoads, undefined, config.hourlyDocs));
  const db = getDb();
  const store = new Store(db, config.uid);
  const account = await store.getAccount();
  const today = todayKey();
  const last = addDays(today, DAYS);
  const now = Date.now();

  // Lectura chica: solo las fichas de una vez.
  const updated = new Map<string, number>();
  const open: Client[] = [];
  for (const route of account.routes) {
    for (const query of scopeQueries(db, 'clients', config.uid, route)) {
      const snap = await query.where('freq', '==', 'once').get();
      snap.docs.forEach((doc) => {
        const data = doc.data();
        if (!belongsToProfileScope(data, config.uid, route.groupId)) return;
        const client = withDefaults(doc.id, data);
        if (client.isCompleted || client.isNote) return;
        updated.set(doc.id, doc.updateTime.toMillis());
        open.push(client);
      });
    }
  }

  const state = readState();
  // Lo viejo no hace falta guardarlo.
  Object.keys(state).forEach((key) => { if ((state[key].fecha || '') < addDays(today, -7)) delete state[key]; });
  const tools = movedByTools(config.auditPath, now - 7 * 86400e3);
  const known = new Set<string>();
  const why = new Map<string, string>();
  open.forEach((client) => {
    const key = onceKey(client);
    const seen = state[key];
    // Sin coordenadas se reintenta cuando la ficha cambia (por ejemplo, le cargaron la ubicación).
    if (seen && !(seen.como === 'sin_coordenadas' && seen.actualizado !== String(updated.get(client.id)))) why.set(key, `ya tratada: ${seen.como}`);
    else if (tools.exact.has(key) || tools.recent.has(`${client.id}|${weekdayOf(String(client.specificDate || today))}`)) why.set(key, 'la ubicó o movió una herramienta');
    if (why.has(key)) known.add(key);
  });
  // Solo para probar: como si ninguna se hubiera tratado todavía (no mueve nada).
  if (dryRun && process.argv.includes('--sin-registro')) { known.clear(); why.clear(); }
  const detail = () => open
    .map((client) => ({ nombre: client.name, fecha: client.specificDate, estado: why.get(onceKey(client)) || (String(client.specificDate || '') > last ? 'fuera de los 7 días' : String(client.specificDate || '') < today ? 'fecha pasada' : 'para mirar') }))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const candidates = open.filter((client) => !known.has(onceKey(client))
    && String(client.specificDate || '') >= today && String(client.specificDate || '') <= last);
  if (!candidates.length) {
    if (dryRun) console.log(JSON.stringify({ de_una_vez: open.length, para_mirar: 0, fichas: detail() }, null, 1));
    if (!dryRun) fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
    store.close();
    return;
  }

  const results: OnceResult[] = await orderOnceVisits({
    db, account, today, known, dryRun, days: DAYS,
    loadClients: (route) => store.getClients(route),
    recentlyEdited: (client) => now - (updated.get(client.id) || 0) < QUIET_MS,
  });

  if (dryRun) {
    console.log(JSON.stringify({ de_una_vez: open.length, para_mirar: candidates.length, fichas: detail(), resultados: results, aviso: onceNotice(results.map((r) => (r.resultado === 'simulada' ? { ...r, resultado: 'ubicada' as const } : r))) }, null, 1));
    store.close();
    return;
  }

  const stamp = new Date().toISOString();
  results.forEach((result) => {
    if (result.resultado === 'esperando' || result.resultado === 'no_se_pudo' || result.resultado === 'simulada') return;
    state[result.clave] = {
      cuando: stamp, como: result.resultado, nombre: result.nombre, fecha: result.fecha,
      ...(result.resultado === 'sin_coordenadas' ? { actualizado: String(updated.get(result.cliente_id)) } : {}),
    };
    if (result.resultado === 'ubicada') {
      appendAudit(config.auditPath, {
        tool: 'cambiar_posicion', origen: 'vigilante: pedido de una vez cargado desde la app',
        args: { cliente_id: result.cliente_id, fecha: result.fecha, posicion: result.posicion },
        cliente: result.nombre, reparto: result.reparto,
        antes: { dia: weekdayOf(result.fecha), posicion: result.antes },
        despues: { dia: weekdayOf(result.fecha), posicion: result.posicion, anterior: result.anterior, siguiente: result.siguiente },
      });
    }
  });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 1));

  const summary = results.map((r) => `${r.nombre} ${r.fecha.slice(5)}: ${r.resultado}${r.posicion ? ` (pos. ${r.posicion})` : ''}${r.motivo ? ` — ${r.motivo}` : ''}`).join('; ');
  log(`pedidos de una vez cargados desde la app: ${summary}`);
  const notice = onceNotice(results);
  if (notice) {
    try {
      await notifyJonathan(notice);
    } catch (error) {
      log(`  no se pudo avisar por Telegram: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(JSON.stringify({ resultados: results }));
  store.close();
};

main().then(() => process.exit(0)).catch((error) => {
  log(`pedidos de una vez: error — ${error instanceof Error ? error.message : String(error)}`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
