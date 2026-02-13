import { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

// Client document in Firestore 'clients' collection
export interface Client {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  lat: string;
  lng: string;
  mapsLink: string;
  freq: 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'once' | 'on_demand';
  visitDay: string;
  visitDays: string[];
  specificDate: string;
  products: Record<string, string | number>;
  listOrder: number;
  listOrders: Record<string, number>;
  isCompleted: boolean;
  isStarred: boolean;
  isPinned: boolean;
  isNote: boolean;
  alarm: string;
  lastVisited: FirebaseFirestoreTypes.Timestamp | null;
  completedAt: FirebaseFirestoreTypes.Timestamp | null;
  updatedAt: FirebaseFirestoreTypes.Timestamp | null;
  startWeek: number;
  userId: string;
  groupId?: string;
  // Computed at runtime
  hasDebt?: boolean;
  hasPendingTransfer?: boolean;
}

// Debt document in Firestore 'debts' collection
export interface Debt {
  id: string;
  clientId: string;
  clientName: string;
  amount: number;
  createdAt: FirebaseFirestoreTypes.Timestamp | null;
  userId: string;
  groupId?: string;
}

// Transfer document in Firestore 'transfers' collection
export interface Transfer {
  id: string;
  clientId: string;
  clientName: string;
  amount: number;
  status: 'pending' | 'reviewed';
  createdAt: FirebaseFirestoreTypes.Timestamp | null;
  userId: string;
  groupId?: string;
}

// Group document in Firestore 'groups' collection
export interface Group {
  groupId: string;
  role: 'admin' | 'member';
  code: string;
}

// User data
export interface UserData {
  uid: string;
  email: string | null;
  displayName: string | null;
}
