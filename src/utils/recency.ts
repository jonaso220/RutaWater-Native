import { Client } from '../types';
import { parseDate } from './helpers';

export const getLastActivityDate = (client: Client): Date | null => {
  return parseDate(client.completedAt) || parseDate(client.lastVisited) || parseDate(client.updatedAt);
};

// Solo visitas reales (entrega marcada como hecha), sin el fallback de updatedAt:
// editar la ficha de un familiar no debe contar como haberlo visitado.
export const getLastVisitDate = (client: Client): Date | null => {
  return parseDate(client.completedAt) || parseDate(client.lastVisited);
};

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
  let best = getLastActivityDate(client);
  for (const familyMember of getHouseholdMembers(client, clientsById)) {
    const d = getLastVisitDate(familyMember);
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
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
