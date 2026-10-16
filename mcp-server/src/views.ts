import type { Client, Debt, Transfer } from '../../src/types';
import es from '../../src/i18n/locales/es';
import {
  fuzzyMatch, getDayIndex, getNextVisitDate, matchScore, normalizePhone, parseDate, toLocalDateString,
} from '../../src/utils/helpers';
import { getClientAddressSearchText, getClientAddresses } from '../../src/utils/clientAddresses';
import { getClientPhoneSearchText, getClientPhones, getPrimaryClientPhone } from '../../src/utils/clientPhones';
import {
  buildClientIdentityIndex, getRelatedRecordStableClientId, getStableClientId, resolveClientForStableId,
} from '../../src/utils/clientIdentity';
import { DEFAULT_EN_CAMINO, DEFAULT_TOMORROW_VISIT } from '../../src/utils/whatsAppTemplates';
import { cheapestInsertion, clientCoordinates, Coordinates } from '../../src/utils/geo';
import type { Route } from './routes';
import type { Settings } from './store';

// Valores canónicos guardados en Firestore (src/constants/products.ts).
export const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_BY_INDEX = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const FREQ_LABELS: Record<string, string> = {
  weekly: 'semanal', biweekly: 'quincenal', triweekly: 'cada 3 semanas',
  monthly: 'mensual', once: 'una vez', on_demand: 'sin agenda (directorio)',
};

export interface CatalogProduct { id: string; nombre: string; personalizado: boolean }

/** Catálogo con los nombres que ve el usuario (renombres y productos propios incluidos). */
export const productCatalog = (settings: Settings): CatalogProduct[] => [
  ...Object.entries(es.products as Record<string, string>).map(([id, label]) => ({
    id, nombre: settings.productNames[id] ?? label, personalizado: false,
  })),
  ...settings.customProducts
    .filter((product) => product && typeof product.id === 'string')
    .map((product) => ({ id: product.id, nombre: settings.productNames[product.id] ?? product.label, personalizado: true })),
];

export const quantity = (value: unknown): number => {
  const parsed = parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const describeProducts = (client: Client, catalog: CatalogProduct[]) =>
  Object.entries(client.products || {})
    .map(([id, value]) => ({ id, nombre: catalog.find((product) => product.id === id)?.nombre ?? id, cantidad: quantity(value) }))
    .filter((product) => product.cantidad > 0);

export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !isNaN(date.getTime()) && toLocalDateString(date) === value;
};

export const weekdayOf = (isoDate: string): string => DAY_BY_INDEX[new Date(`${isoDate}T12:00:00`).getDay()];

export const todayKey = (): string => toLocalDateString(new Date());

export const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
};

export const clientDays = (client: Client): string[] => {
  const days = new Set<string>();
  (Array.isArray(client.visitDays) ? client.visitDays : []).forEach((day) => days.add(day));
  if (client.visitDay) days.add(client.visitDay);
  return ALL_DAYS.filter((day) => days.has(day));
};

/** Próxima visita pendiente como la muestra Inicio (atrasadas → hoy). */
export const nextVisit = (client: Client): string | null => {
  if (client.freq === 'on_demand' || client.isCompleted) return null;
  const today = todayKey();
  const dates = (client.freq === 'once' ? [undefined] : clientDays(client))
    .map((day) => getNextVisitDate(client, day))
    .filter((date): date is Date => !!date)
    .map((date) => {
      const key = toLocalDateString(date);
      return key < today ? today : key;
    })
    .sort();
  return dates[0] ?? null;
};

export const debtIndex = (clients: Client[], debts: Debt[]) => {
  const identity = buildClientIdentityIndex(clients);
  const byStableId = new Map<string, Debt[]>();
  debts.forEach((debt) => {
    const stableId = getRelatedRecordStableClientId(debt, identity);
    byStableId.set(stableId, [...(byStableId.get(stableId) || []), debt]);
  });
  return { identity, byStableId };
};

const debtTotal = (debts: Debt[] | undefined): number =>
  (debts || []).reduce((sum, debt) => sum + (Number(debt.amount) || 0), 0);

