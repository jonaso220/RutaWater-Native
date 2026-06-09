import { useCallback, useRef, useMemo } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../config/firebase';
import { Client, RELATIONSHIP_INVERSE } from '../types';
import { normalizeText, fuzzyMatch, matchScore, getNextVisitDate, getWeekNumber, normalizePhoneForComparison } from '../utils/helpers';
import { ALL_DAYS, Frequency } from '../constants/products';
import { scheduleClientAlarm, cancelClientAlarm, requestNotificationPermission } from '../services/notifications';
import { useClientsQuery, clientsQueryKey } from './queries/useClientsQuery';
import { reportError } from '../lib/crashReporting';

interface UseClientsProps {
  userId: string;
  groupId?: string;
}

// Comparator for a single day's list: prefer listOrders[day], fall back to the
// legacy single `listOrder`, and push clients with no order to the end.
// (Identical to the inline sort getAllDayClients used before it was cached.)
const compareDayOrder = (day: string) => (a: Client, b: Client) => {
  const hasOrderA = a.listOrders && typeof a.listOrders[day] === 'number';
  const hasOrderB = b.listOrders && typeof b.listOrders[day] === 'number';
  let orderA: number, orderB: number;
  if (hasOrderA) {
    orderA = a.listOrders![day];
  } else {
    orderA = (a.listOrder ?? 0) > 1000000 ? 999999 + ((a.listOrder ?? 0) / 1e15) : (a.listOrder || 999999);
  }
  if (hasOrderB) {
    orderB = b.listOrders![day];
  } else {
    orderB = (b.listOrder ?? 0) > 1000000 ? 999999 + ((b.listOrder ?? 0) / 1e15) : (b.listOrder || 999999);
  }
  return orderA - orderB;
};

