import { Client } from '../types';
import { getClientMatchKey, parseDate } from './helpers';

// Solo visitas reales (entrega marcada como hecha). lastDeliveredAt es el
// historial canónico nuevo; completedAt/lastVisited mantienen compatibilidad
// con documentos anteriores. updatedAt nunca es una entrega: puede cambiar al
// editar teléfono, frecuencia, notas o cualquier otro dato.
export const getLastVisitDate = (client: Client): Date | null => {
  const candidates = [
    parseDate(client.lastDeliveredAt),
    parseDate(client.completedAt),
    parseDate(client.lastVisited),
  ].filter((date): date is Date => !!date);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, date) =>
    date.getTime() > latest.getTime() ? date : latest,
  );
};

export const getLastActivityDate = (client: Client): Date | null => {
  // Compatibilidad con fichas antiguas: antes de existir lastVisited, la app
  // mostraba updatedAt como referencia aproximada. Solo se usa para la ficha
  // misma; getEffectiveLastActivityDate comparte exclusivamente entregas
  // reales con el resto del hogar.
  return getLastVisitDate(client) || parseDate(client.updatedAt);
};

// Transición canónica al volver una ficha al Directorio: promueve primero la
// entrega real más reciente (incluidos campos legados) y luego libera
// lastVisited para que no siga actuando como estado de una agenda inexistente.
export const getDirectoryDeliveryHistoryUpdate = (client: Client): {
  lastDeliveredAt: Date | null;
  lastVisited: null;
} => ({
  lastDeliveredAt: getLastVisitDate(client),
  lastVisited: null,
});

// Los vínculos creados antes de que existiera sameHousehold representaban una
// "familia/casa" sin distinción. Solo un false explícito significa otra casa.
export const sharesHouseholdWith = (client: Client, relatedId: string): boolean => {
  return !!client.relationships?.[relatedId] && client.sameHousehold?.[relatedId] !== false;
};

// Resuelve el hogar como un grafo, no como una lista guardada únicamente en la
// ficha que se está mostrando. Esto cubre datos legados/asimétricos (A apunta a
// B pero B no apunta a A) y hogares encadenados (A-B-C). Un `false` explícito en
// cualquiera de los dos lados siempre corta el vínculo de domicilio.
const sharesHouseholdInEitherDirection = (a: Client, b: Client): boolean => {
  const aLinksB = !!a.relationships?.[b.id];
  const bLinksA = !!b.relationships?.[a.id];
  if (!aLinksB && !bLinksA) return false;
  if (aLinksB && a.sameHousehold?.[b.id] === false) return false;
  if (bLinksA && b.sameHousehold?.[a.id] === false) return false;
  return true;
};

export const getHouseholdMembers = (
  client: Client,
  clientsById?: Map<string, Client> | null,
): Client[] => {
  if (!clientsById) return [];

  const household: Client[] = [];
  const visited = new Set<string>([client.id]);
  const queue: Client[] = [client];
  const allClients = Array.from(clientsById.values());

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const candidate of allClients) {
      if (visited.has(candidate.id)) continue;
      if (!sharesHouseholdInEitherDirection(current, candidate)) continue;
      visited.add(candidate.id);
      household.push(candidate);
      queue.push(candidate);
    }
  }

  return household;
};

