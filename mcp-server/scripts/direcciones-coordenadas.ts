// Rehace las direcciones de las fichas a partir de sus coordenadas, con las
// calles de OpenStreetMap: «Calle M. x Sol. y esq. A y B (descripción)». La
// manzana, el solar y la descripción salen de la dirección actual (ver
// direccionDesdeMapa.ts). Actualiza también las copias en deudas y
// transferencias. Parentesco guarda solo ids: no hay nada que copiar.
//
//   node dist/direcciones-coordenadas.cjs leer                       → lee una vez y guarda una foto local
//   node dist/direcciones-coordenadas.cjs calles <foto>              → baja las calles de la zona (una consulta a Overpass)
//   node dist/direcciones-coordenadas.cjs propuesta <foto> <calles>  → antes/después y dudosas, sin conectarse
//   node dist/direcciones-coordenadas.cjs escribir <propuesta>       → respaldo + escritura de las no dudosas
//   node dist/direcciones-coordenadas.cjs deshacer <respaldo>        → vuelve a los valores anteriores
//
// Mismas variables que el servidor (GOOGLE_APPLICATION_CREDENTIALS y
// RUTAWATER_EMAIL o RUTAWATER_UID). Cuidado con la cuota de Firestore: `leer`
// hace una consulta por colección y reparto (sin listeners ni reintentos);
// `escribir` y `deshacer` no leen nada. Cada escritura lleva como condición
// la hora de actualización de la foto: si la ficha cambió desde entonces no se
// pisa y queda informada.
process.env.TZ = process.env.RUTAWATER_TZ || 'America/Montevideo';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Timestamp } from 'firebase-admin/firestore';
import { getDb, loadConfig } from '../src/config';
import { loadAccount } from '../src/routes';
import { scopeQueries } from '../src/store';
import { belongsToProfileScope } from '../../src/utils/profileScope';
import { Calles, Propuesta, cargarCalles, proponerDireccion } from './direccionDesdeMapa';

const dir = process.env.RUTAWATER_DIRECCIONES_DIR || path.join(os.homedir(), '.rutawater-mcp', 'direcciones');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

type Time = { seconds: number; nanoseconds: number };
interface Doc { path: string; reparto: string; updateTime: Time; data: Record<string, any> }
interface Foto { fecha: string; uid: string; clients: Doc[]; debts: Doc[]; transfers: Doc[] }
interface Cambio {
  path: string;
  reparto: string;
  tipo: 'cliente' | 'deuda' | 'transferencia';
  nombre: string;
  updateTime: Time;
  antes: Record<string, any>;
  despues: Record<string, any>;
  dudas: string[];
  writeTime?: Time;
}

const CLIENT_FIELDS = ['name', 'address', 'addresses', 'lat', 'lng', 'isNote', 'isInactive', 'freq'];
const COPY_FIELDS = ['clientId', 'customerId', 'clientName', 'clientAddress'];

const pick = (data: Record<string, any>, fields: string[]) => Object.fromEntries(
  fields.filter((field) => data[field] !== undefined).map((field) => [field, data[field]]),
);