export const useClients = ({ userId, groupId }: UseClientsProps) => {
  // Data source: TanStack Query holds the live array fed by a perpetual
  // Firestore listener (see useClientsQuery). isPending stays true until
  // the first snapshot arrives, mirroring the old `loading` boolean.
  const clientsQuery = useClientsQuery({ userId, groupId });
  // useMemo to keep the reference stable while data is still undefined:
  // a bare `?? []` would create a new array each render, causing downstream
  // effects (StoreSync, getAllDayClients, etc.) to fire spuriously.
  const clients = useMemo<Client[]>(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const loading = clientsQuery.isPending;

  const queryClient = useQueryClient();
  const cacheKey = useMemo(() => clientsQueryKey(groupId || userId), [userId, groupId]);
  // Optimistic-update helper: writes directly into the React Query cache so
  // consumers see the change immediately. The Firestore listener will
  // overwrite this with the authoritative server state on its next snapshot.
  const setClientsCache = useCallback(
    (updater: (prev: Client[]) => Client[]) => {
      queryClient.setQueryData<Client[]>(cacheKey, (prev) => updater(prev ?? []));
    },
    [queryClient, cacheKey],
  );

  // Ref sincrónico: siempre tiene los datos más recientes de clients
  // Evita race condition cuando se asignan posiciones rápidamente
  const clientsRef = useRef<Client[]>(clients);
  clientsRef.current = clients;
  // Guard against double-tap on markAsDone
  const markingDoneRef = useRef<Set<string>>(new Set());

  // Get ALL clients assigned to a day (including not-due), sorted by position
  // Normalization matches webapp: listOrders[day] is preferred, timestamps pushed to end
  // Precompute the filtered+sorted client list for every weekday ONCE per
  // clients change, instead of re-filtering and re-sorting the whole array on
  // every getAllDayClients/getVisibleClients call (several per render, per day).
  // Same filter as before: skip on_demand/completed; a client belongs to each
  // day in visitDays ∪ {visitDay}. Same per-day sort (compareDayOrder).
  const clientsByDay = useMemo(() => {
    const map: Record<string, Client[]> = {};
    ALL_DAYS.forEach((day) => { map[day] = []; });
    clients.forEach((c) => {
      if (c.freq === 'on_demand' || c.isCompleted) return;
      const days = new Set<string>();
      if (Array.isArray(c.visitDays)) c.visitDays.forEach((d) => days.add(d));
      if (c.visitDay) days.add(c.visitDay);
      days.forEach((d) => { if (map[d]) map[d].push(c); });
    });
    ALL_DAYS.forEach((day) => { map[day].sort(compareDayOrder(day)); });
    return map;
  }, [clients]);

  const getAllDayClients = useCallback((day: string): Client[] => {
    if (!day) return [];
    const cached = clientsByDay[day];
    if (cached) return cached;
    // Fallback for any day key outside ALL_DAYS (not used in practice).
    return clients
      .filter((c) => {
        if (c.freq === 'on_demand') return false;
        if (c.isCompleted) return false;
        return (c.visitDays && c.visitDays.includes(day)) || c.visitDay === day;
      })
      .sort(compareDayOrder(day));
  }, [clientsByDay, clients]);

  // Get visible (non-completed) clients for a specific day — sorted by assigned position
  const getVisibleClients = useCallback((day: string): Client[] => {
    return getAllDayClients(day);
  }, [getAllDayClients]);

  // Get completed clients for a specific day (only 'once' freq)
  const getCompletedClients = useCallback((day: string): Client[] => {
    return clients.filter((c) => {
      if (!c.isCompleted) return false;
      return (c.visitDays && c.visitDays.includes(day)) || c.visitDay === day;
    });
  }, [clients]);

  // Get directory (all clients, searchable with fuzzy match)
  const getFilteredDirectory = useCallback((searchTerm: string, filter: string = 'all'): Client[] => {
    const matcher = fuzzyMatch(searchTerm);
    const hasSearch = !!searchTerm.trim();
    const matched = clients
      .filter((c) => !c.isNote)
      .filter((c) => {
        if (filter === 'all') return true;
        if (filter === 'inactive') return !!c.isInactive;
        // Los ex-clientes ("inactivo") salen de todos los filtros de trabajo.
        // (El filtro Deuda se resuelve a nivel de pantalla, así que ahí sí aparecen.)
        if (c.isInactive) return false;
        if (filter === 'no_location') return !((c.lat && c.lng) || c.mapsLink);
        if (filter === 'sin_frecuencia') return c.freq === 'once' || c.freq === 'on_demand';
        return c.freq === filter;
      })
      .filter((c) => matcher(c.name || '', c.address || '', c.phone || ''));
    if (!hasSearch) {
      return matched.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return matched
      .map((c) => ({ c, score: matchScore(searchTerm, c.name || '', c.address || '', c.phone || '') }))
      .sort((a, b) => b.score - a.score || (a.c.name || '').localeCompare(b.c.name || ''))
      .map((entry) => entry.c);
  }, [clients]);

  // Directory category counts (excluding notes)
  const directoryCounts = useMemo(() => {
    const all = clients.filter((c) => !c.isNote);
    const counts: Record<string, number> = {
      total: all.length,
      weekly: 0,
      biweekly: 0,
      triweekly: 0,
      monthly: 0,
      once: 0,
      on_demand: 0,
      sin_frecuencia: 0,
      recurrencia: 0,
      no_location: 0,
      inactive: 0,
    };
    all.forEach((c) => {
      // Los inactivos solo cuentan en "Todos" (total) y en su propio chip.
      if (c.isInactive) {
        counts.inactive++;
        return;
      }
      if (c.freq && counts[c.freq] !== undefined) counts[c.freq]++;
      if (c.freq === 'once' || c.freq === 'on_demand') {
        counts.sin_frecuencia++;
        counts.recurrencia++;
      }
      if (!((c.lat && c.lng) || c.mapsLink)) counts.no_location++;
    });
    return counts;
  }, [clients]);

  // --- MUTATION FUNCTIONS ---

  // Mark a client as done for the day
  const markAsDone = useCallback(async (clientId: string, client: Client) => {
    if (markingDoneRef.current.has(clientId)) return;
    markingDoneRef.current.add(clientId);
    try {
      if (client.isNote) {
        // Notes: delete permanently (they don't belong in the directory)
        await db.collection('clients').doc(clientId).delete();
      } else if (client.freq === 'once') {
        // Once: mark as completed permanently
        await db.collection('clients').doc(clientId).update({
          isCompleted: true,
          completedAt: new Date(),
          updatedAt: new Date(),
          alarm: '',
          isStarred: false,
        });
      } else {
        // Periodic: update lastVisited to hide until next cycle
        const updates: Record<string, any> = {
          lastVisited: new Date(),
          alarm: '',
        };

        if (client.specificDate) {
          updates.specificDate = '';
        }

        if (client.isStarred) {
          updates.isStarred = false;
        }

        await db.collection('clients').doc(clientId).update(updates);
      }
    } catch (e) {
      reportError(e, 'Error marking as done');
    } finally {
      markingDoneRef.current.delete(clientId);
    }
  }, []);

  // Undo a completed client (only for 'once' freq)
  const undoComplete = useCallback(async (clientId: string) => {
    try {
      await db.collection('clients').doc(clientId).update({
        isCompleted: false,
        completedAt: null,
        updatedAt: new Date(),
      });
    } catch (e) {
      reportError(e, 'Error undoing complete');
    }
  }, []);

  // Clear all completed clients for a day:
  // - Notes (isNote): delete permanently
  // - Real clients: move back to directory (on_demand) so they stay in the system
  const deleteAllCompleted = useCallback(async (day: string) => {
    try {
      const completed = getCompletedClients(day);
      if (completed.length === 0) return;

      const BATCH_SIZE = 450;
      for (let i = 0; i < completed.length; i += BATCH_SIZE) {
        const chunk = completed.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        chunk.forEach((c) => {
          const ref = db.collection('clients').doc(c.id);
          if (c.isNote) {
            // Notes: delete permanently (they don't belong in the directory)
            batch.delete(ref);
          } else {
            // Real clients: move to directory instead of deleting
            batch.update(ref, {
              freq: 'on_demand',
              visitDay: 'Sin Asignar',
              visitDays: [],
              specificDate: '',
              listOrders: {},
              listOrder: 0,
              isCompleted: false,
              completedAt: null,
              updatedAt: new Date(),
            });
          }
        });
        await batch.commit();
      }
    } catch (e) {
      reportError(e, 'Error clearing completed');
    }
  }, [getCompletedClients]);

  // Remove a client from a specific day's route (move to directory only if last day)
  const deleteFromDay = useCallback(async (clientId: string, day: string) => {
    try {
      const client = clientsRef.current.find((c) => c.id === clientId);
      const currentDays = client?.visitDays || [];

      if (currentDays.length > 1) {
        // Client has multiple days — only remove this one
        const remainingDays = currentDays.filter((d) => d !== day);
        await db.collection('clients').doc(clientId).update({
          visitDays: remainingDays,
          visitDay: remainingDays[0],
        });
      } else {
        // Last (or only) day — move to directory
        await db.collection('clients').doc(clientId).update({
          freq: 'on_demand',
          visitDay: 'Sin Asignar',
          visitDays: [],
          specificDate: '',
          listOrders: {},
          listOrder: 0,
          isCompleted: false,
          completedAt: null,
        });
      }
    } catch (e) {
      reportError(e, 'Error deleting from day');
    }
  }, []);

  // Generic update for client fields
  const updateClient = useCallback(async (clientId: string, data: Partial<Client>) => {
    try {
      await db.collection('clients').doc(clientId).update(data);
    } catch (e) {
      reportError(e, 'Error updating client');
    }
  }, []);

  // Schedule a client from the directory to a specific day/frequency.
  // mode='add' (default, used by directory ScheduleModal): when client already has a
  // pending order, create a NEW doc so both the existing and the new order coexist.
  // mode='replace' (used by AI when moving/changing a date): update the client's
  // current doc in place instead of duplicating.
  const scheduleFromDirectory = useCallback(async (
    clientData: Client,
    newDays: string[],
    newFreq: Frequency,
    newDate: string,
    newNotes: string,
    newProducts: Record<string, number>,
    mode: 'add' | 'replace' = 'add',
  ) => {
    try {
      const currentWeek = getWeekNumber(new Date());
      const scope = groupId ? { groupId, userId } : { userId };
      const newData: Record<string, any> = {
        name: clientData.name,
        phone: clientData.phone,
        address: clientData.address,
        lat: clientData.lat,
        lng: clientData.lng,
        mapsLink: clientData.mapsLink,
        ...scope,
        userId,
        freq: newFreq,
        updatedAt: new Date(),
        notes: newNotes,
        isPinned: false,
        isCompleted: false,
        isStarred: false,
        isNote: false,
        // Scheduling an ex-client reactivates them: without this the client
        // runs in the route while still flagged "Inactivo" in the Directory.
        isInactive: false,
        alarm: '',
        products: newProducts || {},
      };

      if (newDate) {
        // One-time order - place at the beginning
        const d = new Date(newDate + 'T12:00:00');
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const dayName = dayNames[d.getDay()];

        const existingInDay = clientsRef.current.filter(
          (c) =>
            c.freq !== 'on_demand' &&
            !c.isCompleted &&
            ((c.visitDays && c.visitDays.includes(dayName)) || c.visitDay === dayName),
        );

        let minOrder = 0;
        if (existingInDay.length > 0) {
          const orders = existingInDay.map((c) => {
            const order = c.listOrders?.[dayName] ?? c.listOrder ?? 0;
            return order > 100000 ? 0 : order;
          });
          minOrder = Math.min(...orders);
        }
        const newOrder = minOrder - 1;

        newData.visitDay = dayName;
        newData.visitDays = [dayName];
        newData.specificDate = newDate;
        newData.startWeek = currentWeek;
        newData.listOrder = newOrder;
        newData.listOrders = { [dayName]: newOrder };
      } else {
        // Periodic order - place at the end
        newData.visitDays = newDays;
        newData.visitDay = newDays[0];
        newData.startWeek = currentWeek;
        newData.specificDate = null;

        const listOrders: Record<string, number> = {};
        newDays.forEach((day) => {
          const existingInDay = clientsRef.current.filter(
            (c) =>
              c.freq !== 'on_demand' &&
              !c.isCompleted &&
              ((c.visitDays && c.visitDays.includes(day)) || c.visitDay === day),
          );
          const maxOrder =
            existingInDay.length > 0
              ? Math.max(
                  ...existingInDay.map(
                    (c) => c.listOrders?.[day] ?? c.listOrder ?? 0,
                  ),
                )
              : -1;
          listOrders[day] = maxOrder + 1;
        });
        newData.listOrders = listOrders;
        newData.listOrder = listOrders[newDays[0]];
      }

      // Editing a recurring schedule (no specific date, periodic freq) is always
      // an update of the client's agenda — never a "new pending order on top".
      // The 'add' mode is meant for one-time extras (freq='once' with a date),
      // not for changing visitDays of an already-active recurring client.
      const isRecurringScheduleEdit = !newDate && newFreq !== 'once' && newFreq !== 'on_demand';

      if (clientData.freq === 'on_demand' || clientData.visitDay === 'Sin Asignar') {
        // Reactivate existing client
        await db.collection('clients').doc(clientData.id).update(newData);
      } else if (mode === 'replace' || isRecurringScheduleEdit) {
        // Move/replace: update the existing pending-order doc in place
        // (e.g. user said "movélo del 29-4 al 6 de mayo"), or the user is
        // editing the recurring schedule of an already-active client.
        await db.collection('clients').doc(clientData.id).update(newData);
      } else {
        // Add: keep the existing order and add a new one (only reached for
        // freq='once' with a date — a one-time extra pedido).
        // Check if there's an existing on_demand duplicate to reuse (match by name + phone)
        const schedNormName = (clientData.name || '').toLowerCase().trim();
        const schedNormPhone = normalizePhoneForComparison(clientData.phone);
        const existingOnDemand = clientsRef.current.find(
          c => c.id !== clientData.id &&
               c.freq === 'on_demand' &&
               (c.name || '').toLowerCase().trim() === schedNormName &&
               (schedNormPhone ? normalizePhoneForComparison(c.phone) === schedNormPhone : true)
        );

        if (existingOnDemand) {
          // Reuse the on_demand document instead of creating a new one
          await db.collection('clients').doc(existingOnDemand.id).update(newData);
        } else {
          newData.createdAt = new Date();
          await db.collection('clients').add(newData);
        }
      }
    } catch (e) {
      reportError(e, 'Error scheduling client');
    }
  }, [groupId, userId]);

  // Toggle star on a client (optimistic update)
  const toggleStar = useCallback(async (clientId: string, currentValue: boolean) => {
    const newVal = !currentValue;
    try {
      await db.collection('clients').doc(clientId).update({ isStarred: newVal });
    } catch (e) {
      reportError(e, 'Error toggling star');
    }
  }, []);

  // Save alarm time for a client. Returns the scheduled fire date (or null
  // if the alarm was cleared / failed) so the UI can confirm to the user.
  const saveAlarm = useCallback(async (clientId: string, time: string, targetDay?: string): Promise<Date | null> => {
    try {
      await db.collection('clients').doc(clientId).update({ alarm: time });
      if (time) {
        await requestNotificationPermission();
        const client = clientsRef.current.find((c) => c.id === clientId);
        // Prefer the day the user is currently viewing; fall back to the client's
        // configured visit day(s) so the alarm fires on the right delivery day.
        const resolvedDay =
          targetDay ||
          (client?.visitDays && client.visitDays.length > 0 ? client.visitDays[0] : undefined) ||
          client?.visitDay;
        return await scheduleClientAlarm(
          clientId,
          client?.name || '',
          client?.address || '',
          time,
          {
            targetDay: resolvedDay,
            specificDate: client?.freq === 'once' ? client?.specificDate : undefined,
          },
        );
      } else {
        await cancelClientAlarm(clientId);
        return null;
      }
    } catch (e) {
      reportError(e, 'Error saving alarm');
      return null;
    }
  }, []);

  // Add a note (special client with isNote: true)
  const addNote = useCallback(async (notesText: string, date: string) => {
    try {
      const d = new Date(date + 'T12:00:00');
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const dayName = dayNames[d.getDay()];

      const currentWeek = getWeekNumber(new Date());
      const scope = groupId ? { groupId, userId } : { userId };

      // Place at beginning of day
      const existingInDay = clientsRef.current.filter(
        (c) =>
          c.freq !== 'on_demand' &&
          !c.isCompleted &&
          ((c.visitDays && c.visitDays.includes(dayName)) || c.visitDay === dayName),
      );
      let minOrder = 0;
      if (existingInDay.length > 0) {
        const orders = existingInDay.map((c) => {
          const order = c.listOrders?.[dayName] ?? c.listOrder ?? 0;
          return order > 100000 ? 0 : order;
        });
        minOrder = Math.min(...orders);
      }

      await db.collection('clients').add({
        ...scope,
        userId,
        isNote: true,
        name: 'NOTA',
        phone: '',
        address: '',
        notes: notesText,
        freq: 'once',
        specificDate: date,
        visitDays: [dayName],
        visitDay: dayName,
        listOrder: minOrder - 1,
        listOrders: { [dayName]: minOrder - 1 },
        products: {},
        isCompleted: false,
        isStarred: false,
        isPinned: false,
        startWeek: currentWeek,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      reportError(e, 'Error adding note');
    }
  }, [groupId, userId]);

  // Add a new client to a day's route or directory only
  const addClient = useCallback(async (
    name: string,
    address: string,
    phone: string,
    day: string,
    products: Record<string, number>,
    notes: string,
    mapsLink?: string,
  ) => {
    try {
      const currentWeek = getWeekNumber(new Date());
      const scope = groupId ? { groupId, userId } : { userId };

      const cleanProducts: Record<string, number> = {};
      Object.entries(products).forEach(([key, val]) => {
        if (val > 0) cleanProducts[key] = val;
      });

      const isDirectoryOnly = !day;

      let listOrder = 0;
      let listOrders: Record<string, number> = {};

      if (!isDirectoryOnly) {
        const existingInDay = clientsRef.current.filter(
          (c) =>
            c.freq !== 'on_demand' &&
            !c.isCompleted &&
            ((c.visitDays && c.visitDays.includes(day)) || c.visitDay === day),
        );
        const maxOrder =
          existingInDay.length > 0
            ? Math.max(
                ...existingInDay.map(
                  (c) => c.listOrders?.[day] ?? c.listOrder ?? 0,
                ),
              )
            : -1;
        listOrder = maxOrder + 1;
        listOrders = { [day]: maxOrder + 1 };
      }

      await db.collection('clients').add({
        ...scope,
        userId,
        name,
        address,
        phone,
        lat: '',
        lng: '',
        mapsLink: mapsLink || '',
        notes,
        freq: isDirectoryOnly ? 'on_demand' : 'weekly',
        visitDay: isDirectoryOnly ? 'Sin Asignar' : day,
        visitDays: isDirectoryOnly ? [] : [day],
        specificDate: '',
        products: cleanProducts,
        listOrder,
        listOrders,
        isCompleted: false,
        isStarred: false,
        isPinned: false,
        isNote: false,
        alarm: '',
        startWeek: currentWeek,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      reportError(e, 'Error adding client');
    }
  }, [groupId, userId]);

  // Crear cliente desde el resultado de Claude (parseo de pedido en texto libre).
  // A diferencia de addClient (que crea en directorio o en un día semanal),
  // este maneja todas las frecuencias incluyendo 'once' con specificDate.
  const aiCreateClient = useCallback(async (data: {
    name: string;
    phone: string;
    address: string;
    mapsLink: string;
    notes: string;
    products: Record<string, number>;
    freq: Frequency;
    visitDay: string;
    specificDate: string;
  }) => {
    try {
      const currentWeek = getWeekNumber(new Date());
      const scope = groupId ? { groupId, userId } : { userId };

      const cleanProducts: Record<string, number> = {};
      Object.entries(data.products).forEach(([key, val]) => {
        if (val > 0) cleanProducts[key] = val;
      });

      const isOnceWithDate = data.freq === 'once' && !!data.specificDate;
      const isOnDemand = data.freq === 'on_demand' || (!data.visitDay && !isOnceWithDate);

      let visitDay = isOnDemand ? 'Sin Asignar' : data.visitDay;
      let visitDays: string[] = isOnDemand ? [] : (data.visitDay ? [data.visitDay] : []);
      let specificDate = '';

      if (isOnceWithDate) {
        const d = new Date(data.specificDate + 'T12:00:00');
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        visitDay = dayNames[d.getDay()];
        visitDays = [visitDay];
        specificDate = data.specificDate;
      }

      let listOrder = 0;
      const listOrders: Record<string, number> = {};
      if (!isOnDemand && visitDays.length > 0) {
        visitDays.forEach((day) => {
          const existingInDay = clientsRef.current.filter(
            (c) =>
              c.freq !== 'on_demand' &&
              !c.isCompleted &&
              ((c.visitDays && c.visitDays.includes(day)) || c.visitDay === day),
          );
          if (specificDate) {
            const orders = existingInDay.map((c) => {
              const order = c.listOrders?.[day] ?? c.listOrder ?? 0;
              return order > 100000 ? 0 : order;
            });
            const minOrder = orders.length ? Math.min(...orders) : 0;
            listOrders[day] = minOrder - 1;
          } else {
            const maxOrder =
              existingInDay.length > 0
                ? Math.max(
                    ...existingInDay.map(
                      (c) => c.listOrders?.[day] ?? c.listOrder ?? 0,
                    ),
                  )
                : -1;
            listOrders[day] = maxOrder + 1;
          }
        });
        listOrder = listOrders[visitDays[0]] ?? 0;
      }

      await db.collection('clients').add({
        ...scope,
        userId,
        name: data.name,
        address: data.address,
        phone: data.phone,
        notes: data.notes,
        lat: '',
        lng: '',
        mapsLink: data.mapsLink || '',
        freq: isOnDemand ? 'on_demand' : data.freq,
        visitDay,
        visitDays,
        specificDate,
        products: cleanProducts,
        listOrder,
        listOrders,
        isCompleted: false,
        isStarred: false,
        isPinned: false,
        isNote: false,
        alarm: '',
        startWeek: currentWeek,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      reportError(e, 'Error in aiCreateClient');
    }
  }, [groupId, userId]);

  // Get day clients from a specific source (para leer del ref sincrónico)
  const getDayClientsFromSource = useCallback((day: string, source: Client[]): Client[] => {
    if (!day) return [];
    return source
      .filter((c) => {
        if (c.freq === 'on_demand') return false;
        if (c.isCompleted) return false;
        return (c.visitDays && c.visitDays.includes(day)) || c.visitDay === day;
      })
      .sort((a, b) => {
        const hasOrderA = a.listOrders && typeof a.listOrders[day] === 'number';
        const hasOrderB = b.listOrders && typeof b.listOrders[day] === 'number';
        let orderA: number, orderB: number;
        if (hasOrderA) {
          orderA = a.listOrders![day];
        } else {
          orderA = (a.listOrder ?? 0) > 1000000 ? 999999 + ((a.listOrder ?? 0) / 1e15) : (a.listOrder || 999999);
        }
        if (hasOrderB) {
          orderB = b.listOrders![day];
        } else {
          orderB = (b.listOrder ?? 0) > 1000000 ? 999999 + ((b.listOrder ?? 0) / 1e15) : (b.listOrder || 999999);
        }
        return orderA - orderB;
      });
  }, []);

  // Reorder client: sequential integer positions with displacement (matches webapp)
  // Supports manual position (targetPosition) for UI input
  // Read the stored order for a client on a given day, falling back to the
  // legacy single `listOrder` field. Returns Infinity for clients with no
  // stored order so they sort to the bottom.
  const readOrder = (c: Client, day: string): number => {
    const o = c.listOrders && typeof c.listOrders[day] === 'number'
      ? c.listOrders[day]
      : (typeof c.listOrder === 'number' ? c.listOrder : undefined);
    return typeof o === 'number' ? o : Infinity;
  };

  // Minimum gap between two adjacent fractional orders before we trigger a
  // full rebalance for the day. With doubles this gap is reachable after
  // ~50 consecutive midpoint inserts in the same spot, but in practice
  // users don't insert in the same spot that often, so rebalances are rare.
  const FRACTIONAL_MIN_GAP = 1e-9;

  const changePosition = useCallback(async (clientId: string, newPos: number, day: string) => {
    // Read from the synchronous ref so we always see the latest positions.
    const allClients = [...getDayClientsFromSource(day, clientsRef.current)];
    const currentIndex = allClients.findIndex((c) => c.id === clientId);
    if (currentIndex === -1) return;

    // Move the client in the local array to compute neighbors at the target.
    const [movedClient] = allClients.splice(currentIndex, 1);
    const insertIndex = Math.max(0, Math.min(newPos - 1, allClients.length));
    allClients.splice(insertIndex, 0, movedClient);

    const newIndex = allClients.indexOf(movedClient);
    if (newIndex === currentIndex) return;

    const prevNeighbor = newIndex > 0 ? allClients[newIndex - 1] : null;
    const nextNeighbor = newIndex < allClients.length - 1 ? allClients[newIndex + 1] : null;

    // Treat non-finite stored orders (Infinity sentinel for "no order") as
    // missing neighbors so we don't end up assigning Infinity ourselves.
    const rawPrev = prevNeighbor ? readOrder(prevNeighbor, day) : null;
    const rawNext = nextNeighbor ? readOrder(nextNeighbor, day) : null;
    const prevOrder = rawPrev !== null && isFinite(rawPrev) ? rawPrev : null;
    const nextOrder = rawNext !== null && isFinite(rawNext) ? rawNext : null;

    // Decide the new fractional order for the moved client. Falls through to
    // a full rebalance only if the gap between neighbors is exhausted.
    let newOrder: number;
    let needsRebalance = false;

    if (prevOrder === null && nextOrder === null) {
      newOrder = 1;
    } else if (prevOrder === null) {
      // Moving to the top: place before the current first.
      newOrder = (nextOrder as number) - 1;
    } else if (nextOrder === null) {
      // Moving to the bottom: place after the current last.
      newOrder = prevOrder + 1;
    } else if (nextOrder - prevOrder <= FRACTIONAL_MIN_GAP) {
      // Gap between neighbors is too small for another midpoint — rebalance.
      needsRebalance = true;
      newOrder = 0; // will be overwritten by the rebalance pass below
    } else {
      newOrder = (prevOrder + nextOrder) / 2;
    }

    // Build the updates list. In the common path, only one write.
    const updates: { id: string; position: number }[] = [];
    if (needsRebalance) {
      // Reassign integer positions to the entire day list. This costs N
      // writes, but only happens after roughly 50+ midpoint inserts at the
      // same position — extremely rare in practice.
      allClients.forEach((c, idx) => {
        const stored = readOrder(c, day);
        const target = idx + 1;
        if (stored !== target) {
          updates.push({ id: c.id, position: target });
        }
      });
    } else {
      updates.push({ id: clientId, position: newOrder });
    }

    if (updates.length === 0) return;

    // Optimistic local update so the UI reflects the new order immediately.
    const updateMap: Record<string, number> = {};
    updates.forEach((u) => { updateMap[u.id] = u.position; });
    const applyUpdate = (list: Client[]): Client[] =>
      list.map((c) => {
        if (updateMap[c.id] !== undefined) {
          return { ...c, listOrders: { ...(c.listOrders || {}), [day]: updateMap[c.id] } } as Client;
        }
        return c;
      });

    const prevClients = clientsRef.current;
    clientsRef.current = applyUpdate(clientsRef.current);
    setClientsCache(applyUpdate);

    try {
      const batch = db.batch();
      updates.forEach(({ id, position }) => {
        batch.update(db.collection('clients').doc(id), {
          [`listOrders.${day}`]: position,
        });
      });
      await batch.commit();
    } catch (e) {
      reportError(e, 'Error changing position');
      clientsRef.current = prevClients;
      setClientsCache(() => prevClients);
    }
  }, [getDayClientsFromSource, setClientsCache]);

  // Find duplicate clients: groups by normalized name + phone, identifies stale copies
  const findDuplicateClients = useCallback((): { staleIds: string[], details: Array<{ name: string, activeId: string, staleId: string }> } => {
    const ACTIVE_FREQS: Set<string> = new Set(['weekly', 'biweekly', 'triweekly', 'monthly']);

    // Build groups by composite key: normalized name + normalized phone
    const groups: Record<string, Client[]> = {};
    clients.filter(c => !c.isNote).forEach(c => {
      const normName = (c.name || '').toLowerCase().trim();
      if (!normName) return;
      const normPhone = normalizePhoneForComparison(c.phone);
      // Key requires both name AND phone to match (phone must be non-empty)
      const key = normPhone ? `${normName}::${normPhone}` : `${normName}::__no_phone_${c.id}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });

    const staleIds: string[] = [];
    const details: Array<{ name: string, activeId: string, staleId: string }> = [];

    Object.values(groups).forEach(group => {
      if (group.length < 2) return;

      // Score each client to determine which one to keep
      // Higher score = more valuable / should be kept
      const scored = group.map(c => {
        let score = 0;
        // Active frequency is most important
        if (ACTIVE_FREQS.has(c.freq)) score += 1000;
        // 'once' with visitDays is somewhat active
        if (c.freq === 'once' && c.visitDays && c.visitDays.length > 0) score += 500;
        // Has products
        const productCount = c.products ? Object.values(c.products).filter(v => v && Number(v) > 0).length : 0;
        score += productCount * 10;
        // Has notes
        if (c.notes && c.notes.trim()) score += 5;
        // Has location
        if ((c.lat && c.lng) || c.mapsLink) score += 5;
        // Has address
        if (c.address && c.address.trim()) score += 3;
        // More recently updated
        if (c.updatedAt) {
          const ts = (c.updatedAt as any).seconds || (c.updatedAt as any).getTime?.() / 1000 || 0;
          score += Math.min(ts / 1e10, 1); // tiny tiebreaker from timestamp
        }
        return { client: c, score };
      });

      // Sort descending by score: best client first
      scored.sort((a, b) => b.score - a.score);

      const keeper = scored[0].client;
      // Everything except the keeper is stale
      for (let i = 1; i < scored.length; i++) {
        staleIds.push(scored[i].client.id);
        details.push({
          name: scored[i].client.name,
          activeId: keeper.id,
          staleId: scored[i].client.id,
        });
      }
    });

    return { staleIds, details };
  }, [clients]);

  // Delete stale duplicate clients in batches
  const cleanupDuplicates = useCallback(async () => {
    const { staleIds } = findDuplicateClients();
    if (staleIds.length === 0) return 0;

    const BATCH_SIZE = 450;
    for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
      const chunk = staleIds.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      chunk.forEach(id => {
        batch.delete(db.collection('clients').doc(id));
      });
      await batch.commit();
    }
    return staleIds.length;
  }, [findDuplicateClients]);

  // Add a family relationship between two clients (bidirectional)
  const addRelationship = useCallback(async (clientId: string, targetId: string, type: string) => {
    try {
      const inverse = RELATIONSHIP_INVERSE[type] || 'otro';
      const batch = db.batch();
      batch.update(db.collection('clients').doc(clientId), {
        [`relationships.${targetId}`]: type,
      });
      batch.update(db.collection('clients').doc(targetId), {
        [`relationships.${clientId}`]: inverse,
      });
      await batch.commit();
    } catch (e) {
      reportError(e, 'Error adding relationship');
    }
  }, []);

  // Remove a family relationship between two clients (bidirectional)
  const removeRelationship = useCallback(async (clientId: string, targetId: string) => {
    try {
      const FieldValue = firestore.FieldValue;
      const batch = db.batch();
      batch.update(db.collection('clients').doc(clientId), {
        [`relationships.${targetId}`]: FieldValue.delete(),
      });
      batch.update(db.collection('clients').doc(targetId), {
        [`relationships.${clientId}`]: FieldValue.delete(),
      });
      await batch.commit();
    } catch (e) {
      reportError(e, 'Error removing relationship');
    }
  }, []);

  // Permanently delete a client from Firestore (cleans up relationship references)
  const deleteClient = useCallback(async (clientId: string) => {
    try {
      await cancelClientAlarm(clientId);
      // Clean up relationship references in other clients
      const client = clientsRef.current.find((c) => c.id === clientId);
      if (client?.relationships && Object.keys(client.relationships).length > 0) {
        const FieldValue = firestore.FieldValue;
        // Only clean up related clients that still exist locally
        const existingRelatedIds = Object.keys(client.relationships).filter(
          (relId) => clientsRef.current.some((c) => c.id === relId),
        );
        const batch = db.batch();
        batch.delete(db.collection('clients').doc(clientId));
        existingRelatedIds.forEach((relatedId) => {
          batch.update(db.collection('clients').doc(relatedId), {
            [`relationships.${clientId}`]: FieldValue.delete(),
          });
        });
        await batch.commit();
      } else {
        await db.collection('clients').doc(clientId).delete();
      }
    } catch (e) {
      reportError(e, 'Error deleting client');
    }
  }, []);

  // Clone a client (duplicate with same data, for additional visits)
  const cloneClient = useCallback(async (client: Client) => {
    try {
      const scope = groupId ? { groupId, userId } : { userId };
      const newData: Record<string, any> = {
        ...scope,
        userId,
        name: client.name,
        phone: client.phone || '',
        address: client.address || '',
        lat: client.lat || '',
        lng: client.lng || '',
        mapsLink: client.mapsLink || '',
        notes: client.notes || '',
        freq: 'on_demand',
        visitDay: 'Sin Asignar',
        visitDays: [],
        specificDate: '',
        products: client.products || {},
        listOrder: 0,
        listOrders: {},
        isCompleted: false,
        isStarred: false,
        isPinned: false,
        isNote: false,
        alarm: '',
        startWeek: getWeekNumber(new Date()),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.collection('clients').add(newData);
    } catch (e) {
      reportError(e, 'Error cloning client');
    }
  }, [groupId, userId]);

  return {
    clients,
    loading,
    getAllDayClients,
    getVisibleClients,
    getCompletedClients,
    getFilteredDirectory,
    directoryCounts,
    markAsDone,
    undoComplete,
    deleteAllCompleted,
    deleteFromDay,
    updateClient,
    scheduleFromDirectory,
    toggleStar,
    saveAlarm,
    addNote,
    addClient,
    aiCreateClient,
    changePosition,
    deleteClient,
    cloneClient,
    findDuplicateClients,
    cleanupDuplicates,
    addRelationship,
    removeRelationship,
  };
};
