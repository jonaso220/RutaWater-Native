// Límites mensuales de parseos de IA por plan de suscripción.
// El contador se resetea el día 1 de cada mes.
export const AI_PARSE_LIMITS: Record<'free' | 'monthly' | 'annual', number> = {
  free: 10,
  monthly: 300,
  annual: 500,
};

export const getAiLimit = (plan: 'free' | 'monthly' | 'annual'): number => {
  return AI_PARSE_LIMITS[plan] ?? AI_PARSE_LIMITS.free;
};

// "YYYY-MM" del mes actual (en hora local del dispositivo).
export const getCurrentPeriod = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};
