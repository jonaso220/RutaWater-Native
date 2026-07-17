const MAPS_URL_RE = /(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|share\.google|maps\.google\.[a-z.]+|(?:www\.)?google\.[a-z.]+\/maps)[^\s<>"']*/i;

const isGoogleMapsHost = (hostname: string, pathname: string): boolean => {
  const host = hostname.toLowerCase();
  return host === 'maps.app.goo.gl'
    || (host === 'goo.gl' && pathname.toLowerCase().startsWith('/maps'))
    || (host === 'g.co' && pathname.toLowerCase().startsWith('/kgs'))
    || host === 'share.google'
    || /^maps\.google\.[a-z.]+$/.test(host)
    || (/^(?:www\.)?google\.[a-z.]+$/.test(host) && pathname.toLowerCase().startsWith('/maps'));
};

// React Native 0.76 reemplaza URL por un polyfill cuyas propiedades protocol,
// hostname y pathname lanzan "not implemented". Por eso parseamos solamente
// las partes que necesitamos, sin depender del constructor global de URL.
const parseHttpUrl = (value: string): { protocol: string; hostname: string; pathname: string } | null => {
  const match = value.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i);
  if (!match) return null;
  const hostname = match[2].toLowerCase();
  // No aceptamos credenciales ni puertos: ninguno forma parte de un enlace
  // compartido legítimo de Google Maps y complicarían la validación del host.
  if (hostname.includes('@') || hostname.includes(':')) return null;
  return {
    protocol: `${match[1].toLowerCase()}:`,
    hostname,
    pathname: match[3] || '/',
  };
};

export const hasGoogleLocationLinkText = (text: string): boolean => MAPS_URL_RE.test(text || '');

// Normaliza links copiados desde WhatsApp/IA. Acepta links sin protocolo,
// Markdown o con puntuación final, y devuelve '' si no es realmente Maps.
export const normalizeGoogleMapsLink = (candidate?: string, sourceText?: string): string => {
  const sources = [candidate || '', sourceText || ''];
  for (const source of sources) {
    // WhatsApp/iOS can insert directional and zero-width marks inside copied
    // links. They are invisible in the TextInput but break URL matching.
    const cleanSource = source.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
    const match = cleanSource.match(MAPS_URL_RE)?.[0];
    if (!match) continue;
    let value = match.replace(/[\])}>.;]+$/g, '');
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    const parsed = parseHttpUrl(value);
    if (parsed
      && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && isGoogleMapsHost(parsed.hostname, parsed.pathname)) {
      return value;
    }
  }
  return '';
};

export const looksLikeCompleteClientCardText = (text: string): boolean => {
  const raw = text || '';
  const withoutUrl = raw.replace(MAPS_URL_RE, ' ');
  const hasPhone = /(?:^|\D)(?:\+?\d[\d\s().-]{6,}\d)(?:\D|$)/m.test(withoutUrl);
  const hasAddress = /\b(?:direcci[oó]n|domicilio|calle|avenida|av\.?|ruta|esq\.?|esquina|manzana|solar)\b/i.test(raw)
    || raw.split(/\r?\n/).filter((line) => line.trim()).length >= 3;
  return !!normalizeGoogleMapsLink('', raw) && hasPhone && hasAddress;
};

export interface DirectoryContactCard {
  name: string;
  address: string;
  phone: string;
  mapsLink: string;
  usedAddressAsName: boolean;
}

const ADDRESS_CUE_RE = /\b(?:direcci[oó]n|domicilio|calle|avenida|av\.?|ruta|esq\.?|esquina|manzana|solar)\b/i;
const CARD_FIELD_RE = '(?:nombre|direcci[oó]n|domicilio|esquina|detalle|tel[eé]fono|tel|producto|bid[oó]n|dispensador|soda)';

const extractCardField = (text: string, field: string): string => {
  const match = text.match(new RegExp(
    `\\b(?:${field})\\s*:\\s*(.+?)(?=\\s+\\b${CARD_FIELD_RE}\\s*:|$)`,
    'i',
  ));
  return (match?.[1] || '').trim().replace(/^[\s,;-]+|[\s,;-]+$/g, '');
};

// Fallback determinístico para fichas de directorio sin pedido. Si el primer
// tramo ya parece una dirección, no inventa un nombre: reutiliza la dirección
// como nombre, tal como espera el flujo manual de la app.
export const parseDirectoryContactCard = (text: string): DirectoryContactCard | null => {
  if (!looksLikeCompleteClientCardText(text)) return null;
  const clean = (text || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
  const mapsLink = normalizeGoogleMapsLink('', clean);
  const withoutUrl = clean.replace(MAPS_URL_RE, ' ');
  const phoneMatch = withoutUrl.match(/(?:^|\D)(\+?\d[\d\s().-]{6,}\d)(?:\D|$)/m);
  const phone = (phoneMatch?.[1] || '').trim();
  if (!mapsLink || !phone) return null;

  // Las fichas copiadas del sistema suelen venir con campos explícitos. Se
  // deben resolver antes del fallback por guiones: de lo contrario todo el
  // pedido (incluidos productos y notas) termina usado como nombre/dirección.
  // WhatsApp conserva a veces el Markdown de una ficha copiada
  // (`*Nombre:*`, `**Dirección:**`). Quitamos solo esos marcadores para que
  // no oculten los límites entre campos etiquetados.
  const compact = withoutUrl.replace(/[*_`~]+/g, ' ').replace(/\s+/g, ' ').trim();
  const labeledName = extractCardField(compact, 'nombre');
  const labeledAddress = extractCardField(compact, 'direcci[oó]n|domicilio');
  if (labeledName && labeledAddress) {
    const corner = extractCardField(compact, 'esquina');
    const detail = extractCardField(compact, 'detalle');
    const address = [
      labeledAddress,
      corner ? `Esquina ${corner}` : '',
      detail,
    ].filter(Boolean).join(', ');
    return {
      name: labeledName,
      address,
      phone,
      mapsLink,
      usedAddressAsName: false,
    };
  }

  let identity = withoutUrl.replace(phoneMatch?.[0] || '', ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .trim();
  identity = identity.replace(/^(?:nombre|cliente)\s*:\s*/i, '');
  const parts = identity.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);

  let name = '';
  let address = '';
  let usedAddressAsName = false;
  if (parts.length >= 2 && !ADDRESS_CUE_RE.test(parts[0])) {
    name = parts[0];
    address = parts.slice(1).join(', ');
  } else {
    address = parts.join(', ') || identity;
    name = address;
    usedAddressAsName = true;
  }

  return name && address ? { name, address, phone, mapsLink, usedAddressAsName } : null;
};
