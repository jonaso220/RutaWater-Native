import type { Client } from '../../src/types';
import { isClientStarredOnDay } from '../../src/utils/clientDays';
import { agendaFor, weekdayOf, whatsappOf } from './views';

// A quién se le manda el aviso de las 9 y el recordatorio de las 18, con qué
// texto y a qué número (Jonathan, 27/11/2026). Hasta ahora lo decidía cada
// pasada leyendo las reglas en texto; acá son datos: las excepciones viven en
// un archivo de la skill de avisos y todo lo demás sigue el criterio común
// (estrella, pedido de una vez, registro de lo ya enviado).

export interface NoticeException {
  clave: string;
  nombre: string;
  direccion?: string;
  /** Todas las fichas de la persona: agenda, directorio y pedidos de una vez. */
  fichas: string[];
  aviso: boolean;
  recordatorio: boolean;
  /** Reemplaza «por tu casa» en el aviso de la mañana. */
  reemplazo_por_tu_casa?: string;
  /** en_lugar: el mensaje va a esas fichas y no al cliente; ademas: a los dos. */
  destinatarios?: { modo: 'en_lugar' | 'ademas'; a: Array<{ ficha: string; nombre: string }>; independientes?: boolean };
  /** Texto propio en vez de la plantilla: nombre de una lista de variantes de `textos.propios`. */
  texto_propio?: string;
  /** Si está, el texto propio vale solo para repartos de ese día de semana. */
  texto_propio_dia?: string;
  /** El aviso se manda aunque su chat esté excluido de la API (no se le contesta, pero recibe el aviso). */
  aviso_aunque_excluido?: boolean;
  /** listo: si no contestó el aviso no se le recuerda y se marca Listo. */
  si_no_contesta?: 'listo';
  motivo?: string;
}

export interface NoticeRules {
  excepciones: NoticeException[];
  textos?: { recordatorio?: string; propios?: Record<string, string[]> };
}

export type NoticeKind = 'aviso' | 'recordatorio';

export interface ProgressEntry { status?: string; confirmed_at?: string; updated_at?: string; note?: string; client?: string }
/** Registro de una fecha de reparto (state/AAAA-MM-DD.json → clients). */
export type Progress = Record<string, ProgressEntry>;

export interface NoticeItem {
  posicion: number;
  cliente_id: string;
  cliente: string;
  /** A quién le llega (el cliente o su familiar). */
  destinatario: string;
  destinatario_id: string;
  telefono: string;
  texto: string;
  /** Cómo pedírselo a mandar_avisos sin escribir el texto: la plantilla y, si hace falta, el cambio. Sin plantilla, va `texto`. */
  plantilla?: 'aviso_manana' | 'recordatorio';
  reemplazar?: string[];
  /** Cómo se identifica en el registro: la ficha o «ficha::dest:nombre» con dos destinatarios. */
  clave: string;
  excepcion?: string;
  /** Solo recordatorio: si escribió desde esa hora, ya respondió. */
  frenar_si_escribio_desde?: string;
  /** Dos destinatarios de una misma visita: si uno contestó, no se le recuerda al otro. */
  grupo?: string;
  aunque_excluido?: boolean;
}

export interface NoticeSkip {
  posicion: number;
  cliente_id: string;
  cliente: string;
  motivo: string;
  /** Lo que hay que hacer en lugar de mandar (Listo si no contestó). */
  accion?: 'listo_si_no_contesto';
  desde?: string;
}

export interface NoticeList {
  fecha: string;
  tipo: NoticeKind;
  mandar: NoticeItem[];
  omitidos: NoticeSkip[];
  /** Casos que el programa no resuelve solo: van a Jonathan. */
  revisar: NoticeSkip[];
}

const normalize = (value: unknown): string => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (value: string): string => normalize(value).replace(/ /g, '-');

