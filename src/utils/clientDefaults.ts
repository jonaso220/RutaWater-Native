import { Client } from '../types';

// Applies safe defaults when reading a client document from Firestore.
// Centralized so both the legacy useClients hook and the new TanStack
// Query path read the same shape.
export const withDefaults = (id: string, data: any): Client => ({
  id,
  name: '',
  phone: '',
  address: '',
  addresses: [],
  notes: '',
  lat: '',
  lng: '',
  mapsLink: '',
  freq: 'on_demand',
  visitDay: 'Sin Asignar',
  visitDays: [],
  specificDate: '',
  products: {},
  listOrder: 0,
  listOrders: {},
  isCompleted: false,
  isStarred: false,
  isPinned: false,
  isNote: false,
  alarm: '',
  lastVisited: null,
  lastDeliveredAt: null,
  previousDeliveredAt: null,
  completedAt: null,
  updatedAt: null,
  userId: '',
  isInactive: false,
  ...data,
  customerId: data.customerId || id,
});
