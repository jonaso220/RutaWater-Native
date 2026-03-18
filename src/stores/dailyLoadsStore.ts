import { create } from 'zustand';
import { DailyLoad } from '../hooks/useDailyLoads';

interface DailyLoadsStore {
  dailyLoad: DailyLoad;
  loadForDay: (day: string) => Promise<void>;
  saveDailyLoad: (day: string, data: DailyLoad) => Promise<void>;
}

const noop = async () => {};

export const useDailyLoadsStore = create<DailyLoadsStore>()(() => ({
  dailyLoad: { b20: '', b12: '', b6: '', soda: '', b20_extra: '', b12_extra: '', b6_extra: '', soda_extra: '', pedidos_note: '' },
  loadForDay: noop,
  saveDailyLoad: noop,
}));
