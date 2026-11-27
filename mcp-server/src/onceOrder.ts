import type { Firestore } from 'firebase-admin/firestore';
import type { Client } from '../../src/types';
import type { Account, Route } from './routes';
import { addDays, dayList, suggestPosition, weekdayOf } from './views';
import { changePosition, ChangeResult } from './writes';

// Pedidos de una vez que Jonathan carga desde la app (27/11/2026): la app los
// deja primeros del día y antes los acomodaban las pasadas programadas. Ahora
// los ubica el vigilante, una sola vez cada uno y sin Claude: entre las dos
// paradas donde menos desvío agregan, igual que agendar_una_vez con ubicar.
//
// Una ficha se ubica solo si sigue donde la deja la app (arriba de todo, sin
// nada delante más que notas u otros pedidos de una vez sin ubicar) y nadie
// la movió todavía con una herramienta. Si ya no está arriba, la acomodó
// Jonathan a mano: no se toca, ni ahora ni después.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Una visita de una vez se identifica con su fecha: la misma ficha puede volver a agendarse otro día. */
export const onceKey = (client: Pick<Client, 'id' | 'specificDate'>): string => `${client.id}|${client.specificDate || ''}`;

const isOpenOnce = (client: Client): boolean => client.freq === 'once' && !client.isCompleted && !client.isNote
  && ISO_DATE.test(String(client.specificDate || ''));

export interface OncePending {
  /** Siguen arriba de todo y nadie las ubicó: hay que ubicarlas. */
  porUbicar: Client[];
  /** Ya no están donde las deja la app: alguien las acomodó a mano. */
  movidas: Client[];
}

/**
 * Pedidos de una vez de `today` a `today + days` que todavía no se trataron
 * (`known` trae las claves de los ya ubicados o movidos con una herramienta).
 */
export const pendingOnce = (clients: Client[], today: string, days: number, known: ReadonlySet<string>): OncePending => {
  const last = addDays(today, days);
  const result: OncePending = { porUbicar: [], movidas: [] };
  const unknownOnce = (client: Client) => isOpenOnce(client) && !known.has(onceKey(client));
  const targets = clients
    .filter((client) => unknownOnce(client) && client.specificDate! >= today && client.specificDate! <= last)
    .sort((a, b) => a.specificDate!.localeCompare(b.specificDate!) || a.id.localeCompare(b.id));
  for (const target of targets) {
    const list = dayList(clients, weekdayOf(target.specificDate!));
    const index = list.findIndex((client) => client.id === target.id);
    if (index === -1) continue;
    const onTop = list.slice(0, index).every((client) => client.isNote || unknownOnce(client));
    (onTop ? result.porUbicar : result.movidas).push(target);
  }
  return result;
};

export type OnceOutcome =
  | 'ubicada' | 'ya_estaba' | 'movida_a_mano' | 'sin_coordenadas' | 'esperando' | 'no_se_pudo' | 'simulada';

export interface OnceResult {
  clave: string;
  cliente_id: string;
  nombre: string;
  reparto: string;
  fecha: string;
  resultado: OnceOutcome;
  antes?: number;
  posicion?: number;
  anterior?: string | null;
  siguiente?: string | null;
  desvio_metros?: number | null;
  /** Paradas del día sin ubicación, que no entraron en la cuenta. */
  paradas_sin_ubicacion?: number;
  motivo?: string;
}

export interface OnceOrderOptions {
  db: Firestore;
  account: Account;
  /** Fichas del reparto tal como están ahora (se vuelve a pedir después de cada movimiento). */
  loadClients: (route: Route) => Promise<Client[]>;
  today: string;
  known: ReadonlySet<string>;
  /** true si la ficha se tocó hace un momento: Jonathan puede estar cargándola todavía. */
  recentlyEdited?: (client: Client) => boolean;
  dryRun?: boolean;
  days?: number;
  maxMoves?: number;
  /** Espera entre intentos de ver el movimiento anterior reflejado en la lista. */
  pause?: () => Promise<void>;
  move?: typeof changePosition;
}

const positionOf = (clients: Client[], id: string, date: string): number =>
  dayList(clients, weekdayOf(date)).findIndex((client) => client.id === id) + 1;

