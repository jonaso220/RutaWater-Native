import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useClients } from '../hooks/useClients';
import { useAuthContext } from './AuthContext';
import { Client } from '../types';
import { Frequency } from '../constants/products';
import { ALL_DAYS } from '../constants/products';

interface ClientsContextType {
  clients: Client[];
  loading: boolean;
  getAllDayClients: (day: string) => Client[];
  getVisibleClients: (day: string) => Client[];
  getCompletedClients: (day: string) => Client[];
  getFilteredDirectory: (term: string) => Client[];
  markAsDone: (clientId: string, client: Client) => Promise<void>;
  undoComplete: (clientId: string) => Promise<void>;
  deleteAllCompleted: (day: string) => Promise<void>;
  deleteFromDay: (clientId: string) => Promise<void>;
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
  /** Pre-computed client counts per day for the day selector */
  dayCounts: Record<string, number>;
}

const ClientsContext = createContext<ClientsContextType | null>(null);

export const ClientsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, groupData } = useAuthContext();

  const hook = useClients({
    userId: user?.uid || '',
    groupId: groupData?.groupId,
  });

  // Memoize day counts so the day selector doesn't recompute on every render
  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ALL_DAYS.forEach((day) => {
      counts[day] = hook.getVisibleClients(day).length;
    });
    return counts;
  }, [hook.clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(
    () => ({ ...hook, dayCounts }),
    [hook.clients, hook.loading, dayCounts], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <ClientsContext.Provider value={value}>
      {children}
    </ClientsContext.Provider>
  );
};

export const useClientsContext = (): ClientsContextType => {
  const ctx = useContext(ClientsContext);
  if (!ctx) throw new Error('useClientsContext must be used within ClientsProvider');
  return ctx;
};
