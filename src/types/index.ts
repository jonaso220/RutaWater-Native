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
  relationships?: Record<string, string>; // clientId → relationship type
  // Computed at runtime
  hasDebt?: boolean;
  hasPendingTransfer?: boolean;
}

// Relationship types for client family links
export const RELATIONSHIP_TYPES = [
  'esposo', 'esposa',
  'padre', 'madre',
  'hijo', 'hija',
  'hermano', 'hermana',
  'suegro', 'suegra',
  'yerno', 'nuera',
  'abuelo', 'abuela',
  'nieto', 'nieta',
  'tio', 'tia',
  'sobrino', 'sobrina',
  'primo', 'prima',
  'cunado', 'cunada',
  'otro',
] as const;

export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

// Inverse uses generic form when gender of the other person is unknown
export const RELATIONSHIP_INVERSE: Record<string, string> = {
  esposo: 'esposa',
  esposa: 'esposo',
  padre: 'hijo',
  madre: 'hijo',
  hijo: 'padre',
  hija: 'madre',
  hermano: 'hermano',
  hermana: 'hermana',
  suegro: 'yerno',
  suegra: 'nuera',
  yerno: 'suegro',
  nuera: 'suegra',
  abuelo: 'nieto',
  abuela: 'nieta',
  nieto: 'abuelo',
  nieta: 'abuela',
  tio: 'sobrino',
  tia: 'sobrina',
  sobrino: 'tio',
  sobrina: 'tia',
  primo: 'primo',
  prima: 'prima',
  cunado: 'cunado',
  cunada: 'cunada',
  otro: 'otro',
};

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
  clientAddress?: string;
  clientLat?: string | null;
  clientLng?: string | null;
  clientMapsLink?: string | null;
  reviewed: boolean;
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
