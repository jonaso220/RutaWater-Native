import React, { createContext, useContext } from 'react';
import { useDailyLoads, DailyLoad } from '../hooks/useDailyLoads';
import { useAuthContext } from './AuthContext';

interface DailyLoadsContextType {
  dailyLoad: DailyLoad;
  loadForDay: (day: string) => Promise<void>;
  saveDailyLoad: (day: string, data: DailyLoad) => Promise<void>;
}

const DailyLoadsContext = createContext<DailyLoadsContextType | null>(null);

export const DailyLoadsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuthContext();

  const hook = useDailyLoads({
    userId: user?.uid || '',
  });

  return (
    <DailyLoadsContext.Provider value={hook}>
      {children}
    </DailyLoadsContext.Provider>
  );
};

export const useDailyLoadsContext = (): DailyLoadsContextType => {
  const ctx = useContext(DailyLoadsContext);
  if (!ctx) throw new Error('useDailyLoadsContext must be used within DailyLoadsProvider');
  return ctx;
};