export interface ClientContext {
  route: Route;
  catalog: CatalogProduct[];
  debts?: Debt[];
  // Fichas del mismo reparto, para resolver Parentesco.
  clients?: Client[];
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  conyuge: 'cónyuge', padre_madre: 'padre/madre', hijo_a: 'hijo/a', hermano_a: 'hermano/a',
  suegro_a: 'suegro/a', yerno_nuera: 'yerno/nuera', abuelo_a: 'abuelo/a', nieto_a: 'nieto/a',
  tio_a: 'tío/a', sobrino_a: 'sobrino/a', primo_a: 'primo/a', cunado_a: 'cuñado/a', otro: 'otro',
};

const whatsappOf = (client: Client): string => {
  const primary = getPrimaryClientPhone(getClientPhones(client));
  return primary ? normalizePhone(primary.number) : '';
};

/** Familiares vinculados (pantalla Parentesco), con el número que abre su ícono de WhatsApp. */
export const relatedClients = (client: Client, clients: Client[]) =>
  Object.entries(client.relationships || {}).map(([id, type]) => {
    const related = clients.find((candidate) => candidate.id === id);
    return {
      cliente_id: id,
      nombre: related?.name ?? '(ficha no encontrada)',
      tipo: RELATIONSHIP_LABELS[type] || type,
      mismo_domicilio: client.sameHousehold?.[id] !== false,
      direccion: related ? getClientAddressSearchText(related) || related.address : '',
      whatsapp: related ? whatsappOf(related) : '',
    };
  });

/** Resumen corto para listas (búsqueda y agenda). */
export const clientSummary = (client: Client, context: ClientContext) => {
  return {
    id: client.id,
    nombre: client.name,
    reparto: context.route.name,
    direccion: getClientAddressSearchText(client) || client.address,
    // Mismo número que usan Avisar y el ícono de WhatsApp de la tarjeta.
    whatsapp: whatsappOf(client),
    frecuencia: FREQ_LABELS[client.freq] || client.freq,
    dias: client.freq === 'once' ? [] : clientDays(client),
    proxima_visita: nextVisit(client),
    una_vez: client.freq === 'once',
    favorito: !!client.isStarred,
    completado: !!client.isCompleted,
    inactivo: !!client.isInactive,
    es_nota: !!client.isNote,
    productos: describeProducts(client, context.catalog),
    notas: client.notes || '',
    ...(context.debts ? { deuda_total: debtTotal(context.debts) } : {}),
  };
};

/** Ficha completa: resumen + teléfonos, direcciones y datos de agenda. */
export const clientDetail = (client: Client, context: ClientContext) => ({
  ...clientSummary(client, context),
  customer_id: getStableClientId(client),
  telefonos: getClientPhones(client).map((phone) => ({ numero: phone.number, principal: phone.isPrimary })),
  direcciones: getClientAddresses(client).map((location) => ({
    tipo: location.type, direccion: location.address, mapa: location.mapsLink || '',
  })),
  fecha_especifica: client.specificDate || '',
  ultima_entrega: parseDate(client.lastDeliveredAt)?.toISOString() ?? null,
  parentesco: relatedClients(client, context.clients || []),
  deudas: (context.debts || []).map((debt) => ({
    monto: Number(debt.amount) || 0,
    fecha: parseDate(debt.createdAt)?.toISOString() ?? null,
  })),
});

export const searchClients = (clients: Client[], term: string, includeInactive: boolean): Client[] => {
  const matcher = fuzzyMatch(term);
  return clients
    .filter((client) => !client.isNote && (includeInactive || !client.isInactive))
    .filter((client) => matcher(client.name || '', getClientAddressSearchText(client), getClientPhoneSearchText(client)))
    .map((client) => ({
      client,
      score: matchScore(term, client.name || '', getClientAddressSearchText(client), getClientPhoneSearchText(client)),
    }))
    .sort((a, b) => b.score - a.score || (a.client.name || '').localeCompare(b.client.name || ''))
    .map((entry) => entry.client);
};

// Orden de la lista del día (compareDayOrder en useClients).
const dayOrder = (client: Client, day: string): number => {
  if (client.listOrders && typeof client.listOrders[day] === 'number') return client.listOrders[day];
  const legacy = client.listOrder ?? 0;
  return legacy > 1000000 ? 999999 + legacy / 1e15 : (legacy || 999999);
};

/**
 * Lista completa de un día de semana como la muestra Inicio (getAllDayClients):
 * fichas activas de ese día, en su orden, aunque esa fecha no les toque. El
 * número de la tarjeta y «Cambiar posición» se refieren a esta lista.
 */
