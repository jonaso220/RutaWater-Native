// Dirección a partir de un punto y las calles de OpenStreetMap:
// «Calle M. x Sol. y esq. A y B (descripción)».
// - Calle: la más cercana al punto; si la dirección actual nombra una calle
//   que pasa casi igual de cerca, esa (el pin suele caer en el medio del
//   terreno, a veces más cerca de la calle lateral).
// - Manzana, solar y unidad: tal cual de la dirección actual.
// - Esquinas: recorriendo la calle desde el punto hacia cada lado, la primera
//   calle con nombre que la cruza.
// - Descripción: lo que queda de la dirección actual sin calles, barrios,
//   manzana ni solar («casa de ladrillo», el comercio, «vecina de…»).
// Las dudas (punto lejos, calle sin nombre, esquina que falta, calle distinta
// de la actual, texto que parece una calle) quedan para revisar a mano.
import { formatoTitulo } from './formatoTitulo';

interface Punto { lat: number; lng: number }
interface Via { id: number; nombre: string | null; clave: string; nodos: number[]; xy: Array<[number, number]> }
interface Forma { clave: string; tokens: string[] }
// Débil: solo el apellido o las últimas palabras («Rivera», «Mariano Soler»).
interface Nombre { tokens: string[]; debil: boolean }
export interface Calles {
  vias: Via[];
  porNodo: Map<number, number[]>;
  grilla: Map<string, Array<[number, number]>>; // celda → [vía, segmento]
  formas: Map<string, Nombre[]>; // clave → formas de nombrarla
  completas: Map<string, Forma[]>; // primer token → formas completas (para calles lejanas)
  mostrar: Map<string, string>; // clave → nombre a escribir
  barrios: string[][];
}
export interface Propuesta {
  direccion: string;
  dudas: string[];
  calle?: string;
  esquinas?: string[];
  distancia?: number;
  descripcion?: string;
}

const LAT0 = -34.8;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const MY = 110540;
const xy = (p: Punto): [number, number] => [p.lng * MX, p.lat * MY];
const CELDA = 200;
const celda = (x: number, y: number) => `${Math.floor(x / CELDA)},${Math.floor(y / CELDA)}`;

const CALLES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'road', 'track', 'service', 'pedestrian', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
// Sin nombre, estas no cuentan como «calle sin nombre» (entradas, caminos de campo).
const MENORES = new Set(['service', 'track', 'pedestrian']);

const LIMITE_LEJOS = 60;
const MARGEN_CALLE_ACTUAL = 25;
const RADIO_MENCION = 500;
const LIMITE_ESQUINA = 700;

// ——— Texto ———

export const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/(\d)(?=[a-z])|([a-z])(?=\d)/g, '$1$2 ');

const tokens = (texto: string) => normalizar(texto).match(/[a-z0-9ñ]+/g) || [];

// Palabras que preceden al nombre y se pueden omitir al nombrar la calle.
const TITULOS = new Set([
  'calle', 'avenida', 'av', 'avda', 'pasaje', 'camino', 'cno', 'cam', 'diag', 'cjon', 'callejon', 'rambla', 'bulevar', 'diagonal', 'senda', 'paseo',
  'ruta', 'doctor', 'dr', 'dra', 'doctora', 'general', 'gral', 'ingeniero', 'ing', 'profesor', 'profesora', 'prof',
  'maestro', 'maestra', 'capitan', 'cap', 'presidente', 'pte', 'coronel', 'cnel', 'arquitecto', 'arq', 'brigadier',
  'teniente', 'tte', 'escribano', 'esc', 'padre', 'monsenor', 'senador', 'diputado', 'comandante', 'almirante',
  'mariscal', 'cardenal', 'contador', 'cr',
]);
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);
const significativo = (t: string) => !TITULOS.has(t) && !VACIAS.has(t);

