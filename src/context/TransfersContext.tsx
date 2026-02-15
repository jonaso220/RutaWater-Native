import React, { createContext, useContext } from 'react';
import { useTransfers } from '../hooks/useTransfers';
import { useAuthContext } from './AuthContext';
import { Client, Transfer } from '../types';

interface TransfersContextType {
  transfers: Transfer[];
  getClientTransfers: (clientId: string) => Transfer[];
  hasPendingTransfer: (clientId: string) => boolean;
  addTransfer: (client: Client) => Promise<boolean | undefined>;
  markTransferReviewed: (transfer: Transfer) => Promise<void>;
}

const TransfersContext = createContext<TransfersContextType | null>(null);

export const TransfersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, groupData } = useAuthContext();

  const hook = useTransfers({
    userId: user?.uid || '',
    groupId: groupData?.groupId,
  });

  return (
    <TransfersContext.Provider value={hook}>
      {children}
    </TransfersContext.Provider>
  );
};

export const useTransfersContext = (): TransfersContextType => {
  const ctx = useContext(TransfersContext);
  if (!ctx) throw new Error('useTransfersContext must be used within TransfersProvider');
  return ctx;
};
