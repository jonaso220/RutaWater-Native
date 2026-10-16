// Completa lat/lng de las fichas existentes resolviendo sus links de Google Maps
// (una sola vez; después la app los guarda sola al crear o editar la ubicación).
//
//   node dist/completar-coordenadas.cjs            → solo informa, no escribe
//   node dist/completar-coordenadas.cjs --escribir → además guarda lat/lng
//
// Mismas variables que el servidor (GOOGLE_APPLICATION_CREDENTIALS y
// RUTAWATER_EMAIL o RUTAWATER_UID). Cuidado con la cuota de Firestore: lee las
// fichas de cada reparto UNA vez (una consulta por reparto, sin listeners ni
// reintentos) y escribe solo las que cambian. Cada escritura lleva como
// condición la hora de actualización leída: si la ficha cambió mientras tanto
// no se pisa y queda informada. Los links ya resueltos quedan en un caché local
// para no volver a consultarlos si se corre de nuevo.
process.env.TZ = process.env.RUTAWATER_TZ || 'America/Montevideo';

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { getDb, loadConfig } from '../src/config';
import { loadAccount } from '../src/routes';
import { scopeQueries } from '../src/store';
import { belongsToProfileScope } from '../../src/utils/profileScope';
import {
  clientCoordinates, Coordinates, coordinateUpdates, linksWithoutCoordinates, resolveMapsCoordinates,
} from '../../src/utils/geo';

type Cached = { lat: number; lng: number } | { sin_coordenadas: true; destino: string };

const home = path.join(os.homedir(), '.rutawater-mcp');
const write = process.argv.includes('--escribir');
const cachePath = process.env.RUTAWATER_COORDS_CACHE || path.join(home, 'coordenadas-cache.json');
const reportPath = process.env.RUTAWATER_COORDS_REPORT || path.join(home, 'coordenadas-reporte.json');
const CONCURRENCY = 4;

const readCache = (): Record<string, Cached> => {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
};

const resolveAll = async (links: string[], cache: Record<string, Cached>) => {
  const errors = new Map<string, string>();
  const pending = links.filter((link) => !cache[link]);
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const link = pending[next];
      next += 1;
      const visited: string[] = [];
      try {
        const point = await resolveMapsCoordinates(link, { onUrl: (url) => visited.push(url) });
        cache[link] = point ? { lat: point.lat, lng: point.lng } : { sin_coordenadas: true, destino: visited[visited.length - 1] || '' };
      } catch (error) {
        // Error de red: no se guarda en el caché, se reintenta en otra corrida.
        errors.set(link, error instanceof Error ? error.message : String(error));
      }
      if (next % 25 === 0) console.error(`  ${next}/${pending.length} links consultados`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  return { consulted: pending.length, errors };
};

const main = async () => {
  const config = await loadConfig();
  const db = getDb();
  const account = await loadAccount(db, config.uid);

  // Una lectura por reparto: las mismas consultas de alcance que la app.
  const docs: Array<{ snap: DocumentSnapshot; route: string }> = [];
  for (const route of account.routes) {
    for (const query of scopeQueries(db, 'clients', config.uid, route)) {
      const snap = await query.get();
      snap.docs
        .filter((doc) => belongsToProfileScope(doc.data(), config.uid, route.groupId))
        .forEach((doc) => docs.push({ snap: doc, route: route.name }));
    }
  }
  console.error(`Leídas ${docs.length} fichas de ${account.routes.length} reparto(s).`);

  const links = [...new Set(docs.flatMap(({ snap }) => linksWithoutCoordinates(snap.data() || {})))];
  const cache = readCache();
  console.error(`${links.length} links sin coordenadas (${links.filter((link) => cache[link]).length} ya en caché).`);
  const { consulted, errors } = await resolveAll(links, cache);
  const resolved = new Map<string, Coordinates>();
  Object.entries(cache).forEach(([link, value]) => {
    if ('lat' in value) resolved.set(link, value);
  });

  const writer = write ? db.bulkWriter() : null;
  writer?.onWriteError(() => false); // sin reintentos: una condición fallida no se repite
  const planned: Array<{ id: string; nombre: string; reparto: string; updates: Record<string, unknown> }> = [];
  const skipped: Array<{ id: string; nombre: string; motivo: string }> = [];
  const writes: Array<Promise<unknown>> = [];
  for (const { snap, route } of docs) {
    const data = snap.data() || {};
    const updates = coordinateUpdates(data, resolved);
    if (!updates) continue;
    planned.push({ id: snap.id, nombre: data.name || '', reparto: route, updates });
    if (writer) {
      writes.push(writer.update(snap.ref, updates, { lastUpdateTime: snap.updateTime! }).catch((error) => {
        skipped.push({ id: snap.id, nombre: data.name || '', motivo: error?.message || String(error) });
      }));
    }
  }
  if (writer) {
    await writer.close();
    await Promise.all(writes);
  }

  // Cobertura: fichas (sin notas) con lat/lng después de esta corrida.
  const skippedIds = new Set(skipped.map((entry) => entry.id));
  const plannedById = new Map(planned.map((entry) => [entry.id, entry.updates]));
  const fichas = docs.filter(({ snap }) => !snap.data()?.isNote);
  const located = fichas.filter(({ snap }) => {
    const updates = write && !skippedIds.has(snap.id) ? plannedById.get(snap.id) : undefined;
    return !!clientCoordinates({ ...snap.data(), ...(updates || {}) });
  });
  const withoutLink = fichas.filter(({ snap }) => !clientCoordinates(snap.data() || {})
    && !linksWithoutCoordinates(snap.data() || {}).length);
  const unresolved = fichas
    .filter(({ snap }) => !clientCoordinates({ ...snap.data(), ...(plannedById.get(snap.id) || {}) }))
    .flatMap(({ snap, route }) => linksWithoutCoordinates(snap.data() || {}).map((link) => ({
      id: snap.id,
      nombre: snap.data()?.name || '',
      reparto: route,
      inactivo: !!snap.data()?.isInactive,
      link,
      motivo: errors.has(link)
        ? `error de red: ${errors.get(link)}`
        : (cache[link] && 'destino' in cache[link]
          ? `el link no trae coordenadas (lleva a ${(cache[link] as { destino: string }).destino || 'una página sin redirección'})`
          : 'sin resolver'),
    })));

  const report = {
    fecha: new Date().toISOString(),
    modo: write ? 'escritura' : 'solo lectura',
    fichas: fichas.length,
    con_coordenadas: located.length,
    cobertura: fichas.length ? `${Math.round((located.length / fichas.length) * 100)}%` : '0%',
    fichas_completadas: write ? planned.length - skipped.length : 0,
    fichas_a_completar: planned.length,
    links_consultados: consulted,
    sin_link_de_maps: withoutLink.map(({ snap, route }) => ({ id: snap.id, nombre: snap.data()?.name || '', reparto: route, inactivo: !!snap.data()?.isInactive })),
    no_resueltas: unresolved,
    omitidas_por_cambio: skipped,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({
    modo: report.modo, fichas: report.fichas, con_coordenadas: report.con_coordenadas, cobertura: report.cobertura,
    fichas_completadas: report.fichas_completadas, fichas_a_completar: report.fichas_a_completar,
    links_consultados: report.links_consultados, sin_link_de_maps: withoutLink.length,
    links_no_resueltos: unresolved.length, omitidas_por_cambio: skipped.length, reporte: reportPath,
  }, null, 1));
  process.exit(0);
};

main().catch((error) => {
  console.error('No se pudieron completar las coordenadas:', error instanceof Error ? error.message : error);
  process.exit(1);
});
