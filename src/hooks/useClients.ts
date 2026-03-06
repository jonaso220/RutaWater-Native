import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { db } from '../config/firebase';
import { Client } from '../types';
import { normalizeText, fuzzyMatch, getNextVisitDate, getWeekNumber } from '../utils/helpers';
import { ALL_DAYS, Frequency } from '../constants/products';

const withDefaults = (id: string, data: any): Client => ({
  id,
  name: '',
  phone: '',
  address: '',
  notes: '',
  lat: '',
  lng: '',
  mapsLink: '',
  freq: 'on_demand',
  visitDay: 'Sin Asignar',
  visitDays: [],
  specificDate: '',
  products: {},
  listOrder: 0,
  listOrders: {},
  isCompleted: false,
  isStarred: false,
  isPinned: false,
  isNote: false,
  alarm: '',
  lastVisited: null,
  completedAt: null,
  updatedAt: null,
  startWeek: 0,
  userId: '',
  ...data,
});

interface UseClientsProps {
  userId: string;
  groupId?: string;
}

export const useClients = ({ userId, groupId }: UseClientsProps) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  // Ref sincrónico: siempre tiene los datos más recientes de clients
  // Evita race condition cuando se asignan posiciones rápidamente
  const clientsRef = useRef<Client[]>(clients);
  clientsRef.current = clients;
  // Guard against double-tap on markAsDone
  const markingDoneRef = useRef<Set<string>>(new Set());

  // Real-time listener on clients collection
  useEffect(() => {
    if (!userId) return;

    const scopeField = groupId ? 'groupId' : 'userId';
    const scopeValue = groupId || userId;

    const unsubscribe = db
      .collection('clients')
      .where(scopeField, '==', scopeValue)
      .onSnapshot(
        (snapshot) => {
          const loadedClients: Client[] = snapshot.docs.map((doc) => withDefaults(doc.id, doc.data()));
          setClients(loadedClients);
          setLoading(false);
        },
        (error) => {
          console.error('Error loading clients:', error);
          setLoading(false);
        },
      );

    return () => unsubscribe();
  }, [userId, groupId]);

  // Get ALL clients assigned to a day (including not-due), sorted by position
  // Normalization matches webapp: listOrders[day] is preferred, timestamps pushed to end
  const getAllDayClients = useCallback((day: string): Client[] => {
    if (!day) return [];
    return clients
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
  }, [clients]);

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
    return clients
      .filter((c) => !c.isNote)
      .filter((c) => {
        if (filter === 'all') return true;
        if (filter === 'no_location') return !((c.lat && c.lng) || c.mapsLink);
        return c.freq === filter;
      })
      .filter((c) => matcher(c.name || '', c.address || '', c.phone || ''))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clients]);

  // Directory category counts (excluding notes)
  const directoryCounts = useMemo(() => {
    const all = clients.filter((c) => !c.isNote);
    const counts: Record<string, number> = {
      total: all.length, weekly: 0, biweekly: 0, triweekly: 0,
      monthly: 0, once: 0, on_demand: 0, no_location: 0,
    };
    all.forEach((c) => {
      if (c.freq && counts[c.freq] !== undefined) counts[c.freq]++;
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
      if (client.freq === 'once') {
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
          let interval = 1;
          if (client.freq === 'biweekly') interval = 2;
          if (client.freq === 'triweekly') interval = 3;
          if (client.freq === 'monthly') interval = 4;
          const currentSpecificDate = new Date(client.specificDate + 'T12:00:00');
          if (isNaN(currentSpecificDate.getTime())) {
            updates.specificDate = '';
          } else {
            const nextSpecificDate = new Date(currentSpecificDate);
            nextSpecificDate.setDate(nextSpecificDate.getDate() + interval * 7);
            const tomorrow = new Date();
            tomorrow.setHours(0, 0, 0, 0);
            tomorrow.setDate(tomorrow.getDate() + 1);
            while (nextSpecificDate < tomorrow) {
              nextSpecificDate.setDate(nextSpecificDate.getDate() + interval * 7);
            }
            updates.specificDate = nextSpecificDate.toISOString().split('T')[0];
          }
        }

        if (client.isStarred) {
          updates.isStarred = false;
        }

        await db.collection('clients').doc(clientId).update(updates);
      }
    } catch (e) {
      console.error('Error marking as done:', e);
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
      console.error('Error undoing complete:', e);
    }
  }, []);

  // Delete all completed clients for a day
  const deleteAllCompleted = useCallback(async (day: string) => {
    try {
      const completed = getCompletedClients(day);
      if (completed.length === 0) return;
      const batch = db.batch();
      completed.forEach((c) => {
        batch.delete(db.collection('clients').doc(c.id));
      });
      await batch.commit();
    } catch (e) {
      console.error('Error deleting completed:', e);
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
        });
      }
    } catch (e) {
      console.error('Error deleting from day:', e);
    }
  }, []);

  // Generic update for client fields
  const updateClient = useCallback(async (clientId: string, data: Partial<Client>) => {
    try {
      await db.collection('clients').doc(clientId).update(data);
    } catch (e) {
      console.error('Error updating client:', e);
    }
  }, []);

  // Schedule a client from the directory to a specific day/frequency
  const scheduleFromDirectory = useCallback(async (
    clientData: Client,
    newDays: string[],
    newFreq: Frequency,
    newDate: string,
    newNotes: string,
    newProducts: Record<string, number>,
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
        products: newProducts || {},
      };

      if (newDate) {
        // One-time order - place at the beginning
        const d = new Date(newDate + 'T12:00:00');
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const dayName = dayNames[d.getDay()];

        if (dayName === 'Domingo') {
          console.warn('scheduleFromDirectory: Cannot schedule on Sunday');
          return;
        }

        const existingInDay = clients.filter(
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
          const existingInDay = clients.filter(
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

      if (clientData.freq === 'on_demand' || clientData.visitDay === 'Sin Asignar') {
        // Reactivate existing client
        await db.collection('clients').doc(clientData.id).update(newData);
      } else {
        // Create additional visit
        newData.createdAt = new Date();
        await db.collection('clients').add(newData);
      }
    } catch (e) {
      console.error('Error scheduling client:', e);
    }
  }, [clients, groupId, userId]);

  // Toggle star on a client (optimistic update)
  const toggleStar = useCallback(async (clientId: string, currentValue: boolean) => {
    const newVal = !currentValue;
    try {
      await db.collection('clients').doc(clientId).update({ isStarred: newVal });
    } catch (e) {
      console.error('Error toggling star:', e);
    }
  }, []);

  // Save alarm time for a client
  const saveAlarm = useCallback(async (clientId: string, time: string) => {
    try {
      await db.collection('clients').doc(clientId).update({ alarm: time });
    } catch (e) {
      console.error('Error saving alarm:', e);
    }
  }, []);

  // Add a note (special client with isNote: true)
  const addNote = useCallback(async (notesText: string, date: string) => {
    try {
      const d = new Date(date + 'T12:00:00');
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const dayName = dayNames[d.getDay()];

      if (dayName === 'Domingo') {
        console.warn('addNote: Cannot schedule on Sunday');
        return;
      }

      const currentWeek = getWeekNumber(new Date());
      const scope = groupId ? { groupId, userId } : { userId };

      // Place at beginning of day
      const existingInDay = clients.filter(
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
      console.error('Error adding note:', e);
    }
  }, [clients, groupId, userId]);

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
        const existingInDay = clients.filter(
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
      console.error('Error adding client:', e);
    }
  }, [clients, groupId, userId]);

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
  const changePosition = useCallback(async (clientId: string, newPos: number, day: string) => {
    // Leer del ref sincrónico para tener siempre las posiciones más recientes
    const allClients = [...getDayClientsFromSource(day, clientsRef.current)];
    const currentIndex = allClients.findIndex((c) => c.id === clientId);
    if (currentIndex === -1) return;

    // Remover la tarjeta de su posición actual
    const [movedClient] = allClients.splice(currentIndex, 1);

    // Asignación manual de posición (1-indexed desde el usuario)
    const insertIndex = Math.max(0, Math.min(newPos - 1, allClients.length));
    allClients.splice(insertIndex, 0, movedClient);

    // Si la tarjeta quedó en la misma posición, no hacer nada
    const newIndex = allClients.indexOf(movedClient);
    if (newIndex === currentIndex) return;

    // Asignar posiciones enteras secuenciales a TODOS los clientes.
    // Solo escribir actualizaciones para los que cambiaron.
    const updates: { id: string; position: number }[] = [];
    allClients.forEach((client, newPosIdx) => {
      const storedPos = client.listOrders && typeof client.listOrders[day] === 'number'
        ? client.listOrders[day]
        : undefined;
      if (storedPos !== newPosIdx) {
        updates.push({ id: client.id, position: newPosIdx });
      }
    });

    if (updates.length === 0) return;

    // Optimista: actualizar ref SINCRÓNICAMENTE + estado React
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
    setClients((prev) => applyUpdate(prev));

    try {
      const batch = db.batch();
      updates.forEach(({ id, position }) => {
        batch.update(db.collection('clients').doc(id), {
          [`listOrders.${day}`]: position,
        });
      });
      await batch.commit();
    } catch (e) {
      console.error('Error changing position:', e);
      clientsRef.current = prevClients;
      setClients(prevClients);
    }
  }, [getDayClientsFromSource]);

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
      console.error('Error cloning client:', e);
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
    changePosition,
    cloneClient,
  };
};
