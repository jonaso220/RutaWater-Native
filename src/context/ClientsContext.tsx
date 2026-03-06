import React, { createContext, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { useClients } from '../hooks/useClients';
import { useAuthContext } from './AuthContext';
import { Client } from '../types';
import { Frequency } from '../constants/products';
import { ALL_DAYS } from '../constants/products';
import { db } from '../config/firebase';

interface ClientsContextType {
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

  // Auto-cleanup: expired completed 'once' clients
  const cleanupDoneRef = useRef(false);
  useEffect(() => {
    if (cleanupDoneRef.current) return;
    if (hook.clients.length === 0) return;
    cleanupDoneRef.current = true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiredCompleted = hook.clients.filter((c) =>
      c.isCompleted &&
      c.freq === 'once' &&
      c.specificDate &&
      new Date(c.specificDate + 'T12:00:00') < today,
    );

    if (expiredCompleted.length === 0) return;

    const batchSize = 450;
    for (let i = 0; i < expiredCompleted.length; i += batchSize) {
      const chunk = expiredCompleted.slice(i, i + batchSize);
      const batch = db.batch();
      chunk.forEach((c) => {
        const ref = db.collection('clients').doc(c.id);
        if (c.isNote) {
          batch.delete(ref);
        } else {
          batch.update(ref, {
            freq: 'on_demand',
            visitDay: 'Sin Asignar',
            visitDays: [],
            isCompleted: false,
            completedAt: null,
            updatedAt: new Date(),
          });
        }
      });
      batch.commit().catch((err) => console.error('Auto-cleanup error:', err));
    }
  }, [hook.clients]);

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