// Nombres oficiales largos → como se dicen.
const ABREVIADO: Record<string, string> = {
  'Ruta Interbalnearia General Líber Seregni': 'Interbalnearia',
  'Avenida Ingeniero Luis Giannattasio': 'Av. Giannattasio',
  'Rambla Costanera Ruta 10': 'Rambla Costanera',
};
const OTROS_NOMBRES: Record<string, string[]> = {
  'Ruta Interbalnearia General Líber Seregni': ['Inter', 'Ruta Inter', 'Ruta Interbalnearia', 'Ruta IB'],
  'Avenida Ingeniero Luis Giannattasio': ['Giannattasio', 'Gianattasio', 'Giannatasio'],
  'Rambla Costanera Ruta 10': ['Ruta 10', 'Rambla'],
};
// Títulos que se quitan del nombre a escribir si quedan dos palabras o más.
const TITULO_A_QUITAR = /^(General|Gral\.|Doctor|Doctora|Dr\.|Ingeniero|Ing\.|Profesor|Profesora|Prof\.|Presidente|Monseñor|Capitán|Coronel|Arquitecto|Brigadier|Teniente|Escribano|Contador|Cardenal|Maestro|Maestra|Comandante|Almirante|Mariscal|Senador)\s+/;

export const nombreParaMostrar = (original: string) => {
  let nombre = (ABREVIADO[original] || original).replace(/\.(?=\p{L})/gu, '. ').replace(/\s+/g, ' ').trim();
  nombre = nombre.replace(/^Ruta (\d+) .*$/, 'Ruta $1');
  const prefijo = nombre.match(/^(Avenida|Av\.|Rambla|Camino|Bulevar|Diagonal|Pasaje)\s+/)?.[0] || '';
  let resto = nombre.slice(prefijo.length);
  for (;;) {
    const m = resto.match(TITULO_A_QUITAR);
    if (!m) break;
    const sin = resto.slice(m[0].length);
    if (sin.split(' ').filter((w) => !VACIAS.has(normalizar(w))).length < 2) break;
    resto = sin;
  }
  return formatoTitulo(`${prefijo.replace(/^Avenida\s+/, 'Av. ')}${resto}`);
};

/** Formas de nombrar una calle: completa, sin títulos, últimas palabras, apellido. */
const formas = (nombre: string): Nombre[] => {
  const todas = tokens(nombre);
  if (!todas.length) return [];
  let i = 0;
  while (i < todas.length - 1 && !significativo(todas[i])) i += 1;
  const sin = todas.slice(i);
  const salida: Nombre[] = [{ tokens: todas, debil: false }, { tokens: sin, debil: false }];
  for (let k = 1; k < sin.length - 1; k += 1) {
    const sufijo = sin.slice(k);
    if (significativo(sufijo[0])) salida.push({ tokens: sufijo, debil: true });
  }
  const ultimo = sin[sin.length - 1];
  if (sin.length >= 2 && ultimo.length >= 4 && !/\d/.test(sin.join(' ')) && significativo(ultimo)) {
    salida.push({ tokens: [ultimo], debil: true });
  }
  // Nombres largos por la primera palabra («Brounerau» por «Brounerau Des Houillers»).
  if (sin.length >= 2 && sin[0].length >= 8 && significativo(sin[0])) salida.push({ tokens: [sin[0]], debil: true });
  // «Calle 5» también se escribe «C. 5».
  if (todas[0] === 'calle' && todas.length > 1) salida.push({ tokens: ['c', ...todas.slice(1)], debil: false });
  // Una letra suelta («Calle B» → «B») no alcanza para reconocer la calle.
  return salida.filter(({ tokens: f }) => !(f.length === 1 && f[0].length <= 2 && !/^\d+$/.test(f[0])));
};

const distanciaEdicion = (a: string, b: string) => {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const arriba = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = arriba;
    }
  }
  return fila[b.length];
};

const parecido = (t: string, f: string, minimo: number) => t !== f && significativo(f) && !/\d/.test(t + f)
  && t.length >= minimo && f.length >= minimo && t[0] === f[0]
  && distanciaEdicion(t, f) <= (Math.min(t.length, f.length) >= 8 ? 2 : 1);

/**
 * Cuántos tokens del texto, desde `desde`, nombran esta forma (0 si no).
 * Flexible: admite errores de tipeo, iniciales («Horacio G. Lagos»),
 * abreviaturas («Gral»), palabras pegadas («Park Way») y vacías que faltan.
 */
