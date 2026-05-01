import { create } from 'zustand';

export interface AiUsageState {
  count: number;
  period: string; // "YYYY-MM"
  limit: number;
  loading: boolean;
  // Devuelve true si pudo consumir un parseo, false si llegó al límite.
  tryConsume: () => Promise<boolean>;
}

const noop = async () => false;

export const useAiUsageStore = create<AiUsageState>()(() => ({
  count: 0,
  period: '',
  limit: 0,
  loading: true,
  tryConsume: noop,
}));
