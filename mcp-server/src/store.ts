import type { Firestore, Query } from 'firebase-admin/firestore';
import type { Client, Debt, Transfer } from '../../src/types';
import { withDefaults } from '../../src/utils/clientDefaults';
import { belongsToProfileScope } from '../../src/utils/profileScope';
import { Account, loadAccount, Route } from './routes';

type Unsubscribe = () => void;

/**
 * Copia en vivo (onSnapshot) de los datos de cada reparto. El proceso MCP vive
 * toda la sesión: escuchar evita releer cientos de fichas en cada consulta y
 * refleja al instante lo que se cambia desde la app.
 */
class LiveCollection<T> {
  private items: T[] = [];
  private ready: Promise<void> | null = null;
  private unsubscribers: Unsubscribe[] = [];

  constructor(private queries: Query[], private map: (id: string, data: any) => T | null) {}

  get(): Promise<T[]> {
    if (!this.ready) {
      const partial: T[][] = this.queries.map(() => []);
      this.ready = Promise.all(this.queries.map((query, index) => new Promise<void>((resolve, reject) => {
        let first = true;
        this.unsubscribers.push(query.onSnapshot((snap) => {
          partial[index] = snap.docs
            .map((doc) => this.map(doc.id, doc.data()))
            .filter((item): item is NonNullable<T> => item !== null) as T[];
          this.items = partial.flat();
          if (first) { first = false; resolve(); }
        }, (error) => {
          if (first) { first = false; reject(error); }
          // Un listener caído se recrea en la próxima consulta.
          this.ready = null;
        }));
      }))).then(() => undefined);
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready.then(() => this.items);
  }

  close(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.ready = null;
  }
}

// Mismas consultas que la app en modo compatible (groupId / userId); después
// se filtra con belongsToProfileScope para no mezclar Reparto 1 con otros.
export const scopeQueries = (db: Firestore, collection: string, uid: string, route: Route): Query[] => (
  route.groupId
    ? [db.collection(collection).where('groupId', '==', route.groupId)]
    : [db.collection(collection).where('userId', '==', uid)]
);

export interface Settings {
  productNames: Record<string, string>;
  customProducts: Array<{ id: string; label: string }>;
  whatsappTomorrowVisit: string;
  whatsappEnCamino: string;
  // Plantilla de «Enviar total» (Ajustes → WhatsApp → deuda).
  whatsappDeuda: string;
}

export class Store {
  private account: Promise<Account> | null = null;
  private clients = new Map<string, LiveCollection<Client>>();
  private debts = new Map<string, LiveCollection<Debt>>();
  private transfers = new Map<string, LiveCollection<Transfer>>();

  constructor(readonly db: Firestore, readonly uid: string) {}

  getAccount(): Promise<Account> {
    if (!this.account) {
      this.account = loadAccount(this.db, this.uid);
      this.account.catch(() => { this.account = null; });
    }
    return this.account;
  }

  /** Vuelve a leer repartos y permisos (antes de escribir, por si cambiaron). */
  async refreshAccount(): Promise<Account> {
    this.account = null;
    return this.getAccount();
  }

  async getClients(route: Route): Promise<Client[]> {
    let live = this.clients.get(route.id);
    if (!live) {
      live = new LiveCollection<Client>(scopeQueries(this.db, 'clients', this.uid, route), (id, data) =>
        belongsToProfileScope(data, this.uid, route.groupId) ? withDefaults(id, data) : null);
      this.clients.set(route.id, live);
    }
    return live.get();
  }

  async getDebts(route: Route): Promise<Debt[]> {
    let live = this.debts.get(route.id);
    if (!live) {
      live = new LiveCollection<Debt>(scopeQueries(this.db, 'debts', this.uid, route), (id, data) =>
        belongsToProfileScope(data, this.uid, route.groupId) ? { ...data, id } as Debt : null);
      this.debts.set(route.id, live);
    }
    return live.get();
  }

  /** Transferencias pendientes de revisar (lista Transferencias de la app). */
  async getTransfers(route: Route): Promise<Transfer[]> {
    let live = this.transfers.get(route.id);
    if (!live) {
      live = new LiveCollection<Transfer>(scopeQueries(this.db, 'transfers', this.uid, route), (id, data) =>
        belongsToProfileScope(data, this.uid, route.groupId) ? { ...data, id } as Transfer : null);
      this.transfers.set(route.id, live);
    }
    return live.get();
  }

  async getSettings(): Promise<Settings> {
    const account = await this.getAccount();
    const data = (await this.db.collection('settings').doc(account.settingsDocId).get()).data() || {};
    return {
      productNames: data.productNames && typeof data.productNames === 'object' ? data.productNames : {},
      customProducts: Array.isArray(data.customProducts) ? data.customProducts : [],
      whatsappTomorrowVisit: typeof data.whatsappTomorrowVisit === 'string' ? data.whatsappTomorrowVisit : '',
      whatsappEnCamino: typeof data.whatsappEnCamino === 'string' ? data.whatsappEnCamino : '',
      whatsappDeuda: typeof data.whatsappDeuda === 'string' ? data.whatsappDeuda : '',
    };
  }

  close(): void {
    [...this.clients.values(), ...this.debts.values(), ...this.transfers.values()].forEach((live) => live.close());
    this.clients.clear();
    this.debts.clear();
    this.transfers.clear();
  }
}
