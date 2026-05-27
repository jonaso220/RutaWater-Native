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
    mode?: 'add' | 'replace',
  ) => Promise<void>;
  toggleStar: (clientId: string, currentValue: boolean) => Promise<void>;
  saveAlarm: (clientId: string, time: string, targetDay?: string) => Promise<Date | null>;
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
  }) => Promise<void>;
  changePosition: (clientId: string, newPos: number, day: string) => Promise<void>;
  deleteClient: (clientId: string) => Promise<void>;
  cloneClient: (client: Client) => Promise<void>;
  findDuplicateClients: () => { staleIds: string[], details: Array<{ name: string, activeId: string, staleId: string }> };
  cleanupDuplicates: () => Promise<number>;
  addRelationship: (clientId: string, targetId: string, type: string) => Promise<void>;
  removeRelationship: (clientId: string, targetId: string) => Promise<void>;
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
  saveAlarm: async () => null,
  addNote: noop,
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
