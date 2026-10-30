import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Coordinates } from '../../src/utils/geo';
import { Calles, cargarCalles, Propuesta, proponerDireccion } from '../scripts/direccionDesdeMapa';

// Calles de OpenStreetMap para armar la dirección desde un link de Maps
// (Jonathan, 30/10/2026). Overpass tarda o falla seguido, así que primero se
// usan las zonas ya bajadas (las de direcciones-coordenadas y las que baja
// esta herramienta); solo un punto fuera de todas consulta Overpass y guarda
// la zona nueva. Un cuadrado de ~1,3 km de lado alcanza para la calle, las
// esquinas y las menciones (500 m) del armado.
const MARGEN = 0.006;
const dir = () => process.env.RUTAWATER_CALLES_DIR || path.join(os.homedir(), '.rutawater-mcp', 'direcciones');

interface Zona { sur: number; oeste: number; norte: number; este: number; calles: Calles }
const zonas = new Map<string, Zona | null>();

const cargarZona = (file: string): Zona | null => {
  if (zonas.has(file)) return zonas.get(file)!;
  let zona: Zona | null = null;
  try {
    const osm = JSON.parse(fs.readFileSync(file, 'utf8'));
    const lats: number[] = [];
    const lngs: number[] = [];
    (osm.elements || []).forEach((e: any) => (e.geometry || []).forEach((g: any) => { lats.push(g.lat); lngs.push(g.lon); }));
    if (lats.length) {
      zona = {
        sur: Math.min(...lats), oeste: Math.min(...lngs), norte: Math.max(...lats), este: Math.max(...lngs), calles: cargarCalles(osm),
      };
    }
  } catch {
    zona = null;
  }
  zonas.set(file, zona);
  return zona;
};

// La zona tiene que cubrir el punto con margen: las esquinas pueden estar a cientos de metros.
const cubre = (zona: Zona, point: Coordinates): boolean => point.lat - MARGEN >= zona.sur && point.lat + MARGEN <= zona.norte
  && point.lng - MARGEN >= zona.oeste && point.lng + MARGEN <= zona.este;

const consultarCalles = async (point: Coordinates, fetchImpl: typeof fetch): Promise<unknown> => {
  const bbox = [point.lat - 2 * MARGEN, point.lng - 2 * MARGEN, point.lat + 2 * MARGEN, point.lng + 2 * MARGEN]
    .map((n) => n.toFixed(5)).join(',');
  const query = `[out:json][timeout:60];(way["highway"](${bbox});node["place"](${bbox}););out body geom;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetchImpl('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'RutaWater-direcciones/1.0' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`respondió ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(`No se pudo consultar el mapa de calles (${error instanceof Error ? error.message : error}): pasá la dirección escrita.`);
  } finally {
    clearTimeout(timer);
  }
};

const callesPara = async (point: Coordinates, fetchImpl: typeof fetch): Promise<Calles> => {
  const files = fs.existsSync(dir())
    ? fs.readdirSync(dir()).filter((name) => /^calles-.*\.json$/.test(name)).sort().reverse().map((name) => path.join(dir(), name))
    : [];
  for (const file of files) {
    const zona = cargarZona(file);
    if (zona && cubre(zona, point)) return zona.calles;
  }
  const osm = await consultarCalles(point, fetchImpl);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), `calles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(osm));
  } catch {
    // Sin guardar, la próxima vez se vuelve a consultar.
  }
  return cargarCalles(osm);
};

/**
 * «Calle M. x Sol. y esq. A y B (descripción)», como el script de direcciones.
 * `actual` aporta manzana, solar y descripción; vacío (una mudanza) arma solo
 * calle y esquinas, y entonces no es una duda que no nombre ninguna calle.
 */
export const addressFromMap = async (
  point: Coordinates, actual: string, fetchImpl: typeof fetch = fetch,
): Promise<Propuesta> => {
  const propuesta = proponerDireccion(await callesPara(point, fetchImpl), point, actual);
  return actual.trim() ? propuesta : { ...propuesta, dudas: propuesta.dudas.filter((duda) => !duda.startsWith('sin calle actual')) };
};
