import { create } from 'zustand';

export interface AiUsageState {
  count: number;
  period: string; // "YYYY-MM"
  limit: number;
  loading: boolean;
}

export const useAiUsageStore = create<AiUsageState>()(() => ({
  count: 0,
  period: '',
  limit: 0,
  loading: true,
}));