const coincide = (texto: string[], desde: number, forma: string[], flexible: boolean): number => {
  const memo = new Map<string, number>();
  const paso = (i: number, j: number, llenas: number): number => {
    if (j === forma.length) return llenas > 0 ? i : -1;
    const key = `${i},${j},${llenas > 0 ? 1 : 0}`;
    if (memo.has(key)) return memo.get(key)!;
    const t = texto[i];
    const f = forma[j];
    const suma = significativo(f) ? 1 : 0;
    let mejor = -1;
    const probar = (n: number) => { if (n > mejor) mejor = n; };
    if (t !== undefined) {
      if (t === f) probar(paso(i + 1, j + 1, llenas + suma));
      if (flexible) {
        if (parecido(t, f, llenas > 0 ? 4 : 5)) probar(paso(i + 1, j + 1, llenas + 1));
        if (texto[i + 1] !== undefined && t + texto[i + 1] === f) probar(paso(i + 2, j + 1, llenas + 1));
        if (t.length === 1 && f.length > 1 && f.startsWith(t) && !/\d/.test(t) && (llenas > 0 || !'yeoau'.includes(t))) {
          probar(paso(i + 1, j + 1, llenas));
        }
        if (t.length >= 3 && f.length > t.length && f.startsWith(t) && (llenas > 0 || j < forma.length - 1)) {
          probar(paso(i + 1, j + 1, llenas));
        }
        if (t.length >= 5 && f.length > t.length && f.startsWith(t) && significativo(f)) probar(paso(i + 1, j + 1, llenas + 1));
      }
      if (VACIAS.has(t) && j > 0) probar(paso(i + 1, j, llenas));
    }
    if (VACIAS.has(f)) probar(paso(i, j + 1, llenas));
    memo.set(key, mejor);
    return mejor;
  };
  const fin = paso(desde, 0, 0);
  // Que no termine en una vacía del texto («Pinos y»).
  let hasta = fin;
  while (hasta > desde && VACIAS.has(texto[hasta - 1])) hasta -= 1;
  return fin > desde ? hasta - desde : 0;
};

// ——— Carga ———

const BARRIOS = ['ciudad de la costa', 'canelones', 'uruguay', 'el pinar', 'lagomar', 'solymar', 'shangrila',
  'san jose de carrasco', 'salinas norte', 'lomas de solymar', 'parque de solymar', 'colinas de solymar',
  'medanos de solymar', 'barra de carrasco', 'paso carrasco', 'parque carrasco', 'lagomar norte', 'lagomar sur',
  'el pinar norte', 'el pinar sur', 'pinar norte', 'pinar sur', 'neptunia', 'pinamar', 'salinas', 'atlantida',
  'montes de solymar', 'colonia nicolich', 'villa aeroparque', 'aeroparque', 'parque miramar',
  'san jose de carrasco norte', 'costa azul', 'la tahona', 'carrasco', 'pinamar norte', 'neptunia norte',
  'neptunia sur', 'pinamar sur', 'salinas sur', 'pinar', 'shangrilá'];

export const cargarCalles = (osm: any): Calles => {
  const vias: Via[] = [];
  const porNodo = new Map<number, number[]>();
  const grilla = new Map<string, Array<[number, number]>>();
  const formasPorClave = new Map<string, Map<string, Nombre>>();
  const mostrar = new Map<string, string>();
  const barrios: string[][] = BARRIOS.map(tokens);
  for (const e of osm.elements || []) {
    if (e.type === 'node' && e.tags?.place && e.tags.name) {
      barrios.push(tokens(e.tags.name));
      continue;
    }
    if (e.type !== 'way' || !CALLES.has(e.tags?.highway) || !e.geometry) continue;
    const nombre: string | null = e.tags.name || null;
    if (!nombre && MENORES.has(e.tags.highway)) continue;
    const clave = nombre ? tokens(nombreParaMostrar(nombre)).join(' ') : '';
    const via: Via = { id: vias.length, nombre, clave, nodos: e.nodes, xy: e.geometry.map((g: any) => xy({ lat: g.lat, lng: g.lon })) };
    vias.push(via);
    via.nodos.forEach((n) => porNodo.set(n, [...(porNodo.get(n) || []), via.id]));
    for (let s = 0; s < via.xy.length - 1; s += 1) {
      const [x1, y1] = via.xy[s];
      const [x2, y2] = via.xy[s + 1];
      const pasos = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (CELDA / 2)));
      const vistas = new Set<string>();
      for (let k = 0; k <= pasos; k += 1) {
        const c = celda(x1 + ((x2 - x1) * k) / pasos, y1 + ((y2 - y1) * k) / pasos);
        if (vistas.has(c)) continue;
        vistas.add(c);
        grilla.set(c, [...(grilla.get(c) || []), [via.id, s]]);
      }
    }
    if (!nombre) continue;
    if (!mostrar.has(clave)) mostrar.set(clave, nombreParaMostrar(nombre));
    const propias = formasPorClave.get(clave) || new Map<string, Nombre>();
    formasPorClave.set(clave, propias);
    // El nombre actual y los anteriores o alternativos («Calle 71», «Ex Misiones»).
    const variantes = [nombre, nombreParaMostrar(nombre), ...(OTROS_NOMBRES[nombre] || []),
      ...['alt_name', 'old_name', 'loc_name', 'short_name'].flatMap((k) => (e.tags[k] ? String(e.tags[k]).split(';') : []))];
    variantes.flatMap(formas).forEach((f) => {
      const previa = propias.get(f.tokens.join(' '));
      if (!previa || previa.debil) propias.set(f.tokens.join(' '), f);
    });
  }
  const formasFinal = new Map<string, Nombre[]>();
  const completas = new Map<string, Forma[]>();
  formasPorClave.forEach((propias, clave) => {
    const lista = [...propias.values()];
    formasFinal.set(clave, lista);
    // Para calles lejanas solo cuentan nombres de dos palabras significativas o más.
    lista.forEach(({ tokens: f, debil }) => {
      if (debil) return;
      let i = 0;
      while (i < f.length && !significativo(f[i])) i += 1;
      const desdeSignificativo = f.slice(i);
      if (desdeSignificativo.filter(significativo).length < 2) return;
      const primero = desdeSignificativo[0];
      completas.set(primero, [...(completas.get(primero) || []), { clave, tokens: desdeSignificativo }]);
    });
  });
  barrios.sort((a, b) => b.length - a.length);
  return { vias, porNodo, grilla, formas: formasFinal, completas, mostrar, barrios };
};

