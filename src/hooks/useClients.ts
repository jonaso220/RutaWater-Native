import { useState, useEffect, useMemo } from 'react';
import { db } from '../config/firebase';
import { Client } from '../types';
import { normalizeText, getNextVisitDate } from '../utils/helpers';
import { ALL_DAYS } from '../constants/products';

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
          // No ordenar aquí - getVisibleClients ordena por listOrders[day]
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

  // Get completed clients for a specific day
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

  return {
    clients,
    loading,
    getVisibleClients,
    getCompletedClients,
    getFilteredDirectory,
  };
};
