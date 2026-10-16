import { db } from '../config/firebase';
import type { Client } from '../types';
import {
  Coordinates, coordinateUpdates, linksWithoutCoordinates, resolveMapsCoordinates,
} from '../utils/geo';

// Links ya probados en esta sesión por ficha, para no repetir la consulta a
// Google ni la transacción si la misma ficha se guarda varias veces.
const attempted = new Set<string>();

/**
 * Después de guardar una ubicación, resuelve en segundo plano los links de
 * Google Maps sin coordenadas y guarda lat/lng en esa ficha (las direcciones y
 * los campos de la ubicación principal). Solo toca Firestore si algún link se
 * resolvió: una lectura y una escritura, dentro de una transacción para no
 * pisar una edición hecha mientras tanto. Sin conexión o con un link que solo
 * nombra un lugar no hace nada; nunca bloquea ni falla el guardado.
 */
export const fillClientCoordinates = async (
  clientId: string,
  saved: Partial<Client> | Record<string, unknown>,
): Promise<void> => {
  try {
    const links = linksWithoutCoordinates(saved as Partial<Client>)
      .filter((link) => !attempted.has(`${clientId}|${link}`));
    if (!clientId || !links.length) return;
    const resolved = new Map<string, Coordinates>();
    await Promise.all(links.map(async (link) => {
      attempted.add(`${clientId}|${link}`);
      try {
        const point = await resolveMapsCoordinates(link);
        if (point) resolved.set(link, point);
      } catch {
        // Sin red: se vuelve a intentar la próxima vez que se guarde.
        attempted.delete(`${clientId}|${link}`);
      }
    }));
    if (!resolved.size) return;
    const ref = db.collection('clients').doc(clientId);
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return;
      const updates = coordinateUpdates(snap.data() as Partial<Client>, resolved);
      if (updates) transaction.update(ref, updates);
    });
  } catch (error) {
    if (__DEV__) console.warn('fillClientCoordinates', error);
  }
};

/** Para fichas con ubicación: true si conviene intentar completar coordenadas. */
export const touchesLocation = (data: Record<string, unknown>): boolean =>
  'addresses' in data || 'mapsLink' in data;