/** La excepción de una ficha: por id, por la misma persona (customerId) o por nombre y dirección iguales. */
export const exceptionFor = (client: Client, clients: Client[], rules: NoticeRules): NoticeException | null => {
  const byId = rules.excepciones.find((exception) => exception.fichas.includes(client.id));
  if (byId) return byId;
  const person = client.customerId || '';
  if (person) {
    const same = rules.excepciones.find((exception) => exception.fichas.some((id) => {
      const listed = clients.find((candidate) => candidate.id === id);
      return id === person || (listed?.customerId || listed?.id) === person;
    }));
    if (same) return same;
  }
  const name = normalize(client.name);
  const address = normalize(client.address);
  if (!name || !address) return null;
  return rules.excepciones.find((exception) => normalize(exception.nombre) === name && normalize(exception.direccion) === address) || null;
};

const uyStamp = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(date.getTime() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
};

/** Entradas del registro de esa ficha (la clave termina en su id, con o sin «::dest:…»). */
const entriesOf = (progress: Progress, id: string): Array<[string, ProgressEntry]> =>
  Object.entries(progress).filter(([key]) => (key.split('|').pop() || '').split('::')[0] === id);

const entryFor = (progress: Progress, id: string, recipient: string, shared: boolean): ProgressEntry | undefined => {
  const entries = entriesOf(progress, id);
  if (!shared) return entries.find(([, entry]) => entry.status === 'sent')?.[1] || entries[0]?.[1];
  const tag = slug(recipient);
  const first = normalize(recipient).split(' ')[0];
  const own = entries.filter(([key, entry]) => key.includes(`::dest:${tag}`) || key.includes(`::dest:${first}`)
    || normalize(entry.note).includes(first));
  return own.find(([, entry]) => entry.status === 'sent')?.[1] || own[0]?.[1];
};

/** Número de semana (lunes a domingo) para rotar el texto propio sin repetir el de la semana anterior. */
const weekIndex = (isoDate: string): number => Math.floor((new Date(`${isoDate}T12:00:00Z`).getTime() / 86400e3 + 3) / 7);

/** La variante que toca esa semana: rota en orden, así nunca repite la de la semana anterior. */
export const variantFor = (isoDate: string, variants: string[]): string => variants[weekIndex(isoDate) % variants.length];

export interface NoticeListOptions {
  clients: Client[];
  date: string;
  kind: NoticeKind;
  rules: NoticeRules;
  /** Plantilla del aviso de mañana (Ajustes de la app). */
  template: string;
  /** Registro de avisos de esa fecha. */
  firstPass?: Progress;
  /** Registro de recordatorios de esa fecha. */
  secondPass?: Progress;
}