// Última actividad "del hogar": la visita más reciente entre el cliente y todos sus
// familiares del mismo hogar. Visitar a cualquier integrante de la casa cuenta como
// haber visitado al cliente, así no aparece como "viejo" en el filtro de Recurrencia.
// Es un cálculo derivado en lectura: NO modifica el registro de nadie; si se desvincula
// el familiar, se revierte solo.
export const getEffectiveLastActivityDate = (
  client: Client,
  clientsById?: Map<string, Client> | null,
): Date | null => {
  if (!clientsById) return getLastActivityDate(client);

  // Un cliente humano puede tener varios documentos por pedidos extra. El
  // parentesco suele vivir en la ficha original, mientras la entrega reciente
  // puede quedar en otra instancia. Consideramos todas las instancias con el
  // mismo nombre+teléfono sin mostrarlas como familiares separados.
  const household = [client, ...getHouseholdMembers(client, clientsById)];
  const householdIds = new Set(household.map((member) => member.id));
  const householdCustomerIds = new Set(
    household.map((member) => member.customerId || member.id),
  );
  const householdMatchKeys = new Set(
    household
      .map((member) => getClientMatchKey(member.name || '', member.phone || '', member.id))
      .filter((key) => !key.startsWith('__id_')),
  );

  let best: Date | null = getLastActivityDate(client);
  for (const candidate of clientsById.values()) {
    const key = getClientMatchKey(candidate.name || '', candidate.phone || '', candidate.id);
    const belongsToHouseholdCustomer = householdCustomerIds.has(
      candidate.customerId || candidate.id,
    );
    if (
      !householdIds.has(candidate.id) &&
      !belongsToHouseholdCustomer &&
      !householdMatchKeys.has(key)
    ) continue;
    const delivery = getLastVisitDate(candidate);
    if (delivery && (!best || delivery.getTime() > best.getTime())) best = delivery;
  }
  return best;
};

// Precalcula la recencia de todos los clientes en tiempo casi lineal. El
// filtro Recurrencia antes llamaba getEffectiveLastActivityDate dentro del
// sort y de cada tarjeta, recorriendo cientos de fichas miles de veces.
//
// Union-find reúne documentos de una misma persona (customerId o
// nombre+teléfono) y después une los parentescos que comparten domicilio.
export const buildEffectiveLastActivityDates = (
  clients: Iterable<Client>,
): Map<string, Date | null> => {
  const all = Array.from(clients);
  const byId = new Map(all.map((client) => [client.id, client]));
  const parent = new Map(all.map((client) => [client.id, client.id]));
  const componentSize = new Map(all.map((client) => [client.id, 1]));

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let current = id;
    while (parent.get(current) && parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return;
    if ((componentSize.get(rootA) || 1) < (componentSize.get(rootB) || 1)) {
      [rootA, rootB] = [rootB, rootA];
    }
    parent.set(rootB, rootA);
    componentSize.set(
      rootA,
      (componentSize.get(rootA) || 1) + (componentSize.get(rootB) || 1),
    );
  };

  const customerOwner = new Map<string, string>();
  const matchOwner = new Map<string, string>();
  all.forEach((client) => {
    const customerId = client.customerId || client.id;
    const existingCustomer = customerOwner.get(customerId);
    if (existingCustomer) union(client.id, existingCustomer);
    else customerOwner.set(customerId, client.id);

    const matchKey = getClientMatchKey(client.name || '', client.phone || '', client.id);
    if (!matchKey.startsWith('__id_')) {
      const existingMatch = matchOwner.get(matchKey);
      if (existingMatch) union(client.id, existingMatch);
      else matchOwner.set(matchKey, client.id);
    }
  });

  all.forEach((client) => {
    Object.keys(client.relationships || {}).forEach((relatedId) => {
      const related = byId.get(relatedId);
      if (related && sharesHouseholdInEitherDirection(client, related)) {
        union(client.id, related.id);
      }
    });
  });

  const latestDeliveryByRoot = new Map<string, Date>();
  all.forEach((client) => {
    const delivery = getLastVisitDate(client);
    if (!delivery) return;
    const root = find(client.id);
    const previous = latestDeliveryByRoot.get(root);
    if (!previous || delivery.getTime() > previous.getTime()) {
      latestDeliveryByRoot.set(root, delivery);
    }
  });

  const result = new Map<string, Date | null>();
  all.forEach((client) => {
    const householdDelivery = latestDeliveryByRoot.get(find(client.id)) || null;
    const ownActivity = getLastActivityDate(client);
    const effective = ownActivity && (
      !householdDelivery || ownActivity.getTime() > householdDelivery.getTime()
    ) ? ownActivity : householdDelivery;
    result.set(client.id, effective);
  });
  return result;
};

export const getDaysSince = (date: Date | null): number | null => {
  if (!date) return null;
  // Días CALENDARIO, no períodos de 24 h: una visita de ayer a las 20:00 debe
  // decir "Hace 1 día" hoy a la mañana, no "Hace 0 días".
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
};
