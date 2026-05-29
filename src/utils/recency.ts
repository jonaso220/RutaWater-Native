import { Client } from '../types';

export const getLastActivityDate = (client: Client): Date | null => {
  const toDate = (val: any): Date | null => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate();
    if (val instanceof Date) return val;
    return null;
  };
  return toDate(client.completedAt) || toDate(client.lastVisited) || toDate(client.updatedAt);
};

export const getDaysSince = (date: Date | null): number | null => {
  if (!date) return null;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};