export const buildNoticeList = (options: NoticeListOptions): NoticeList => {
  const { clients, date, kind, rules, template, firstPass = {}, secondPass = {} } = options;
  const result: NoticeList = { fecha: date, tipo: kind, mandar: [], omitidos: [], revisar: [] };
  const day = weekdayOf(date);
  const reminder = rules.textos?.recordatorio || '';
  const done = kind === 'aviso' ? firstPass : secondPass;

  agendaFor(clients, date).filter((entry) => entry.occurrence === date && !entry.client.isNote).forEach(({ client, position }) => {
    const base = { posicion: position, cliente_id: client.id, cliente: client.name };
    const skip = (motivo: string, extra: Partial<NoticeSkip> = {}) => { result.omitidos.push({ ...base, motivo, ...extra }); };
    const review = (motivo: string) => { result.revisar.push({ ...base, motivo }); };
    if (client.freq === 'once') return skip('pedido de una vez');
    if (isClientStarredOnDay(client, day)) return skip('favorito (estrella)');
    const exception = exceptionFor(client, clients, rules);
    if (exception && kind === 'aviso' && !exception.aviso) return skip(`excluido: ${exception.motivo || exception.clave}`);
    if (exception && kind === 'recordatorio' && !exception.recordatorio) {
      if (exception.si_no_contesta !== 'listo') return skip(`sin recordatorio: ${exception.motivo || exception.clave}`);
      const first = entryFor(firstPass, client.id, client.name, false);
      if (first?.status !== 'sent') return skip('sin aviso inicial verificado');
      return skip(exception.motivo || 'Listo si no contestó', { accion: 'listo_si_no_contesto', desde: uyStamp(first.confirmed_at || first.updated_at) });
    }

    const relatives = (exception?.destinatarios?.a || []).map((relative) => ({
      ficha: clients.find((candidate) => candidate.id === relative.ficha), nombre: relative.nombre, id: relative.ficha,
    }));
    const mode = exception?.destinatarios?.modo;
    const recipients = [
      ...(mode === 'en_lugar' ? [] : [{ ficha: client as Client | undefined, nombre: client.name, id: client.id }]),
      ...relatives,
    ];
    const shared = recipients.length > 1;

    let text = reminder;
    let via: Pick<NoticeItem, 'plantilla' | 'reemplazar'> = { plantilla: 'recordatorio' };
    if (kind === 'aviso') {
      via = { plantilla: 'aviso_manana' };
      const ownName = exception?.texto_propio && (!exception.texto_propio_dia || exception.texto_propio_dia === day) ? exception.texto_propio : '';
      const own = ownName ? rules.textos?.propios?.[ownName] || [] : [];
      if (ownName && !own.length) return review(`faltan las variantes del texto propio «${ownName}»`);
      if (own.length) { text = variantFor(date, own); via = {}; }
      else if (exception?.reemplazo_por_tu_casa) {
        if (template.split('por tu casa').length !== 2) return review('la plantilla del aviso no dice «por tu casa» una sola vez: no se pudo cambiar el texto');
        text = template.replace('por tu casa', exception.reemplazo_por_tu_casa);
        via = { plantilla: 'aviso_manana', reemplazar: [`por tu casa=>${exception.reemplazo_por_tu_casa}`] };
      } else text = template;
    }
    if (!text) return review(kind === 'aviso' ? 'falta la plantilla del aviso' : 'falta el texto del recordatorio');

    recipients.forEach((recipient) => {
      const who = { ...base, destinatario: recipient.nombre, destinatario_id: recipient.id };
      const key = shared ? `${client.id}::dest:${slug(recipient.nombre)}` : client.id;
      const already = entryFor(done, client.id, recipient.nombre, shared);
      if (already?.status === 'sent') {
        return result.omitidos.push({ ...base, motivo: `${kind === 'aviso' ? 'aviso' : 'recordatorio'} ya enviado${shared ? ` a ${recipient.nombre}` : ''}` });
      }
      let since: string | undefined;
      if (kind === 'recordatorio') {
        const first = entryFor(firstPass, client.id, recipient.nombre, shared);
        if (first?.status !== 'sent') {
          // Sin aviso de la mañana no se manda el recordatorio: lo decide Jonathan.
          return result.revisar.push({ ...base, motivo: `sin aviso inicial verificado${shared ? ` a ${recipient.nombre}` : ''}: no se le manda el recordatorio` });
        }
        since = uyStamp(first.confirmed_at || first.updated_at);
      }
      const phone = recipient.ficha ? whatsappOf(recipient.ficha) : '';
      if (!phone) return result.revisar.push({ ...base, motivo: `${recipient.nombre} no tiene WhatsApp en la ficha` });
      return result.mandar.push({
        ...who, telefono: phone, texto: text, ...via, clave: key,
        ...(exception ? { excepcion: exception.clave } : {}),
        ...(since ? { frenar_si_escribio_desde: since } : {}),
        ...(shared && !exception?.destinatarios?.independientes ? { grupo: client.id } : {}),
        ...(exception?.aviso_aunque_excluido ? { aunque_excluido: true } : {}),
      });
    });
    return undefined;
  });
  return result;
};
