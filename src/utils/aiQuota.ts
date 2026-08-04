export interface AiQuotaSnapshot {
  count: number;
  limit: number;
  period: string;
  plan?: 'free' | 'monthly' | 'annual';
}

export const isAiQuotaSnapshot = (value: unknown): value is AiQuotaSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const quota = value as Partial<AiQuotaSnapshot>;
  return Number.isSafeInteger(quota.count)
    && (quota.count as number) >= 0
    && Number.isSafeInteger(quota.limit)
    && (quota.limit as number) > 0
    && typeof quota.period === 'string'
    && /^\d{4}-\d{2}$/.test(quota.period);
};

export const quotaFromResponseBody = (body: unknown): AiQuotaSnapshot | null => {
  if (!body || typeof body !== 'object' || !('quota' in body)) return null;
  const quota = (body as { quota?: unknown }).quota;
  return isAiQuotaSnapshot(quota) ? quota : null;
};

export const isAiLimitResponse = (status: number, body: unknown): boolean =>
  status === 429
  && !!body
  && typeof body === 'object'
  && (body as { code?: unknown }).code === 'AI_LIMIT_REACHED';
