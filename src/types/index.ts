import { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

export type ClientAddressType = 'home' | 'work' | 'other';

export interface ClientAddress {
  id: string;
  type: ClientAddressType;
  address: string;
  mapsLink: string;
  lat?: string;
  lng?: string;
}

// Client document in Firestore 'clients' collection
export interface Client {
  id: string;
  // Identidad estable del cliente humano. Los pedidos extra conservan un id
  // de documento propio, pero comparten customerId con la ficha original.
  customerId?: string;
  name: string;
  phone: string;
  address: string;
  // Ubicaciones guardadas en la ficha. `address/mapsLink/lat/lng` continúan
  // siendo la ubicación efectiva de la visita para compatibilidad con rutas,
  // alarmas, exportaciones y documentos anteriores a esta lista.
  addresses?: ClientAddress[];
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
  // Día canónico elegido para la alarma (importante en clientes con varios días).
  // Opcional para documentos anteriores; en ese caso se deriva de visitDays/visitDay.
  alarmDay?: string;
  lastVisited: FirebaseFirestoreTypes.Timestamp | null;
  // Fecha canónica de la última entrega REAL. A diferencia de lastVisited,
  // nunca se usa como estado interno para calcular/reiniciar la agenda.
  // Opcional para compatibilidad con documentos creados antes de este campo.
  lastDeliveredAt?: FirebaseFirestoreTypes.Timestamp | null;
  // Snapshot temporal usado para que deshacer un pedido "once" restaure la
  // entrega anterior incluso después de cerrar el banner rápido de deshacer.
  previousDeliveredAt?: FirebaseFirestoreTypes.Timestamp | null;
  doneFor?: string; // yyyy-mm-dd de la ocurrencia agendada que completó el último "Listo".
                    // Permite reagendar exacto aunque la entrega sea días antes/después
                    // del día de visita (ver getNextVisitDate). Vacío/ausente = usar heurística.
  completedAt: FirebaseFirestoreTypes.Timestamp | null;
  updatedAt: FirebaseFirestoreTypes.Timestamp | null;
  userId: string;
  groupId?: string;
  // Canonical authorization/query scope. Optional only for legacy documents
  // while the additive backfill is rolled out.
  scopeKey?: string;
  relationships?: Record<string, string>; // clientId → relationship type
  // clientId → whether both clients belong to the same household. Missing
  // entries are treated as true for backwards compatibility with links made
  // before this distinction existed; every newly edited link writes a value.
  sameHousehold?: Record<string, boolean>;
  backupSourceId?: string; // id original del JSON; evita duplicar al restaurar el mismo respaldo
  isInactive?: boolean; // "ya no es cliente": se mantiene en el directorio pero
                        // fuera de los filtros de trabajo (solo en Todos / Inactivos / Deuda)
  // LEGACY (webapp retirada): ya no se escriben ni se leen; pueden seguir
  // existiendo en documentos viejos. El estado real se deriva en vivo de las
  // colecciones (getClientDebtTotal / hasPendingTransfer de los stores).
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
  scopeKey?: string;
  backupSourceId?: string;
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
  createdAt: FirebaseFirestoreTypes.Timestamp | null;
  userId: string;
  groupId?: string;
  scopeKey?: string;
  backupSourceId?: string;
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