/** Ubica los pedidos de una vez que siguen primeros del día. Devuelve qué pasó con cada uno. */
export const orderOnceVisits = async (options: OnceOrderOptions): Promise<OnceResult[]> => {
  const {
    db, account, loadClients, today, known, recentlyEdited = () => false, dryRun = false,
    days = 7, maxMoves = 6, pause = () => new Promise<void>((resolve) => { setTimeout(resolve, 1000); }),
    move = changePosition,
  } = options;
  const results: OnceResult[] = [];
  let moves = 0;
  for (const route of account.routes) {
    let clients = await loadClients(route);
    const { porUbicar, movidas } = pendingOnce(clients, today, days, known);
    const base = (client: Client) => ({
      clave: onceKey(client), cliente_id: client.id, nombre: client.name, reparto: route.name, fecha: client.specificDate!,
    });
    movidas.forEach((client) => results.push({
      ...base(client), resultado: 'movida_a_mano', posicion: positionOf(clients, client.id, client.specificDate!),
    }));
    for (const pending of porUbicar) {
      if (moves >= maxMoves) break;
      const target = clients.find((client) => client.id === pending.id);
      // Cambió de fecha o se completó mientras tanto: la próxima vuelta la mira de nuevo.
      if (!target || onceKey(target) !== onceKey(pending)) continue;
      if (recentlyEdited(target)) {
        results.push({ ...base(target), resultado: 'esperando', motivo: 'se editó hace un momento' });
        continue;
      }
      const date = target.specificDate!;
      const before = positionOf(clients, target.id, date);
      const suggestion = suggestPosition(clients, target, date, true);
      if (suggestion.posicion === null) {
        results.push({ ...base(target), resultado: 'sin_coordenadas', antes: before, motivo: suggestion.motivo });
        continue;
      }
      const detail = {
        antes: before, posicion: suggestion.posicion,
        anterior: suggestion.anterior?.nombre ?? null, siguiente: suggestion.siguiente?.nombre ?? null,
        desvio_metros: suggestion.desvio_metros, paradas_sin_ubicacion: suggestion.sin_coordenadas.length,
      };
      if (suggestion.posicion === before) {
        results.push({ ...base(target), resultado: 'ya_estaba', ...detail });
        continue;
      }
      if (dryRun) {
        results.push({ ...base(target), resultado: 'simulada', ...detail });
        continue;
      }
      let changed: ChangeResult;
      try {
        changed = await move(db, account, clients, target.id, date, suggestion.posicion);
      } catch (error) {
        results.push({ ...base(target), resultado: 'no_se_pudo', ...detail, motivo: error instanceof Error ? error.message : String(error) });
        break;
      }
      moves += 1;
      const after = changed.despues as { posicion?: number; anterior?: string | null; siguiente?: string | null };
      results.push({
        ...base(target), resultado: 'ubicada', ...detail,
        posicion: after.posicion ?? suggestion.posicion, anterior: after.anterior ?? null, siguiente: after.siguiente ?? null,
      });
      // El movimiento siguiente se calcula sobre la lista: esperar a verlo reflejado
      // (con la lista vieja las fichas quedan un lugar corridas).
      let seen = false;
      for (let attempt = 0; attempt < 12 && !seen; attempt += 1) {
        await pause();
        clients = await loadClients(route);
        seen = positionOf(clients, target.id, date) === (after.posicion ?? suggestion.posicion);
      }
      if (!seen) break;
    }
  }
  return results;
};

const shortDate = (iso: string): string => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** Aviso a Jonathan con lo que se movió o no se pudo ubicar; '' si no hay nada que contarle. */
export const onceNotice = (results: OnceResult[]): string => {
  const placed: string[] = [];
  const failed: string[] = [];
  results.forEach((result) => {
    const when = `${weekdayOf(result.fecha).toLowerCase()} ${shortDate(result.fecha)}`;
    if (result.resultado === 'ubicada') {
      const between = result.anterior && result.siguiente ? `entre ${result.anterior} y ${result.siguiente}`
        : result.anterior ? `después de ${result.anterior}, al final`
          : result.siguiente ? `antes de ${result.siguiente}` : '';
      const missing = result.paradas_sin_ubicacion
        ? ` (${result.paradas_sin_ubicacion} parada${result.paradas_sin_ubicacion === 1 ? '' : 's'} sin ubicación no entraron en la cuenta)` : '';
      placed.push(`• ${result.nombre}, ${when}: posición ${result.posicion}${between ? `, ${between}` : ''}${missing}.`);
    } else if (result.resultado === 'sin_coordenadas') {
      failed.push(`• ${result.nombre}, ${when}: ${result.motivo || 'faltan coordenadas.'}`);
    }
  });
  const parts: string[] = [];
  if (placed.length) {
    parts.push(`Ubiqué en el recorrido ${placed.length === 1 ? 'el pedido de una vez que cargaste' : 'los pedidos de una vez que cargaste'}:\n${placed.join('\n')}\nSi va en otro lugar, decime y lo muevo: no lo vuelvo a tocar.`);
  }
  if (failed.length) {
    parts.push(`No pude ubicar ${failed.length === 1 ? 'este pedido de una vez, quedó primero' : 'estos pedidos de una vez, quedaron primeros'}:\n${failed.join('\n')}`);
  }
  return parts.join('\n\n');
};
