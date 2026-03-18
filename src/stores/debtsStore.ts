import { create } from 'zustand';
import { Client, Debt } from '../types';

interface DebtsStore {
  debts: Debt[];
  getClientDebts: (clientId: string) => Debt[];
  getClientDebtTotal: (clientId: string) => number;
  addDebt: (client: Client, amount: number) => Promise<void>;
  markDebtPaid: (debt: Debt) => Promise<void>;
  editDebt: (debtId: string, newAmount: number) => Promise<void>;
  markAllDebtsPaid: (clientId: string, debtIds: string[]) => Promise<void>;
}

const noop = async () => {};

export const useDebtsStore = create<DebtsStore>()(() => ({
  debts: [],
  getClientDebts: () => [],
  getClientDebtTotal: () => 0,
  addDebt: noop as any,
  markDebtPaid: noop,
  editDebt: noop,
  markAllDebtsPaid: noop,
}));