const leerJson = (file: string) => {
  if (!file) throw new Error('Falta el archivo.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const leer = async () => {
  const config = await loadConfig();
  const db = getDb();
  const account = await loadAccount(db, config.uid);
  const foto: Foto = { fecha: new Date().toISOString(), uid: config.uid, clients: [], debts: [], transfers: [] };
  for (const collection of ['clients', 'debts', 'transfers'] as const) {
    for (const route of account.routes) {
      for (const query of scopeQueries(db, collection, config.uid, route)) {
        const snap = await query.get();
        snap.docs
          .filter((doc) => belongsToProfileScope(doc.data(), config.uid, route.groupId))
          .forEach((doc) => foto[collection].push({
            path: doc.ref.path,
            reparto: route.name,
            updateTime: { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds },
            data: pick(doc.data(), collection === 'clients' ? CLIENT_FIELDS : COPY_FIELDS),
          }));
      }
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `foto-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(foto, null, 1));
  console.log(JSON.stringify({
    repartos: account.routes.map((route) => route.name),
    fichas: foto.clients.length, deudas: foto.debts.length, transferencias: foto.transfers.length, foto: file,
  }, null, 1));
};

const puntos = (foto: Foto) => foto.clients.flatMap(({ data }) => [
  { lat: data.lat, lng: data.lng },
  ...(Array.isArray(data.addresses) ? data.addresses : []),
]).map((p: any) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
  .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== 0 && p.lng !== 0);

/** Una sola consulta a Overpass con las calles (y los barrios) de la zona de las fichas. */
const calles = async (file: string) => {
  const foto: Foto = leerJson(file);
  const ps = puntos(foto);
  const margen = 0.01;
  const bbox = [
    Math.min(...ps.map((p) => p.lat)) - margen, Math.min(...ps.map((p) => p.lng)) - margen,
    Math.max(...ps.map((p) => p.lat)) + margen, Math.max(...ps.map((p) => p.lng)) + margen,
  ].map((n) => n.toFixed(5)).join(',');
  const query = `[out:json][timeout:180];(way["highway"](${bbox});node["place"](${bbox}););out body geom;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RutaWater-direcciones/1.0 (script de una sola vez; jonaolivera23@gmail.com)',
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) throw new Error(`Overpass respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const osm = (await response.json()) as { elements?: unknown[] };
  fs.mkdirSync(dir, { recursive: true });
  const salida = path.join(dir, `calles-${stamp()}.json`);
  fs.writeFileSync(salida, JSON.stringify(osm));
  console.log(JSON.stringify({ bbox, puntos: ps.length, elementos: osm.elements?.length, calles: salida }, null, 1));
};

/** Cambios a escribir a partir de una foto y las calles, sin conectarse. */
const planificar = (foto: Foto, mapa: Calles) => {
  const cambios: Cambio[] = [];
  const sinCoordenadas: Array<{ path: string; nombre: string; direccion: string }> = [];
  // Dirección vieja → nueva por ficha, para las copias en deudas y transferencias.
  const nuevas = new Map<string, Map<string, string>>();
  for (const doc of foto.clients) {
    const { data } = doc;
    if (data.isNote) continue;
    const id = doc.path.split('/').pop()!;
    const reemplazos = new Map<string, string>();
    const dudas: string[] = [];
    const despues: Record<string, any> = {};
    const proponer = (direccion: string, lat: unknown, lng: unknown): Propuesta | null => {
      const punto = { lat: Number(lat), lng: Number(lng) };
      if (!Number.isFinite(punto.lat) || !Number.isFinite(punto.lng) || !punto.lat || !punto.lng) return null;
      return proponerDireccion(mapa, punto, direccion || '');
    };
    const principal = proponer(data.address, data.lat, data.lng);
    if (!principal) {
      sinCoordenadas.push({ path: doc.path, nombre: data.name || '', direccion: data.address || '' });
    } else {
      dudas.push(...principal.dudas);
      if (principal.direccion !== data.address) {
        despues.address = principal.direccion;
        reemplazos.set(data.address || '', principal.direccion);
      }
    }
    if (Array.isArray(data.addresses)) {
      let cambiaron = false;
      const addresses = data.addresses.map((entry: any) => {
        if (!entry || typeof entry.address !== 'string') return entry;
        // La ubicación principal es la misma que la primera de la lista.
        const propuesta = entry.address === data.address && principal
          && (entry.lat === undefined || (entry.lat === data.lat && entry.lng === data.lng))
          ? principal : proponer(entry.address, entry.lat, entry.lng);
        if (!propuesta) return entry;
        if (propuesta !== principal) dudas.push(...propuesta.dudas.map((duda) => `otra ubicación: ${duda}`));
        if (propuesta.direccion === entry.address) return entry;
        cambiaron = true;
        reemplazos.set(entry.address, propuesta.direccion);
        return { ...entry, address: propuesta.direccion };
      });
      if (cambiaron) despues.addresses = addresses;
    }
    nuevas.set(id, reemplazos);
    if (!Object.keys(despues).length) continue;
    cambios.push({
      path: doc.path, reparto: doc.reparto, tipo: 'cliente', nombre: data.name || '', updateTime: doc.updateTime,
      antes: pick(data, Object.keys(despues)), despues, dudas: [...new Set(dudas)],
    });
  }
  // Deudas y transferencias: clientAddress sigue a la dirección de la ficha
  // cuando era una copia de una de sus ubicaciones.
  const copiasSueltas: Array<{ path: string; nombre: string; direccion: string }> = [];
  for (const tipo of ['debts', 'transfers'] as const) {
    for (const doc of foto[tipo]) {
      const { data } = doc;
      if (typeof data.clientAddress !== 'string' || !data.clientAddress) continue;
      const reemplazos = nuevas.get(data.clientId);
      if (!reemplazos) continue;
      const nueva = reemplazos.get(data.clientAddress);
      if (nueva === undefined) {
        const cliente = foto.clients.find((c) => c.path.endsWith(`/${data.clientId}`));
        if (cliente && cliente.data.address !== data.clientAddress) {
          copiasSueltas.push({ path: doc.path, nombre: data.clientName || '', direccion: data.clientAddress });
        }
        continue;
      }
      cambios.push({
        path: doc.path, reparto: doc.reparto, tipo: tipo === 'debts' ? 'deuda' : 'transferencia',
        nombre: data.clientName || '', updateTime: doc.updateTime,
        antes: { clientAddress: data.clientAddress }, despues: { clientAddress: nueva }, dudas: [],
      });
    }
  }
  return { cambios, sinCoordenadas, copiasSueltas };
};

const resumen = (cambios: Cambio[]) => ({
  fichas: cambios.filter((cambio) => cambio.tipo === 'cliente').length,
  deudas: cambios.filter((cambio) => cambio.tipo === 'deuda').length,
  transferencias: cambios.filter((cambio) => cambio.tipo === 'transferencia').length,
});

const propuesta = (fileFoto: string, fileCalles: string) => {
  const foto: Foto = leerJson(fileFoto);
  const mapa = cargarCalles(leerJson(fileCalles));
  const { cambios, sinCoordenadas, copiasSueltas } = planificar(foto, mapa);
  const dudosas = cambios.filter((cambio) => cambio.dudas.length);
  const motivos: Record<string, number> = {};
  dudosas.flatMap((cambio) => cambio.dudas.map((duda) => duda.split(':')[0]))
    .forEach((motivo) => { motivos[motivo] = (motivos[motivo] || 0) + 1; });
  fs.mkdirSync(dir, { recursive: true });
  const salida = path.join(dir, `propuesta-${stamp()}.json`);
  fs.writeFileSync(salida, JSON.stringify({
    foto: fileFoto, calles: fileCalles, cambios, sinCoordenadas, copiasSueltas,
  }, null, 1));
  console.log(JSON.stringify({
    ...resumen(cambios),
    dudosas: dudosas.length,
    motivos,
    sin_coordenadas: sinCoordenadas.length,
    copias_que_no_coinciden: copiasSueltas.length,
    propuesta: salida,
  }, null, 1));
};

/** Escribe con BulkWriter, sin reintentos, condicionado a la hora de actualización. */
const aplicar = async (cambios: Cambio[], valores: (cambio: Cambio) => Record<string, any>, hora: (cambio: Cambio) => Time) => {
  const db = getDb();
  const writer = db.bulkWriter();
  writer.onWriteError(() => false);
  const omitidas: Array<{ path: string; nombre: string; motivo: string }> = [];
  const escritas: Cambio[] = [];
  const writes = cambios.map((cambio) => {
    const { seconds, nanoseconds } = hora(cambio);
    return writer.update(db.doc(cambio.path), valores(cambio), { lastUpdateTime: new Timestamp(seconds, nanoseconds) })
      .then((result) => {
        escritas.push({ ...cambio, writeTime: { seconds: result.writeTime.seconds, nanoseconds: result.writeTime.nanoseconds } });
      })
      .catch((error) => {
        omitidas.push({ path: cambio.path, nombre: cambio.nombre, motivo: error?.message || String(error) });
      });
  });
  await writer.close();
  await Promise.all(writes);
  return { escritas, omitidas };
};

const escribir = async (file: string) => {
  const plan = leerJson(file);
  await loadConfig();
  // Las dudosas no se cambian solas; una deuda o transferencia sigue a su ficha.
  const fichas = new Set((plan.cambios as Cambio[])
    .filter((cambio) => cambio.tipo === 'cliente' && !cambio.dudas.length)
    .map((cambio) => cambio.path.split('/').pop()));
  const foto: Foto = leerJson(plan.foto);
  const clienteDe = new Map(foto[`debts`].concat(foto.transfers).map((doc) => [doc.path, doc.data.clientId]));
  const cambios = (plan.cambios as Cambio[]).filter((cambio) => (cambio.tipo === 'cliente'
    ? !cambio.dudas.length : fichas.has(clienteDe.get(cambio.path))));
  fs.mkdirSync(dir, { recursive: true });
  const respaldo = path.join(dir, `respaldo-${stamp()}.json`);
  // El respaldo se guarda antes de escribir; después se completa con la hora
  // de cada escritura (condición para deshacer sin pisar cambios posteriores).
  fs.writeFileSync(respaldo, JSON.stringify({ propuesta: file, estado: 'antes de escribir', cambios }, null, 1));
  const { escritas, omitidas } = await aplicar(cambios, (cambio) => cambio.despues, (cambio) => cambio.updateTime);
  fs.writeFileSync(respaldo, JSON.stringify({ propuesta: file, estado: 'escrito', cambios: escritas, omitidas }, null, 1));
  console.log(JSON.stringify({ escritas: resumen(escritas), omitidas, respaldo }, null, 1));
};

const deshacer = async (file: string) => {
  const respaldo = leerJson(file);
  await loadConfig();
  const cambios: Cambio[] = (respaldo.cambios || []).filter((cambio: Cambio) => cambio.writeTime);
  const { escritas, omitidas } = await aplicar(cambios, (cambio) => cambio.antes, (cambio) => cambio.writeTime!);
  const salida = path.join(dir, `deshecho-${stamp()}.json`);
  fs.writeFileSync(salida, JSON.stringify({ respaldo: file, restauradas: escritas.map((c) => c.path), omitidas }, null, 1));
  console.log(JSON.stringify({ restauradas: resumen(escritas), omitidas, detalle: salida }, null, 1));
};

const [command, arg, arg2] = process.argv.slice(2);
const run = command === 'leer' ? leer()
  : command === 'calles' ? calles(arg)
    : command === 'propuesta' ? Promise.resolve(propuesta(arg, arg2))
      : command === 'escribir' ? escribir(arg)
        : command === 'deshacer' ? deshacer(arg)
          : Promise.reject(new Error('Uso: leer | calles <foto> | propuesta <foto> <calles> | escribir <propuesta> | deshacer <respaldo>'));
run.then(() => process.exit(0), (error) => {
  console.error('Direcciones:', error instanceof Error ? error.message : error);
  process.exit(1);
});
