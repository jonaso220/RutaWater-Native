import { Client } from '../types';
import { getStableClientId } from './clientIdentity';
import { getLastVisitDate } from './recency';

// «Borrar completados» (deleteAllCompleted). Antes, todo pedido de una vez
// completado volvía al Directorio, también el pedido extra de un cliente que ya
// tiene su ficha en la agenda: cada pedido extra dejaba una copia del cliente
// en el Directorio (22/10/2026: 66 copias en la cuenta de Jonathan). Ahora una
// ficha completada solo vuelve al Directorio si el cliente no tiene otra; si la
// tiene, se borra y su última entrega pasa a esa otra ficha.

export type ClearAction =
  | { kind: 'delete-note'; client: Client }
  | { kind: 'to-directory'; client: Client }
  | { kind: 'delete-extra'; client: Client; keeperId: string };

export interface ClearPlan {
  actions: ClearAction[];
  /** Última entrega que hay que pasar a cada ficha que queda (solo si es más nueva que la suya). */
  keeperDeliveries: Map<string, Date>;
}

const time = (date: Date | null): number => (date ? date.getTime() : 0);

/**
 * Qué hacer con cada ficha completada del día. `all` son todas las fichas
 * cargadas (incluidas las completadas). La ficha que queda es preferentemente
 * una con agenda, después una de directorio y, si no hay ninguna, la primera
 * completada de ese cliente (esa vuelve al Directorio y las demás se borran).
 */
export const planClearCompleted = (completed: Client[], all: Client[]): ClearPlan => {
  const completedIds = new Set(completed.map((client) => client.id));
  const keepers = new Map<string, Client>();
  const rank = (client: Client): number => (client.freq === 'on_demand' ? 1 : client.freq === 'once' ? 2 : 0);
  all
    .filter((client) => !client.isNote && !completedIds.has(client.id))
    .forEach((client) => {
      const stableId = getStableClientId(client);
      const current = keepers.get(stableId);
      if (!current || rank(client) < rank(current)) keepers.set(stableId, client);
    });

  const keeperDeliveries = new Map<string, Date>();
  const actions: ClearAction[] = [];
  for (const client of completed) {
    if (client.isNote) {
      actions.push({ kind: 'delete-note', client });
      continue;
    }
    const stableId = getStableClientId(client);
    const keeper = keepers.get(stableId);
    if (!keeper) {
      // Es la única ficha del cliente: vuelve al Directorio y queda como la que se conserva.
      keepers.set(stableId, client);
      actions.push({ kind: 'to-directory', client });
      continue;
    }
    actions.push({ kind: 'delete-extra', client, keeperId: keeper.id });
    const mine = getLastVisitDate(client);
    const best = keeperDeliveries.get(keeper.id) || getLastVisitDate(keeper);
    if (mine && time(mine) > time(best)) keeperDeliveries.set(keeper.id, mine);
  }
  return { actions, keeperDeliveries };
};
