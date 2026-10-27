import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import type { Client } from '../../src/types';
import { DELIVERIES_COLLECTION } from '../../src/utils/deliveryRecords';
import type { Account, Route } from './routes';
import { scopeQueries } from './store';

// Historial de visitas por cliente (Jonathan, 27/10/2026): el registro de
// entregas que escriben la app y este servidor con cada Listo, más las fotos
// nocturnas de la agenda (historial.mjs) para las fechas anteriores al registro.

const DAY_MS = 86400e3;
const env = (name: string, fallback: string) => (process.env[name] || '').trim() || fallback;
const photosDir = () => env('RUTAWATER_HISTORIAL_DIR', join(homedir(), '.codex/skills/whatsapp-rutawater/historial'));

export interface DeliveryRow {
  fecha: string;
  cliente_id: string;
  customer_id: string;
  nombre: string;
  direccion: string;
  entrega: boolean;
  productos: Record<string, number>;
  origen: 'registro' | 'foto';
  // Quién escribió el registro: la app (cada Listo) o el asistente (vigilante).
  fuente?: string;
}

const quantity = (value: unknown): number => {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const cleanProducts = (products: Record<string, unknown> | undefined): Record<string, number> =>
  Object.fromEntries(Object.entries(products || {}).map(([id, qty]) => [id, quantity(qty)]).filter(([, qty]) => qty));

const inRoute = (data: Record<string, any>, uid: string, route: Route) =>
  route.groupId ? data.groupId === route.groupId : (!data.groupId && data.userId === uid);

/** Registro de entregas de los repartos de la cuenta (sin las deshechas). */
export const loadDeliveryRecords = async (
  db: Firestore, account: Account, filter: { customerId?: string; desde?: string; hasta?: string } = {},
): Promise<DeliveryRow[]> => {
  const rows = new Map<string, DeliveryRow>();
  for (const route of account.routes) {
    for (const base of scopeQueries(db, DELIVERIES_COLLECTION, account.uid, route)) {
      const query = filter.customerId ? base.where('customerId', '==', filter.customerId) : base;
      for (const doc of (await query.get()).docs) {
        const data = doc.data();
        if (data.undone === true || !inRoute(data, account.uid, route)) continue;
        const fecha = String(data.occurrence || '');
        if ((filter.desde && fecha < filter.desde) || (filter.hasta && fecha > filter.hasta)) continue;
        rows.set(doc.id, {
          fecha, cliente_id: String(data.clientId || ''), customer_id: String(data.customerId || data.clientId || ''),
          nombre: String(data.clientName || ''), direccion: String(data.clientAddress || ''),
          entrega: data.delivered !== false, productos: data.delivered === false ? {} : cleanProducts(data.products),
          origen: 'registro', fuente: String(data.source || ''),
        });
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
};

/**
 * Fotos de la agenda (la noche anterior a cada reparto): lo agendado, no lo
 * entregado. Los productos vienen por nombre; se pasan a id con el catálogo.
 */
export const loadPhotoRows = (
  catalog: Array<{ id: string; nombre: string }>, filter: { ids?: Set<string>; desde?: string; hasta?: string } = {},
): DeliveryRow[] => {
  const dir = photosDir();
  if (!existsSync(dir)) return [];
  const idByName = new Map(catalog.map((product) => [product.nombre.toLowerCase(), product.id]));
  const rows: DeliveryRow[] = [];
  for (const file of readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()) {
    const fecha = file.slice(0, 10);
    if ((filter.desde && fecha < filter.desde) || (filter.hasta && fecha > filter.hasta)) continue;
    let photo: { registros?: Array<Record<string, any>> };
    try { photo = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { continue; }
    for (const record of photo.registros || []) {
      if (filter.ids && !filter.ids.has(record.id)) continue;
      const productos = Object.fromEntries(Object.entries(record.productos || {})
        .map(([name, qty]) => [idByName.get(name.toLowerCase()) || name, quantity(qty)])
        .filter(([, qty]) => qty));
      rows.push({
        fecha, cliente_id: record.id, customer_id: record.id, nombre: record.nombre || '', direccion: record.direccion || '',
        entrega: true, productos, origen: 'foto',
      });
    }
  }
  return rows;
};

/**
 * Registro donde lo hay; para las fechas sin registro de ese cliente, la foto.
 * Desde que la app registra los Listo (primer registro con fuente «app»), una
 * foto sin registro es una visita que no se marcó o se movió: no cuenta. Antes
 * de eso solo registraba el vigilante y la foto es lo único que hay.
 */
export const mergeHistory = (records: DeliveryRow[], photos: DeliveryRow[], appSince?: string): DeliveryRow[] => {
  const recorded = new Set(records.map((row) => `${row.cliente_id}|${row.fecha}`));
  const cutoff = appSince ?? records.filter((row) => row.fuente === 'app')
    .reduce((min, row) => (!min || row.fecha < min ? row.fecha : min), '');
  const extra = photos.filter((row) => !recorded.has(`${row.cliente_id}|${row.fecha}`) && (!cutoff || row.fecha < cutoff));
  return [...records, ...extra].sort((a, b) => a.fecha.localeCompare(b.fecha));
};

/** Primer día en que la app registró un Listo en la cuenta (null: todavía ninguno). */
export const appRecordsSince = async (db: Firestore, account: Account): Promise<string | null> => {
  let first: string | null = null;
  for (const route of account.routes) {
    for (const base of scopeQueries(db, DELIVERIES_COLLECTION, account.uid, route)) {
      for (const doc of (await base.where('source', '==', 'app').get()).docs) {
        const fecha = String(doc.data().occurrence || '');
        if (fecha && (!first || fecha < first)) first = fecha;
      }
    }
  }
  return first;
};

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Lo que el vigilante necesita saber de un cliente antes de contestarle. */
export const summarizeHistory = (client: Client, rows: DeliveryRow[], today: string) => {
  const delivered = rows.filter((row) => row.entrega && Object.keys(row.productos).length);
  const since90 = new Date(Date.parse(`${today}T12:00:00Z`) - 90 * DAY_MS).toISOString().slice(0, 10);
  const recent = delivered.filter((row) => row.fecha >= since90);
  const totals: Record<string, number> = {};
  recent.forEach((row) => Object.entries(row.productos).forEach(([id, qty]) => { totals[id] = (totals[id] || 0) + qty; }));
  const gaps = delivered.slice(1).map((row, index) =>
    Math.round((Date.parse(row.fecha) - Date.parse(delivered[index].fecha)) / DAY_MS));
  const usual = new Map<string, number>();
  recent.forEach((row) => {
    const key = JSON.stringify(Object.entries(row.productos).sort());
    usual.set(key, (usual.get(key) || 0) + 1);
  });
  const [usualKey, usualCount] = [...usual.entries()].sort((a, b) => b[1] - a[1])[0] || ['[]', 0];
  return {
    cliente_id: client.id,
    nombre: client.name,
    visitas_registradas: rows.length,
    desde: rows[0]?.fecha || null,
    ultima_entrega: delivered[delivered.length - 1]?.fecha || null,
    no_necesito: rows.filter((row) => !row.entrega).length,
    entregas_90_dias: recent.length,
    productos_90_dias: totals,
    suele_llevar: usualCount ? { productos: Object.fromEntries(JSON.parse(usualKey)), veces: usualCount, de: recent.length } : null,
    dias_entre_entregas: median(gaps),
    ultimas: rows.slice(-10).reverse().map((row) => ({
      fecha: row.fecha,
      ...(row.entrega ? { productos: row.productos } : { no_necesito: true }),
      ...(row.origen === 'foto' ? { segun: 'agenda (no confirma que se entregó)' } : {}),
    })),
  };
};
