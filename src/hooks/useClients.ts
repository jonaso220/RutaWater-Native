import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { Client } from '../types';
import { normalizeText, getNextVisitDate, getWeekNumber } from '../utils/helpers';
import { ALL_DAYS, Frequency } from '../constants/products';

interface UseClientsProps {
  userId: string;
  groupId?: string;
}

export const useClients = ({ userId, groupId }: UseClientsProps) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

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
          const loadedClients: Client[] = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Client[];
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

  // Get visible (non-completed) clients for a specific day
  const getVisibleClients = (day: string): Client[] => {
    if (!day) return [];
    return clients
      .filter((c) => {
        if (c.freq === 'on_demand') return false;
        if (c.isCompleted) return false;

        const matchesDay =
          (c.visitDays && c.visitDays.includes(day)) || c.visitDay === day;
        if (!matchesDay) return false;

        // Frequency-based filtering
        if (c.freq !== 'once' && c.freq !== 'weekly') {
          const nextVisit = getNextVisitDate(c, day);
          if (!nextVisit) return false;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const visitDate = new Date(nextVisit);
          visitDate.setHours(0, 0, 0, 0);

          const dayIndex = ALL_DAYS.indexOf(day);
          const todayDayIndex = today.getDay() - 1; // 0=Mon in ALL_DAYS
          const isFutureDay = dayIndex > todayDayIndex;

          if (!isFutureDay && visitDate.getTime() > today.getTime()) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const orderA = a.listOrders?.[day] ?? a.listOrder ?? 0;
        const orderB = b.listOrders?.[day] ?? b.listOrder ?? 0;
        const cleanA = orderA > 100000 ? 0 : orderA;
        const cleanB = orderB > 100000 ? 0 : orderB;
        return cleanA - cleanB;
      });
  };

  // Get completed clients for a specific day (only 'once' freq)
  const getCompletedClients = (day: string): Client[] => {
    return clients.filter((c) => {
      if (!c.isCompleted) return false;
      return (c.visitDays && c.visitDays.includes(day)) || c.visitDay === day;
    });
  };

  // Get directory (all clients, searchable)
  const getFilteredDirectory = (searchTerm: string): Client[] => {
    return clients
      .filter((c) => {
        if (!searchTerm.trim()) return true;
        const term = normalizeText(searchTerm);
        const name = normalizeText(c.name || '');
        const address = normalizeText(c.address || '');
        const phone = (c.phone || '').toLowerCase();
        return name.includes(term) || address.includes(term) || phone.includes(term);
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  };

  // --- MUTATION FUNCTIONS ---

  // Mark a client as done for the day
  const markAsDone = async (clientId: string, client: Client) => {
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

        if (client.isStarred) {
          updates.isStarred = false;
        }

        await db.collection('clients').doc(clientId).update(updates);
      }
    } catch (e) {
      console.error('Error marking as done:', e);
    }
  };

  // Undo a completed client (only for 'once' freq)
  const undoComplete = async (clientId: string) => {
    try {
      await db.collection('clients').doc(clientId).update({
        isCompleted: false,
        completedAt: null,
        updatedAt: new Date(),
      });
    } catch (e) {
      console.error('Error undoing complete:', e);
    }
  };

  // Remove a client from the day's route (move to directory)
  const deleteFromDay = async (clientId: string) => {
    try {
      await db.collection('clients').doc(clientId).update({
        freq: 'on_demand',
        visitDay: 'Sin Asignar',
        visitDays: [],
      });
    } catch (e) {
      console.error('Error deleting from day:', e);
    }
  };

  // Generic update for client fields
  const updateClient = async (clientId: string, data: Partial<Client>) => {
    try {
      await db.collection('clients').doc(clientId).update(data);
    } catch (e) {
      console.error('Error updating client:', e);
    }
  };

  // Schedule a client from the directory to a specific day/frequency
  const scheduleFromDirectory = async (
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
  };

  // Toggle star on a client (optimistic update)
  const toggleStar = async (clientId: string, currentValue: boolean) => {
    const newVal = !currentValue;
    try {
      await db.collection('clients').doc(clientId).update({ isStarred: newVal });
    } catch (e) {
      console.error('Error toggling star:', e);
    }
  };

  // Save alarm time for a client
  const saveAlarm = async (clientId: string, time: string) => {
    try {
      await db.collection('clients').doc(clientId).update({ alarm: time });
    } catch (e) {
      console.error('Error saving alarm:', e);
    }
  };

  // Add a note (special client with isNote: true)
  const addNote = async (notesText: string, date: string) => {
    try {
      const d = new Date(date + 'T12:00:00');
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const dayName = dayNames[d.getDay()];
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
  };

  // Change client position in the day's list
  const changePosition = async (clientId: string, newPos: number, day: string) => {
    const pos = Math.max(1, newPos);
    const dayClients = [...getVisibleClients(day)];
    const currentIndex = dayClients.findIndex((c) => c.id === clientId);
    if (currentIndex === -1) return;

    const [movedClient] = dayClients.splice(currentIndex, 1);
    const targetIndex = Math.min(Math.max(0, pos - 1), dayClients.length);
    dayClients.splice(targetIndex, 0, movedClient);

    const batch = db.batch();
    dayClients.forEach((client, index) => {
      const ref = db.collection('clients').doc(client.id);
      batch.update(ref, {
        [`listOrders.${day}`]: index,
        listOrder: index,
      });
    });

    try {
      await batch.commit();
    } catch (e) {
      console.error('Error changing position:', e);
    }
  };

  return {
    clients,
    loading,
    getVisibleClients,
    getCompletedClients,
    getFilteredDirectory,
    markAsDone,
    undoComplete,
    deleteFromDay,
    updateClient,
    scheduleFromDirectory,
    toggleStar,
    saveAlarm,
    addNote,
    changePosition,
  };
};
