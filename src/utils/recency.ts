import { Client } from '../types';
import { parseDate } from './helpers';

export const getLastActivityDate = (client: Client): Date | null => {
  return parseDate(client.completedAt) || parseDate(client.lastVisited) || parseDate(client.updatedAt);
};

// Solo visitas reales (entrega marcada como hecha), sin el fallback de updatedAt:
// editar la ficha de un familiar no debe contar como haberlo visitado.
const getVisitDate = (client: Client): Date | null => {
  return parseDate(client.completedAt) || parseDate(client.lastVisited);
};

// Última actividad "del hogar": la visita más reciente entre el cliente y todos sus
// familiares vinculados. Visitar a un familiar directo (misma casa) cuenta como haber
// visitado al cliente, así no aparece como "viejo" en el filtro de Recurrencia.
// Es un cálculo derivado en lectura: NO modifica el registro de nadie; si se desvincula
// el familiar, se revierte solo.
export const getEffectiveLastActivityDate = (
  client: Client,
  clientsById?: Map<string, Client> | null,
): Date | null => {
  let best = getLastActivityDate(client);
  const rel = client.relationships;
  if (rel && clientsById) {
    for (const famId of Object.keys(rel)) {
      const fam = clientsById.get(famId);
      if (!fam) continue;
      const d = getVisitDate(fam);
      if (d && (!best || d.getTime() > best.getTime())) best = d;
    }
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
