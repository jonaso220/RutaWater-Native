// Productos - mismos IDs que la web app para compatibilidad con Firestore
export interface Product {
  id: string;
  label: string;
  icon: string;
  short: string;
}

export const PRODUCTS: Product[] = [
  { id: 'b20', label: '20L', icon: 'water', short: '20L' },
  { id: 'b12', label: '12L', icon: 'water', short: '12L' },
  { id: 'b6', label: '6L', icon: 'water', short: '6L' },
  { id: 'soda', label: 'Soda', icon: 'wine', short: 'Soda' },
  { id: 'bombita', label: 'Bombita', icon: 'hand-left', short: 'Bomb' },
  { id: 'disp_elec_new', label: 'Disp. Elec Nuevo', icon: 'flash', short: 'ElecN' },
  { id: 'disp_elec_chg', label: 'Disp. Elec Cambio', icon: 'flash', short: 'ElecC' },
  { id: 'disp_nat', label: 'Disp. Natural', icon: 'leaf', short: 'Nat' },
];

export const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export type Frequency = 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'once' | 'on_demand';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  triweekly: 'Cada 3 sem',
  monthly: 'Mensual',
  once: 'Una vez',
  on_demand: 'Solo Directorio',
};
