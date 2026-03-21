import i18n from '../i18n';

// Productos - mismos IDs que la web app para compatibilidad con Firestore
export interface Product {
  id: string;
  label: string;
  icon: string;
  emoji: string;
  short: string;
}

export const PRODUCTS: Product[] = [
  { id: 'b20', label: 'Bidón 20L', icon: 'water', emoji: '💧', short: '20L' },
  { id: 'b12', label: 'Bidón 12L', icon: 'water', emoji: '💧', short: '12L' },
  { id: 'b6', label: 'Bidón 6L', icon: 'water', emoji: '💧', short: '6L' },
  { id: 'soda', label: 'Sifón Soda', icon: 'wine', emoji: '🥤', short: 'Soda' },
  { id: 'bombita', label: 'Bombita', icon: 'hand-left', emoji: '🧴', short: 'Bomb' },
  { id: 'disp_elec_new', label: 'Disp. Elec Nuevo', icon: 'flash', emoji: '🔌', short: 'ElecN' },
  { id: 'disp_elec_chg', label: 'Disp. Elec Cambio', icon: 'flash', emoji: '🔌', short: 'ElecC' },
  { id: 'disp_nat', label: 'Disp. Natural', icon: 'leaf', emoji: '🌿', short: 'Nat' },
];

// Translated product helpers
export const getProductLabel = (id: string): string => {
  return i18n.t(`products.${id}`, { defaultValue: id });
};

export const getProductShort = (id: string): string => {
  return i18n.t(`productShort.${id}`, { defaultValue: id });
};

export const getTranslatedDays = (): string[] => {
  return i18n.t('allDays', { returnObjects: true }) as string[];
};

export const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export type Frequency = 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'once' | 'on_demand';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  triweekly: 'Cada 3 sem',
  monthly: 'Mensual',
  once: 'Una vez',
  on_demand: 'Solo Directorio',
};

export const getFreqLabel = (freq: string): string => {
  return i18n.t(`freq.${freq}`, { defaultValue: freq });
};