export const dayList = (clients: Client[], day: string): Client[] => clients
  .filter((client) => client.freq !== 'on_demand' && !client.isCompleted && clientDays(client).includes(day))
  .sort((a, b) => dayOrder(a, day) - dayOrder(b, day));

export interface AgendaEntry {
  client: Client;
  // Fecha real de la visita; en una atrasada es anterior a la fecha pedida.
  occurrence: string;
  overdue: boolean;
  // Número que muestra la tarjeta: lugar en la lista completa de ese día de
  // semana (globalPositionMap en HomeScreen), contando los que no tocan ese día.
  position: number;
}

/**
 * Clientes que Inicio muestra bajo la fecha pedida (sin directorio ni
 * completados), en el orden del reparto. Como en la app, una visita atrasada
 * figura en «Hoy» hasta que pasan los días de gracia; acá se juntan las de
 * todos los días de semana, primero las del día y después las atrasadas.
 */
export const agendaFor = (clients: Client[], isoDate: string): AgendaEntry[] => {
  const day = weekdayOf(isoDate);
  const today = todayKey();
  if (getDayIndex(day) === -1) return [];
  const active = clients.filter((client) => client.freq !== 'on_demand' && !client.isCompleted);
  const weekdayLists = new Map<string, string[]>();
  const positionIn = (weekday: string, id: string): number => {
    if (!weekdayLists.has(weekday)) {
      weekdayLists.set(weekday, active
        .filter((client) => clientDays(client).includes(weekday))
        .sort((a, b) => dayOrder(a, weekday) - dayOrder(b, weekday))
        .map((client) => client.id));
    }
    return weekdayLists.get(weekday)!.indexOf(id) + 1;
  };
  const entries: AgendaEntry[] = [];
  clients
    .filter((client) => client.freq !== 'on_demand' && !client.isCompleted)
    .forEach((client) => {
      const days = clientDays(client);
      const tried = client.freq === 'once' ? [days[0] ?? client.visitDay] : [day, ...days.filter((d) => d !== day)];
      for (const candidate of tried) {
        if (client.freq !== 'once' && !days.includes(candidate)) continue;
        const next = getNextVisitDate(client, client.freq === 'once' ? undefined : candidate);
        const occurrence = next ? toLocalDateString(next) : today;
        if ((occurrence < today ? today : occurrence) === isoDate) {
          entries.push({
            client, occurrence, overdue: occurrence < isoDate,
            position: positionIn(candidate ?? day, client.id),
          });
          return;
        }
      }
    });
  const orderOf = (entry: AgendaEntry) => dayOrder(entry.client, entry.overdue ? weekdayOf(entry.occurrence) : day);
  return entries.sort((a, b) => Number(a.overdue) - Number(b.overdue) || orderOf(a) - orderOf(b));
};

export const whatsappTemplates = (settings: Settings) => ({
  aviso_manana: settings.whatsappTomorrowVisit || DEFAULT_TOMORROW_VISIT,
  en_camino: settings.whatsappEnCamino || DEFAULT_EN_CAMINO,
});

export const debtReport = (clients: Client[], debts: Debt[], routeName: string, minimum: number) => {
  const { identity, byStableId } = debtIndex(clients, debts);
  return [...byStableId.entries()]
    .map(([stableId, list]) => {
      const client = resolveClientForStableId(stableId, identity);
      const dates = list.map((debt) => parseDate(debt.createdAt)).filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime());
      return {
        cliente_id: client?.id ?? null,
        nombre: client?.name || list[0]?.clientName || '(cliente borrado)',
        reparto: routeName,
        total: debtTotal(list),
        cantidad: list.length,
        desde: dates[0] ? toLocalDateString(dates[0]) : null,
      };
    })
    .filter((entry) => entry.total > 0 && entry.total >= minimum)
    .sort((a, b) => b.total - a.total);
};

export const debtsForClient = (clients: Client[], debts: Debt[], client: Client): Debt[] => {
  const { byStableId } = debtIndex(clients, debts);
  return byStableId.get(getStableClientId(client)) || [];
};