// ——— Geometría ———

interface Cercana { via: Via; seg: number; t: number; d: number }

const proyectar = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return { t, d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) };
};

/** La mejor ubicación sobre cada vía cercana. */
const cercanas = (mapa: Calles, p: [number, number], radio: number): Cercana[] => {
  const mejor = new Map<number, Cercana>();
  const r = Math.ceil(radio / CELDA);
  const cx = Math.floor(p[0] / CELDA);
  const cy = Math.floor(p[1] / CELDA);
  for (let i = -r; i <= r; i += 1) {
    for (let j = -r; j <= r; j += 1) {
      for (const [v, s] of mapa.grilla.get(`${cx + i},${cy + j}`) || []) {
        const via = mapa.vias[v];
        const { t, d } = proyectar(p, via.xy[s], via.xy[s + 1]);
        if (d > radio) continue;
        const actual = mejor.get(v);
        if (!actual || d < actual.d) mejor.set(v, { via, seg: s, t, d });
      }
    }
  }
  return [...mejor.values()].sort((a, b) => a.d - b.d);
};

/**
 * Desde un punto de la vía, hacia un lado (+1 hacia el final, -1 hacia el
 * inicio), la primera calle con nombre distinto que la cruza o donde termina.
 */
const esquina = (mapa: Calles, inicio: Cercana, sentido: 1 | -1, preferidas: Set<string>): string | null => {
  const clave = inicio.via.clave;
  let via = inicio.via;
  let idx = sentido === 1 ? inicio.seg + 1 : inicio.seg;
  const a = via.xy[inicio.seg];
  const b = via.xy[inicio.seg + 1];
  const pi: [number, number] = [a[0] + inicio.t * (b[0] - a[0]), a[1] + inicio.t * (b[1] - a[1])];
  let recorrido = Math.hypot(via.xy[idx][0] - pi[0], via.xy[idx][1] - pi[1]);
  let dir: number = sentido;
  const vistos = new Set<number>();
  while (recorrido <= LIMITE_ESQUINA) {
    const nodo = via.nodos[idx];
    if (vistos.has(nodo)) return null;
    vistos.add(nodo);
    const otras = (mapa.porNodo.get(nodo) || []).map((v) => mapa.vias[v]).filter((v) => v.id !== via.id);
    const cruce = [...new Set(otras.filter((v) => v.nombre && v.clave !== clave).map((v) => v.clave))];
    if (cruce.length) {
      // Si la calle que cruza cambia de nombre en la esquina: la que nombra la dirección actual, o la más corta.
      cruce.sort((x, y) => Number(preferidas.has(y)) - Number(preferidas.has(x)) || x.length - y.length);
      return mapa.mostrar.get(cruce[0])!;
    }
    const fin = dir === 1 ? idx === via.nodos.length - 1 : idx === 0;
    if (fin) {
      // Sigue por otra vía con el mismo nombre (o por un tramo sin nombre, si es el único).
      const mismas = otras.filter((v) => v.clave === clave);
      const sigue = mismas[0] || (otras.length === 1 && !otras[0].nombre ? otras[0] : undefined);
      if (!sigue) return null;
      const pos = sigue.nodos.indexOf(nodo);
      dir = pos === sigue.nodos.length - 1 ? -1 : 1;
      via = sigue;
      idx = pos;
    }
    const sig = idx + dir;
    if (sig < 0 || sig >= via.nodos.length) return null;
    recorrido += Math.hypot(via.xy[sig][0] - via.xy[idx][0], via.xy[sig][1] - via.xy[idx][1]);
    idx = sig;
  }
  return null;
};

