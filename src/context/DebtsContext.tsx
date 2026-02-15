import React, { createContext, useContext, useMemo } from 'react';
import { useDebts } from '../hooks/useDebts';
import { useAuthContext } from './AuthContext';
import { Client, Debt } from '../types';

interface DebtsContextType {
  debts: Debt[];
  getClientDebts: (clientId: string) => Debt[];
  getClientDebtTotal: (clientId: string) => number;
  addDebt: (client: Client, amount: number) => Promise<void>;
  markDebtPaid: (debt: Debt) => Promise<void>;
  editDebt: (debtId: string, newAmount: number) => Promise<void>;
}

const DebtsContext = createContext<DebtsContextType | null>(null);

export const DebtsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, groupData } = useAuthContext();

  const hook = useDebts({
    userId: user?.uid || '',
    groupId: groupData?.groupId,
  });

  return (
    <DebtsContext.Provider value={hook}>
      {children}
    </DebtsContext.Provider>
  );
};

export const useDebtsContext = (): DebtsContextType => {
  const ctx = useContext(DebtsContext);
  if (!ctx) throw new Error('useDebtsContext must be used within DebtsProvider');
  return ctx;
};
