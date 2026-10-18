// Deja nombres y direcciones de todas las fichas con el mismo formato (tipo
// título, ver formatoTitulo.ts) y actualiza las copias en deudas y
// transferencias, como hace la app al renombrar.
//
//   node dist/formato-nombres.cjs leer                 → lee una vez y guarda una foto local
//   node dist/formato-nombres.cjs muestra <foto>       → antes/después, sin conectarse
//   node dist/formato-nombres.cjs escribir <foto>      → respaldo + escritura
//   node dist/formato-nombres.cjs deshacer <respaldo>  → vuelve a los valores anteriores
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
import { formatoTitulo } from './formatoTitulo';

const dir = process.env.RUTAWATER_FORMATO_DIR || path.join(os.homedir(), '.rutawater-mcp', 'formato-nombres');
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
  writeTime?: Time;
}

const CLIENT_FIELDS = ['name', 'address', 'addresses'];
const COPY_FIELDS = ['clientId', 'customerId', 'clientName', 'clientAddress'];

const pick = (data: Record<string, any>, fields: string[]) => Object.fromEntries(
  fields.filter((field) => data[field] !== undefined).map((field) => [field, data[field]]),
);

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
            data: pick(doc.data(), collection === 'clients' ? [...CLIENT_FIELDS, 'isNote'] : COPY_FIELDS),
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

/** Cambios a escribir a partir de una foto, sin conectarse. */
const planificar = (foto: Foto): Cambio[] => {
  const cambios: Cambio[] = [];
  const nuevoNombre = new Map<string, string>();
  for (const doc of foto.clients) {
    const { data } = doc;
    if (data.isNote) continue;
    const despues: Record<string, any> = {};
    if (typeof data.name === 'string') {
      const name = formatoTitulo(data.name);
      if (name !== data.name) despues.name = name;
      nuevoNombre.set(doc.path.split('/').pop()!, name);
    }
    if (typeof data.address === 'string') {
      const address = formatoTitulo(data.address);
      if (address !== data.address) despues.address = address;
    }
    if (Array.isArray(data.addresses)) {
      const addresses = data.addresses.map((entry: any) => (entry && typeof entry.address === 'string'
        ? { ...entry, address: formatoTitulo(entry.address) } : entry));
      if (JSON.stringify(addresses) !== JSON.stringify(data.addresses)) despues.addresses = addresses;
    }
    if (!Object.keys(despues).length) continue;
    cambios.push({
      path: doc.path, reparto: doc.reparto, tipo: 'cliente', nombre: data.name || '', updateTime: doc.updateTime,
      antes: pick(data, Object.keys(despues)), despues,
    });
  }
  // Deudas y transferencias: clientName sigue al nombre de la ficha (como
  // syncClientNameToRelatedRecords en la app); clientAddress, con el mismo formato.
  for (const tipo of ['debts', 'transfers'] as const) {
    for (const doc of foto[tipo]) {
      const { data } = doc;
      const despues: Record<string, any> = {};
      const name = nuevoNombre.get(data.clientId);
      if (name !== undefined && name.trim() && typeof data.clientName === 'string' && name !== data.clientName) {
        despues.clientName = name;
      }
      if (typeof data.clientAddress === 'string') {
        const address = formatoTitulo(data.clientAddress);
        if (address !== data.clientAddress) despues.clientAddress = address;
      }
      if (!Object.keys(despues).length) continue;
      cambios.push({
        path: doc.path, reparto: doc.reparto, tipo: tipo === 'debts' ? 'deuda' : 'transferencia',
        nombre: data.clientName || '', updateTime: doc.updateTime, antes: pick(data, Object.keys(despues)), despues,
      });
    }
  }
  return cambios;
};

const leerJson = (file: string) => {
  if (!file) throw new Error('Falta el archivo.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const resumen = (cambios: Cambio[]) => ({
  fichas: cambios.filter((cambio) => cambio.tipo === 'cliente').length,
  deudas: cambios.filter((cambio) => cambio.tipo === 'deuda').length,
  transferencias: cambios.filter((cambio) => cambio.tipo === 'transferencia').length,
});

const muestra = (file: string) => {
  const foto: Foto = leerJson(file);
  const cambios = planificar(foto);
  const salida = path.join(dir, `muestra-${stamp()}.json`);
  fs.writeFileSync(salida, JSON.stringify(cambios.map(({ path: p, reparto, tipo, antes, despues }) => ({
    path: p, reparto, tipo, antes, despues,
  })), null, 1));
  console.log(JSON.stringify({ ...resumen(cambios), detalle: salida }, null, 1));
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
  const foto: Foto = leerJson(file);
  await loadConfig();
  const cambios = planificar(foto);
  fs.mkdirSync(dir, { recursive: true });
  const respaldo = path.join(dir, `respaldo-${stamp()}.json`);
  // El respaldo se guarda antes de escribir; después se completa con la hora
  // de cada escritura (condición para deshacer sin pisar cambios posteriores).
  fs.writeFileSync(respaldo, JSON.stringify({ foto: file, estado: 'antes de escribir', cambios }, null, 1));
  const { escritas, omitidas } = await aplicar(cambios, (cambio) => cambio.despues, (cambio) => cambio.updateTime);
  fs.writeFileSync(respaldo, JSON.stringify({ foto: file, estado: 'escrito', cambios: escritas, omitidas }, null, 1));
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

const [command, arg] = process.argv.slice(2);
const run = command === 'leer' ? leer()
  : command === 'muestra' ? Promise.resolve(muestra(arg))
    : command === 'escribir' ? escribir(arg)
      : command === 'deshacer' ? deshacer(arg)
        : Promise.reject(new Error('Uso: leer | muestra <foto> | escribir <foto> | deshacer <respaldo>'));
run.then(() => process.exit(0), (error) => {
  console.error('Formato de nombres:', error instanceof Error ? error.message : error);
  process.exit(1);
});