// ——— Dirección actual ———

// Km, manzana, solar y unidad: se copian tal cual, en este orden.
const NL = '(?![\\p{L}\\d])';
const PIEZAS: Array<{ re: RegExp; formato: (m: RegExpMatchArray) => string }> = [
  { re: new RegExp(`(?<![\\p{L}\\d])Km\\.\\s*(\\d+(?:[.,]\\d+)?)${NL}`, 'u'), formato: (m) => `Km. ${m[1]}` },
  { re: new RegExp(`(?<![\\p{L}\\d])(?:M|Mz|Manz)\\.\\s*(\\d+[A-Za-z]?|[A-Z]{1,2}(?:\\s?\\d+)?)${NL}`, 'u'), formato: (m) => `M. ${m[1]}` },
  { re: new RegExp(`(?<![\\p{L}\\d])Manzana\\s+(\\d+[A-Za-z]?|[A-Z]{1,2})${NL}`, 'u'), formato: (m) => `M. ${m[1]}` },
  { re: new RegExp(`(?<![\\p{L}\\d])(?:S|Sol)\\.\\s*(\\d+[A-Za-z]?|[A-Z]\\d*)${NL}`, 'u'), formato: (m) => `Sol. ${m[1]}` },
  { re: new RegExp(`(?<![\\p{L}\\d])Solar\\s+(\\d+[A-Za-z]?|[A-Z])${NL}`, 'u'), formato: (m) => `Sol. ${m[1]}` },
  {
    re: new RegExp(`(?<![\\p{L}\\d])(Unidad|Apto\\.?|Ap\\.|Apartamento|Block|Bloque|Torre|Lote|Padrón|Padron)\\s*(?:N[°º]\\.?\\s*)?(\\d+[A-Za-z]?|[A-Z])${NL}`, 'u'),
    formato: (m) => formatoTitulo(m[0].trim()),
  },
];

const CONTEXTO = new Set(['y', 'e', 'esq', 'esquina', 'entre', 'casi', 'ex', 'sobre']);
const CONECTORES = new Set(['y', 'e', 'esq', 'esquina', 'entre', 'casi', 'con', 'a', 'al', 'ex', 'n', 'sn', 'o']);
const PARECE_CALLE = /\b(calle|av|avda|avenida|ruta|rambla|camino|pasaje|esq|esquina|entre|casi|diagonal|bulevar)\b/;
const COMILLAS = /"[^"]*"|“[^”]*”|«[^»]*»/g;

