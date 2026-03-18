import { create } from 'zustand';
import { Client } from '../types';
import { Frequency } from '../constants/products';

interface ClientsStore {
  clients: Client[];
  loading: boolean;
  getAllDayClients: (day: string) => Client[];
  getVisibleClients: (day: string) => Client[];
  getCompletedClients: (day: string) => Client[];
  getFilteredDirectory: (term: string, filter?: string) => Client[];
  directoryCounts: Record<string, number>;
  markAsDone: (clientId: string, client: Client) => Promise<void>;
  undoComplete: (clientId: string) => Promise<void>;
  deleteAllCompleted: (day: string) => Promise<void>;
  deleteFromDay: (clientId: string, day: string) => Promise<void>;
  updateClient: (clientId: string, data: Partial<Client>) => Promise<void>;
  scheduleFromDirectory: (
    client: Client,
    days: string[],
    freq: Frequency,
    date: string,
    notes: string,
    products: Record<string, number>,
  ) => Promise<void>;
  toggleStar: (clientId: string, currentValue: boolean) => Promise<void>;
  saveAlarm: (clientId: string, time: string) => Promise<void>;
  addNote: (notesText: string, date: string) => Promise<void>;
  addClient: (
    name: string,
    address: string,
    phone: string,
    day: string,
    products: Record<string, number>,
    notes: string,
    mapsLink?: string,
  ) => Promise<void>;
  changePosition: (clientId: string, newPos: number, day: string) => Promise<void>;
  deleteClient: (clientId: string) => Promise<void>;
  cloneClient: (client: Client) => Promise<void>;
  findDuplicateClients: () => { staleIds: string[], details: Array<{ name: string, activeId: string, staleId: string }> };
  cleanupDuplicates: () => Promise<number>;
  dayCounts: Record<string, number>;
  canAddClient: boolean;
  clientCount: number;
}

const noop = async () => {};

export const useClientsStore = create<ClientsStore>()(() => ({
  clients: [],
  loading: true,
  getAllDayClients: () => [],
  getVisibleClients: () => [],
  getCompletedClients: () => [],
  getFilteredDirectory: () => [],
  directoryCounts: {},
  markAsDone: noop,
  undoComplete: noop,
  deleteAllCompleted: noop,
  deleteFromDay: noop,
  updateClient: noop,
  scheduleFromDirectory: noop as any,
  toggleStar: noop,
  saveAlarm: noop,
  addNote: noop,
  addClient: noop as any,
  changePosition: noop,
  deleteClient: noop,
  cloneClient: noop,
  findDuplicateClients: () => ({ staleIds: [], details: [] }),
  cleanupDuplicates: async () => 0,
  dayCounts: {},
  canAddClient: true,
  clientCount: 0,
}));
