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
  doneFor?: string; // yyyy-mm-dd de la ocurrencia agendada que completó el último "Listo".
                    // Permite reagendar exacto aunque la entrega sea días antes/después
                    // del día de visita (ver getNextVisitDate). Vacío/ausente = usar heurística.
  completedAt: FirebaseFirestoreTypes.Timestamp | null;
  updatedAt: FirebaseFirestoreTypes.Timestamp | null;
  startWeek: number;
  userId: string;
  groupId?: string;
  relationships?: Record<string, string>; // clientId → relationship type
  isInactive?: boolean; // "ya no es cliente": se mantiene en el directorio pero
                        // fuera de los filtros de trabajo (solo en Todos / Inactivos / Deuda)
  // Computed at runtime
  hasDebt?: boolean;
  hasPendingTransfer?: boolean;
}

// Relationship types for client family links
export const RELATIONSHIP_TYPES = [
  'conyuge',
  'padre_madre',
  'hijo_a',
  'hermano_a',
  'suegro_a',
  'yerno_nuera',
  'abuelo_a',
  'nieto_a',
  'tio_a',
  'sobrino_a',
  'primo_a',
  'cunado_a',
  'otro',
] as const;

export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

// Inverse relationship mapping (gender-neutral)
export const RELATIONSHIP_INVERSE: Record<string, string> = {
  conyuge: 'conyuge',
  padre_madre: 'hijo_a',
  hijo_a: 'padre_madre',
  hermano_a: 'hermano_a',
  suegro_a: 'yerno_nuera',
  yerno_nuera: 'suegro_a',
  abuelo_a: 'nieto_a',
  nieto_a: 'abuelo_a',
  tio_a: 'sobrino_a',
  sobrino_a: 'tio_a',
  primo_a: 'primo_a',
  cunado_a: 'cunado_a',
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