export const proponerDireccion = (mapa: Calles, punto: Punto, actual: string): Propuesta => {
  const dudas: string[] = [];
  const p = xy(punto);
  const vias = cercanas(mapa, p, RADIO_MENCION);
  const conNombre = vias.filter((c) => c.via.nombre);
  if (!conNombre.length) {
    return { direccion: actual, dudas: ['sin calles: no hay calles con nombre a menos de 500 m'] };
  }
  const distancia = new Map<string, Cercana>();
  conNombre.forEach((c) => { if (!distancia.has(c.via.clave)) distancia.set(c.via.clave, c); });
  const cercanasClaves = [...distancia.keys()];

  // Lo que está entre comillas va tal cual a la descripción.
  const citas: string[] = [];
  let texto = ` ${actual} `.replace(COMILLAS, (cita) => { citas.push(cita); return ` ⟦${citas.length - 1}⟧ `; })
    .replace(/(\p{Ll})([ms])\.\s*(\d)/gu, (_, l, ms, d) => `${l} ${ms.toUpperCase()}. ${d}`) // «Picosm. 205»
    .replace(/(?<![\p{L}])S\/(N|Num|Nº|N°)\.?(?![\p{L}])/gu, ' '); // sin número
  const piezas: string[] = [];
  for (const { re, formato } of PIEZAS) {
    const m = texto.match(re);
    if (!m) continue;
    piezas.push(formato(m));
    texto = texto.replace(m[0], ' · ');
  }

  // Palabras del texto y sus tokens.
  const palabras = texto.split(/(\s+|[,;:()\-–/·]+)/).filter((s) => s);
  const toks: Array<{ t: string; i: number }> = [];
  palabras.forEach((s, i) => { if (!s.includes('⟦')) tokens(s).forEach((t) => toks.push({ t, i })); });
  const tt = toks.map((x) => x.t);
  // Un corte («,», «-», «(», «·») entre dos tokens: una mención no lo cruza.
  const corte = tt.map((_, k) => k > 0 && palabras.slice(toks[k - 1].i + 1, toks[k].i).some((s) => /[,;:()\-–/·⟦]/.test(s)));
  const hastaCorte = (k: number) => { let n = k + 1; while (n < tt.length && !corte[n]) n += 1; return tt.slice(0, n); };

  const cubierto = new Array(tt.length).fill(false);
  const menciones: Array<{ clave: string; desde: number; hasta: number }> = [];
  const lejanas: string[] = [];
  const marcar = (desde: number, n: number) => {
    let inicio = desde;
    // «Calle», «Av.», «esq.» sueltos antes del nombre también son parte de la mención.
    while (inicio > 0 && !cubierto[inicio - 1] && !corte[inicio] && TITULOS.has(tt[inicio - 1])) inicio -= 1;
    for (let k = inicio; k < desde + n; k += 1) cubierto[k] = true;
  };
  // Calles cercanas y después lejanas (nombre completo). Solo al empezar un
  // tramo o después de «y», «esq.», «entre»…: en medio de una frase
  // («Madre de Martina…», «Club Los Titanes») no es una calle.
  const conContexto = (i: number) => i === 0 || corte[i] || CONTEXTO.has(tt[i - 1]) || TITULOS.has(tt[i - 1]);
  for (let i = 0; i < tt.length; i += 1) {
    if (cubierto[i]) continue;
    const tramo = hastaCorte(i);
    if (!conContexto(i)) continue;
    let mejor = 0;
    let cual = '';
    for (const clave of cercanasClaves) {
      for (const forma of mapa.formas.get(clave) || []) {
        // Un número suelto es una calle solo después de «y», «esq.», «calle»… («Calle 64 y 72»).
        if (forma.tokens.every((t) => /^\d+$/.test(t)) && !(i > 0 && (CONTEXTO.has(tt[i - 1]) || TITULOS.has(tt[i - 1])))) continue;
        const n = coincide(tramo, i, forma.tokens, true);
        if (n > mejor || (n === mejor && n > 0 && distancia.get(clave)!.d < distancia.get(cual)!.d)) { mejor = n; cual = clave; }
      }
    }
    if (!mejor) continue;
    marcar(i, mejor);
    menciones.push({ clave: cual, desde: i, hasta: i + mejor });
    i += mejor - 1;
  }
  // Barrios (antes que las calles lejanas: «San José de Carrasco» no es la calle San José).
  for (let i = 0; i < tt.length; i += 1) {
    if (cubierto[i]) continue;
    const b = mapa.barrios.find((barrio) => barrio.length && barrio.every((t, k) => tt[i + k] === t && !cubierto[i + k]));
    // Al empezar un tramo, después de un conector o al final («Club Los Titanes» no es el barrio).
    if (!b || !(conContexto(i) || i + b.length === tt.length)) continue;
    for (let k = 0; k < b.length; k += 1) cubierto[i + k] = true;
    i += b.length - 1;
  }
  for (let i = 0; i < tt.length; i += 1) {
    if (cubierto[i]) continue;
    if (!conContexto(i)) continue;
    const tramo = hastaCorte(i);
    let mejor = 0;
    let cual = '';
    for (const forma of mapa.completas.get(tt[i]) || []) {
      const n = coincide(tramo, i, forma.tokens, false);
      if (n > mejor && tramo.slice(i, i + n).every((_, k) => !cubierto[i + k])) { mejor = n; cual = forma.clave; }
    }
    if (!mejor) continue;
    marcar(i, mejor);
    lejanas.push(mapa.mostrar.get(cual)!);
    i += mejor - 1;
  }
  menciones.sort((a, b) => a.desde - b.desde);

  // Calle principal: la primera que nombra la dirección actual, si pasa casi igual de cerca.
  const masCercana = conNombre[0];
  const tope = Math.max(masCercana.d + MARGEN_CALLE_ACTUAL, 40);
  const nombrada = menciones.map((m) => distancia.get(m.clave)!).find((c) => c.d <= tope);
  const principal = nombrada || masCercana;
  // Número de puerta pegado a la calle principal («Filadelfia 297»).
  const mencionPrincipal = menciones.find((m) => m.clave === principal.via.clave);
  let puerta = '';
  if (mencionPrincipal) {
    const k = mencionPrincipal.hasta;
    if (k < tt.length && !cubierto[k] && !corte[k] && /^\d{2,5}$/.test(tt[k])
      && !(k + 1 < tt.length && !corte[k + 1] && /^[a-z]$/.test(tt[k + 1]))) {
      puerta = tt[k];
      cubierto[k] = true;
    }
  }
  const calle = mapa.mostrar.get(principal.via.clave)!;
  if (principal.d > LIMITE_LEJOS) dudas.push(`lejos: el punto está a ${Math.round(principal.d)} m de ${calle}`);
  const sinNombre = vias.find((c) => !c.via.nombre);
  if (sinNombre && sinNombre.d + 10 < principal.d && sinNombre.d < 40) {
    dudas.push(`calle sin nombre: hay una calle sin nombre a ${Math.round(sinNombre.d)} m (${calle} a ${Math.round(principal.d)} m)`);
  }
  if (!menciones.length) {
    dudas.push(lejanas.length
      ? `calle distinta: la dirección actual nombra ${lejanas.join(', ')}, lejos del punto`
      : 'sin calle actual: la dirección actual no nombra ninguna calle cercana del mapa');
  } else if (menciones[0].clave !== principal.via.clave) {
    dudas.push(`calle distinta: la actual empieza por ${mapa.mostrar.get(menciones[0].clave)}`);
  }
  if (menciones.length && lejanas.length) {
    dudas.push(`calle lejana: la dirección actual también nombra ${lejanas.join(', ')}, lejos del punto`);
  }

  // Esquinas.
  const preferidas = new Set(menciones.map((m) => m.clave));
  const esquinas = [...new Set([esquina(mapa, principal, 1, preferidas), esquina(mapa, principal, -1, preferidas)]
    .filter((e): e is string => !!e && e !== calle))];
  // Las calles que la dirección actual da como esquinas: al menos una tiene que coincidir.
  const nombradas = [...new Set(menciones.map((m) => m.clave))].filter((c) => c !== principal.via.clave);
  if (esquinas.length && nombradas.length
    && !nombradas.some((c) => esquinas.includes(mapa.mostrar.get(c)!))) {
    dudas.push(`esquinas distintas: la actual nombra ${nombradas.map((c) => mapa.mostrar.get(c)).join(', ')}`);
  }
  if (!esquinas.length) dudas.push('esquinas: no se encontró ninguna esquina');
  else if (esquinas.length === 1) dudas.push(`esquinas: solo una esquina (${esquinas[0]})`);

  // Descripción: lo que no es calle, barrio, conector ni pieza.
  const restos: string[] = [];
  let tramo: string[] = [];
  const sospechosas: string[] = [];
  const cerrar = () => {
    let limpio = tramo.join('').replace(/\s+/g, ' ').trim();
    tramo = [];
    // Lo que viene después de «y», «esq.», «entre» suele ser una calle que el mapa no reconoció.
    const despuesDeConector = /^[\s(]*(y|e|esq\.?|esquina:?|entre|casi)\s+\S/i.test(limpio);
    // Conectores sueltos en las puntas («Esq.», «y», «Frente a» queda).
    for (let antes = ''; antes !== limpio;) {
      antes = limpio;
      limpio = limpio.replace(/^[\s,;:.\-–·/()*]+|[\s,;:\-–·/(*]+$/g, '')
        .replace(/^(y|e|o|esq\.?|esquina:?|entre|casi|con|al|detalle:?)(\s+|$)/i, '')
        .replace(/(^|\s+)(y|e|o|esq\.?|entre|casi|con|ex\.?|a|al|de|del|detalle:?)$/i, '')
        .replace(/(?<!\b(?:la|en|casa))\s+esquina:?$/i, '').trim();
    }
    if (/^\(.*\)$/.test(limpio) && !limpio.slice(1, -1).includes('(')) limpio = limpio.slice(1, -1).trim();
    if (!limpio.replace(/⟦\d+⟧/g, 'x').match(/[\p{L}\d]/u)) return;
    const ts = tokens(limpio.replace(/⟦\d+⟧/g, ' cita '));
    // «y Rambla», «esq. Ruta»: una calle que no se reconoció; queda y se marca.
    if (ts.some((t) => TITULOS.has(t) && t !== 'calle') && ts.every((t) => CONECTORES.has(t) || TITULOS.has(t))) {
      sospechosas.push(limpio);
      restos.push(limpio);
      return;
    }
    if (ts.every((t) => CONECTORES.has(t) || !significativo(t))) return;
    if (ts.every((t) => ['norte', 'sur', 'este', 'oeste'].includes(t))) return; // resto de un barrio
    if ((limpio.length <= 1 && !/\d/.test(limpio)) || /^(frente|lado|detalle|casi)$/i.test(limpio)) return;
    // Repite el nombre de la calle o de una esquina («Calle D (Ma. Tota Almeida Quinteros)»).
    const nombres = new Set([calle, ...esquinas].flatMap(tokens));
    const propios = ts.filter(significativo);
    if (propios.length && propios.filter((t) => nombres.has(t)).length / propios.length >= 0.6) return;
    if (despuesDeConector || ts.every((t) => /^\d+$/.test(t))) sospechosas.push(limpio);
    restos.push(limpio);
  };
  const tokPorPalabra = new Map<number, number[]>();
  toks.forEach((x, k) => tokPorPalabra.set(x.i, [...(tokPorPalabra.get(x.i) || []), k]));
  palabras.forEach((s, i) => {
    const ks = tokPorPalabra.get(i);
    if (s.includes('·') || (!ks && /[,;()\-–/]/.test(s))) { cerrar(); return; }
    if (ks && ks.some((k) => cubierto[k])) { cerrar(); return; }
    tramo.push(s);
  });
  cerrar();
  const descripcion = restos.map((r) => r.replace(/⟦(\d+)⟧/g, (_, n) => citas[Number(n)]))
    .map((r) => (/^\(/.test(r) && !/\)/.test(r) ? r.slice(1) : r).replace(/^([^(]*)\)$/, '$1').trim())
    .filter(Boolean).join(', ');
  const sinEsquinaDeCasa = normalizar(descripcion.replace(COMILLAS, '')).replace(/\b(la|en|de|casa|lado) esquina\b|\besquina\W*$/g, '');
  if (descripcion && (sospechosas.length || PARECE_CALLE.test(sinEsquinaDeCasa))) {
    dudas.push(`descripción: «${descripcion}» parece tener una calle`);
  }

  // «Venezuela y José Batlle y Ordóñez» se lee mejor que al revés.
  if (esquinas.length === 2 && / y /.test(esquinas[0]) && !/ y /.test(esquinas[1])) esquinas.reverse();
  const y = (a: string, b: string) => `${a} ${/^(i|hi)(?!e)/.test(normalizar(b)) ? 'e' : 'y'} ${b}`;
  const partes = [puerta ? `${calle} ${puerta}` : calle, ...piezas];
  if (esquinas.length) partes.push(`esq. ${esquinas.length === 2 ? y(esquinas[0], esquinas[1]) : esquinas[0]}`);
  if (descripcion) partes.push(`(${formatoTitulo(descripcion)})`);
  const direccion = partes.join(' ');
  // Control: ninguna palabra de la dirección actual se pierde sin explicación
  // (las calles reconocidas y los barrios sí se reemplazan).
  const quedan = new Set([...tokens(direccion), ...citas.flatMap(tokens), ...piezas.flatMap(tokens)]);
  const sinValor = new Set(['detalle', 'norte', 'sur', 'este', 'oeste', 'frente', 'sta', 'sto', 'gral', 'dr']);
  const perdidas = tt.filter((t, k) => !cubierto[k] && significativo(t) && !CONECTORES.has(t) && !quedan.has(t)
    && !sinValor.has(t) && t.length > 1);
  if (perdidas.length) dudas.push(`texto perdido: no quedó «${[...new Set(perdidas)].join(' ')}»`);
  return {
    direccion,
    dudas,
    calle,
    esquinas,
    distancia: Math.round(principal.d),
    descripcion,
  };
};
