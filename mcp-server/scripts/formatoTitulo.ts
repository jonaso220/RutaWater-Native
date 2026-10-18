// Formato único para nombres y direcciones: cada palabra con mayúscula inicial
// y el resto en minúscula. Solo cambia mayúsculas/minúsculas, los espacios
// repetidos y la forma de las abreviaturas de manzana, solar, calle y km
// («M.18», «MANZ 4», «S22» → «M. 18», «Manz. 4», «S. 22»). No toca textos
// entre comillas, links, números ni palabras con mayúsculas intercaladas
// («PetStore»).

// En minúscula salvo al inicio del texto o de un tramo («- », «(», «:»).
const CONECTORES = new Set(['de', 'del', 'y', 'e', 'o', 'u', 'a', 'al', 'entre', 'con', 'en', 'por']);
// En minúscula solo después de «de», «entre», «a»… («Parque de la Costa»);
// al empezar un nombre propio siguen en mayúscula («Av. Los Pinos»).
const ARTICULOS = new Set(['la', 'las', 'los']);
const ANTES_DE_ARTICULO = new Set(['de', 'entre', 'a', 'con', 'en', 'por']);
export const SIGLAS = new Set([
  'OSE', 'BPS', 'UP', 'HD', 'SAPP', 'UTE', 'ANTEL', 'ANCAP', 'BROU', 'BHU', 'CASMU', 'MSP', 'ASSE', 'UTU',
  'CAIF', 'MEVIR', 'IMC', 'IMM', 'AJUPEN', 'IB', 'MH', 'DK', 'JC', 'SRL', 'SA', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI',
]);
const ABREVIATURAS: Record<string, string> = {
  m: 'M.', mz: 'Mz.', manz: 'Manz.', s: 'S.', sol: 'Sol.', c: 'C.', km: 'Km.',
};
// Después de estas, una letra suelta es un nombre de calle o manzana («C. B», «Calle A»).
const ANTES_DE_LETRA = new Set(['m', 'mz', 'manz', 's', 'sol', 'c', 'calle', 'km']);

const PROTEGIDO = /(https?:\/\/\S+|"[^"]*"|“[^”]*”|«[^»]*»)/u;
const INICIO_DE_TRAMO = new Set(['(', ':', '-', '*', '[']);

const capitalizar = (palabra: string) => palabra.charAt(0).toLocaleUpperCase('es')
  + palabra.slice(1).toLocaleLowerCase('es');

/** «M.18» → «M. 18», «S22» → «S. 22», «MANZ 4» → «Manz. 4». */
const abreviaturas = (texto: string): string => {
  const tokens = texto.split(' ');
  return tokens.map((token, index) => {
    // Pegada al número o letra: M.18 · S.5B · M.F2 · SOL.9 · KM.79 · M160 · S22
    let match = token.match(/^(m|mz|manz|s|sol|c|km)\.(\d+[a-z]?|[a-z]\d*)([,.;)]*)$/i)
      || token.match(/^(m|mz|manz|s|sol|c|km)(\d+[a-z]?)([,.;)]*)$/i);
    if (match) {
      const resto = /^\d/.test(match[2]) ? match[2] : match[2].toLocaleUpperCase('es');
      return `${ABREVIATURAS[match[1].toLowerCase()]} ${resto}${match[3]}`;
    }
    // Suelta y seguida de un número o una letra: M 158 · SOL 12 · MANZ. 4 · M. C
    match = token.match(/^(m|mz|manz|s|sol|c|km)\.?$/i);
    const siguiente = tokens[index + 1] || '';
    if (match && /^(\d|[a-z](\d|[,.;)]*$))/i.test(siguiente)) return ABREVIATURAS[match[1].toLowerCase()];
    return token;
  }).join(' ');
};

const formatearTramo = (texto: string, anterior: { palabra: string; inicio: boolean }): string => {
  let salida = '';
  let ultimo = 0;
  for (const match of texto.matchAll(/\p{L}+/gu)) {
    const palabra = match[0];
    const desde = match.index!;
    const hasta = desde + palabra.length;
    const previo = texto.slice(0, desde).trimEnd();
    const charPrevio = texto[desde - 1];
    const charSiguiente = texto[hasta];
    const previoNoBlanco = previo ? previo[previo.length - 1] : '';
    const inicio = previo ? INICIO_DE_TRAMO.has(previoNoBlanco) : anterior.inicio;
    const minuscula = palabra.toLocaleLowerCase('es');
    // Un número en el medio corta el contexto: «Calle 10 y …» no es «Calle Y».
    if (/\d/.test(texto.slice(ultimo, desde))) anterior.palabra = '';
    const suelta = (charPrevio === undefined || /[\s(]/.test(charPrevio))
      && (charSiguiente === undefined || /[\s,;)]/.test(charSiguiente));
    let nueva: string;
    if (charPrevio && /\d/.test(charPrevio)) {
      nueva = palabra; // 8am, 13hs, 15A, 4to: con el número, sin tocar
    } else if (/\p{Lu}/u.test(palabra.slice(1)) && /\p{Ll}/u.test(palabra)) {
      nueva = palabra; // mayúsculas intercaladas a propósito: PetStore
    } else if (SIGLAS.has(palabra.toLocaleUpperCase('es'))) {
      nueva = palabra.toLocaleUpperCase('es');
    } else if (palabra.length === 1 && charSiguiente === '.') {
      nueva = palabra.toLocaleUpperCase('es'); // inicial: «José E. Rodó»
    } else if (!inicio && suelta && CONECTORES.has(minuscula)
      && !(palabra.length === 1 && ANTES_DE_LETRA.has(anterior.palabra))) {
      nueva = minuscula;
    } else if (!inicio && suelta && ARTICULOS.has(minuscula) && ANTES_DE_ARTICULO.has(anterior.palabra)) {
      nueva = minuscula;
    } else if (palabra.length === 1) {
      nueva = palabra.toLocaleUpperCase('es'); // letra suelta: «C. B», «S/N»
    } else {
      nueva = capitalizar(palabra);
    }
    salida += texto.slice(ultimo, desde) + nueva;
    ultimo = hasta;
    anterior.palabra = minuscula;
    anterior.inicio = false;
  }
  salida += texto.slice(ultimo);
  if (/\p{L}/u.test(texto)) return salida;
  // Un tramo sin letras que termina en «(» o «:» abre uno nuevo.
  const fin = texto.trimEnd();
  if (fin && INICIO_DE_TRAMO.has(fin[fin.length - 1])) anterior.inicio = true;
  return salida;
};

export const formatoTitulo = (original: string): string => {
  if (!original) return original;
  const texto = original.replace(/[ \t ]+/g, ' ').trim();
  const partes = texto.split(PROTEGIDO);
  const anterior = { palabra: '', inicio: true };
  return partes.map((parte, index) => {
    if (index % 2 === 1) {
      anterior.palabra = '';
      anterior.inicio = false;
      return parte; // entre comillas o link: tal cual
    }
    return formatearTramo(abreviaturas(parte), anterior);
  }).join('');
};