/** Si el cliente figura en la lista Transferencias (pendiente de revisar). */
export const hasPendingTransfer = (clients: Client[], transfers: Transfer[], client: Client): boolean => {
  const identity = buildClientIdentityIndex(clients);
  const stableId = getStableClientId(client);
  return transfers.some((transfer) => getRelatedRecordStableClientId(transfer, identity) === stableId);
};

// Igual que formatMoney (src/utils/format.ts), sin arrastrar i18n al servidor.
export const formatMoney = (n: number | undefined | null): string =>
  `$${(Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

/** Texto que manda «Enviar total ($X)» en Deudas (buildDebtTotalWhatsAppUrl). */
export const debtTotalMessage = (template: string, total: number): string =>
  (template || 'La deuda es de ${total}. Saludos').replace('${total}', formatMoney(total));

const routeLabel = (client: Client, list: Client[]) => ({
  id: client.id, nombre: client.name, posicion: list.findIndex((candidate) => candidate.id === client.id) + 1,
});

export interface PositionSuggestion {
  posicion: number | null;
  anterior: { id: string; nombre: string; posicion: number } | null;
  siguiente: { id: string; nombre: string; posicion: number } | null;
  desvio_metros: number | null;
  paradas: number;
  completa: boolean;
  sin_coordenadas: Array<{ id: string; nombre: string; posicion: number }>;
  motivo?: string;
}

/**
 * Dónde entra `target` en el recorrido de `isoDate`: entre las dos paradas
 * consecutivas (en el orden del día) donde menos desvío agrega en línea
 * recta, d(A,P) + d(P,B) − d(A,B), o en un extremo. Las paradas son las
 * fichas que Inicio muestra para esa fecha y pertenecen a la lista de ese día
 * de semana (sin `target` ni otras fichas con su mismo id).
 * Si al cliente o a alguna parada le faltan coordenadas no adivina: devuelve
 * posicion null y la lista de fichas sin coordenadas, salvo que se pida
 * explícitamente ignorarlas (`allowMissing`), y entonces lo marca incompleto.
 * `posicion` es el número que queda en la tarjeta al mover `target` ahí (el
 * mismo que espera cambiar_posicion); las de anterior/siguiente son las de hoy.
 */
export const suggestPosition = (
  clients: Client[], target: Client, isoDate: string, allowMissing = false,
): PositionSuggestion => {
  const day = weekdayOf(isoDate);
  const others = clients.filter((client) => client.id !== target.id);
  const list = dayList(others, day);
  // Atrasadas de otro día de semana figuran en «Hoy» pero no en esta lista.
  const visiting = new Set(agendaFor(others, isoDate)
    .filter((entry) => weekdayOf(entry.occurrence) === day)
    .map((entry) => entry.client.id));
  const stops = list.filter((client) => visiting.has(client.id) && !client.isNote);
  const located = stops
    .map((client) => ({ client, point: clientCoordinates(client) }))
    .filter((stop): stop is { client: Client; point: Coordinates } => !!stop.point);
  const missing = stops.filter((client) => !clientCoordinates(client)).map((client) => routeLabel(client, list));
  const empty: PositionSuggestion = {
    posicion: null, anterior: null, siguiente: null, desvio_metros: null,
    paradas: stops.length, completa: !missing.length, sin_coordenadas: missing,
  };
  const point = clientCoordinates(target);
  if (!point) {
    return { ...empty, motivo: `${target.name || 'El cliente'} no tiene coordenadas (falta resolver el link de Maps de su ubicación).` };
  }
  if (missing.length && !allowMissing) {
    return { ...empty, motivo: `${missing.length} de las ${stops.length} paradas del día no tienen coordenadas; no se sugiere una posición sin ellas.` };
  }
  const insertion = cheapestInsertion(located.map((stop) => stop.point), point);
  if (!insertion) {
    return { ...empty, motivo: stops.length ? 'Ninguna parada del día tiene coordenadas.' : 'No hay otras visitas ese día para ubicarlo.' };
  }
  const previous = located[insertion.index - 1]?.client ?? null;
  const next = located[insertion.index]?.client ?? null;
  const position = previous
    ? list.findIndex((client) => client.id === previous.id) + 2
    : list.findIndex((client) => client.id === next!.id) + 1;
  return {
    ...empty,
    posicion: position,
    anterior: previous ? routeLabel(previous, list) : null,
    siguiente: next ? routeLabel(next, list) : null,
    desvio_metros: Math.round(insertion.extraMeters),
  };
};
