import { create } from 'zustand';
import { Client, ClientAddress } from '../types';
import type { VisitCommand } from '../utils/visitCompletion';
import { Frequency } from '../constants/products';

interface ClientsStore {
  clients: Client[];
  loading: boolean;
  // Scope exacto de la query que produjo `clients`; no se infiere del array
  // porque un perfil vacío también es un estado canónico válido.
  scopeKey: string;
  getAllDayClients: (day: string) => Client[];
  getVisibleClients: (day: string) => Client[];
  getCompletedClients: (day: string) => Client[];
  getFilteredDirectory: (term: string, filter?: string) => Client[];
  directoryCounts: Record<string, number>;
  // Devuelve false si el write falló (la UI avisa en vez de asumir éxito).
  markAsDone: (clientId: string, client: Client, forDay?: string, intent?: VisitCommand) => Promise<boolean>;
  undoComplete: (client: Client) => Promise<void>;
  deleteAllCompleted: (day: string) => Promise<void>;
  deleteFromDay: (clientId: string, day: string) => Promise<void>;
  // Devuelven true si el write llegó a Firestore (la IA los usa para no
  // confirmar "Listo" cuando en realidad falló).
  updateClient: (clientId: string, data: Partial<Client>) => Promise<boolean>;
  scheduleFromDirectory: (
    client: Client,
    days: string[],
    freq: Frequency,
    date: string,
    notes: string,
    products: Record<string, number>,
    mode?: 'add' | 'replace',
    selectedAddress?: ClientAddress,
  ) => Promise<boolean>;
  toggleStar: (clientId: string, currentValue: boolean) => Promise<void>;
  saveAlarm: (clientId: string, time: string, targetDay?: string) => Promise<Date | null>;
  addNote: (notesText: string, date: string, freq?: Exclude<Frequency, 'on_demand'>) => Promise<boolean>;
  updateNote: (
    noteId: string,
    notesText: string,
    date: string,
    freq: Exclude<Frequency, 'on_demand'>,
  ) => Promise<boolean>;
  addClient: (
    name: string,
    address: string,
    phone: string,
    day: string,
    products: Record<string, number>,
    notes: string,
    mapsLink?: string,
  ) => Promise<void>;
  aiCreateClient: (data: {
    name: string;
    phone: string;
    address: string;
    mapsLink: string;
    notes: string;
    products: Record<string, number>;
    freq: Frequency;
    visitDay: string;
    specificDate: string;
  }) => Promise<boolean>;
  changePosition: (clientId: string, newPos: number, day: string) => Promise<void>;
  deleteClient: (clientId: string) => Promise<void>;
  cloneClient: (client: Client) => Promise<void>;
  findDuplicateClients: () => { staleIds: string[], details: Array<{ name: string, activeId: string, staleId: string }> };
  cleanupDuplicates: () => Promise<number>;
  addRelationship: (clientId: string, targetId: string, type: string, sameHousehold: boolean) => Promise<void>;
  removeRelationship: (clientId: string, targetId: string) => Promise<void>;
  dayCounts: Record<string, number>;
  canAddClient: boolean;
  clientCount: number;
}

const noop = async () => {};

export const useClientsStore = create<ClientsStore>()(() => ({
  clients: [],
  loading: true,
  scopeKey: '',
  getAllDayClients: () => [],
  getVisibleClients: () => [],
  getCompletedClients: () => [],
  getFilteredDirectory: () => [],
  directoryCounts: {},
  markAsDone: async () => true,
  undoComplete: noop,
  deleteAllCompleted: noop,
  deleteFromDay: noop,
  updateClient: async () => false,
  scheduleFromDirectory: noop as any,
  toggleStar: noop,
  saveAlarm: async () => null,
  addNote: async () => false,
  updateNote: async () => false,
  addClient: noop as any,
  aiCreateClient: noop as any,
  changePosition: noop,
  deleteClient: noop,
  cloneClient: noop,
  findDuplicateClients: () => ({ staleIds: [], details: [] }),
  cleanupDuplicates: async () => 0,
  addRelationship: noop as any,
  removeRelationship: noop,
  dayCounts: {},
  canAddClient: true,
  clientCount: 0,
}));
