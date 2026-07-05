import i18n from '../i18n';
import { getDayIndex } from '../utils/helpers';

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

// Los datos (Firestore, visitDay/visitDays) guardan siempre el valor canónico
// en español; getDayLabel es solo para display.
export const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const getDayLabel = (day: string): string => {
  const idx = getDayIndex(day);
  if (idx === -1) return day;
  const dayNames = i18n.t('dayNames', { returnObjects: true }) as string[];
  return dayNames?.[idx] || day;
};

export type Frequency = 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'once' | 'on_demand';

// Orden de los chips en los selectores de frecuencia.
export const FREQUENCIES: Frequency[] = ['weekly', 'biweekly', 'triweekly', 'monthly', 'once', 'on_demand'];

// Etiquetas fijas en español: solo para el export CSV (compatibilidad con la
// webapp). Para UI usar getFreqLabel, que traduce vía i18n.
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
