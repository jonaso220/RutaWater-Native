import { create } from 'zustand';
import { Client, Transfer } from '../types';

interface TransfersStore {
  transfers: Transfer[];
  getClientTransfers: (clientId: string) => Transfer[];
  hasPendingTransfer: (clientId: string) => boolean;
  addTransfer: (client: Client) => Promise<boolean | undefined>;
  markTransferReviewed: (transfer: Transfer) => Promise<void>;
}

const noop = async () => {};

export const useTransfersStore = create<TransfersStore>()(() => ({
  transfers: [],
  getClientTransfers: () => [],
  hasPendingTransfer: () => false,
  addTransfer: noop as any,
  markTransferReviewed: noop,
}));
