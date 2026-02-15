import { useState, useEffect, useCallback } from 'react';
import { db } from '../config/firebase';

export interface DailyLoad {
  b20: string;
  b12: string;
  b6: string;
  soda: string;
  b20_extra: string;
  b12_extra: string;
  b6_extra: string;
  soda_extra: string;
  pedidos_note: string;
}

const EMPTY_LOAD: DailyLoad = {
  b20: '',
  b12: '',
  b6: '',
  soda: '',
  b20_extra: '',
  b12_extra: '',
  b6_extra: '',
  soda_extra: '',
  pedidos_note: '',
};

interface UseDailyLoadsProps {
  userId: string;
}

export const useDailyLoads = ({ userId }: UseDailyLoadsProps) => {
  const [dailyLoad, setDailyLoad] = useState<DailyLoad>(EMPTY_LOAD);
  const [currentDay, setCurrentDay] = useState('');

  const loadForDay = useCallback(
    async (day: string) => {
      if (!userId || !day) return;
      setCurrentDay(day);
      try {
        const docId = `${userId}_${day}`;
        const doc = await db.collection('daily_loads').doc(docId).get();
        if (doc.exists) {
          setDailyLoad(doc.data() as DailyLoad);
        } else {
          setDailyLoad(EMPTY_LOAD);
        }
      } catch (e) {
        console.error('Error loading daily load:', e);
        setDailyLoad(EMPTY_LOAD);
      }
    },
    [userId],
  );

  const saveDailyLoad = async (day: string, data: DailyLoad) => {
    if (!userId || !day) return;
    try {
      const docId = `${userId}_${day}`;
      await db.collection('daily_loads').doc(docId).set(data);
      setDailyLoad(data);
    } catch (e) {
      console.error('Error saving daily load:', e);
    }
  };

  return {
    dailyLoad,
    loadForDay,
    saveDailyLoad,
  };
};
