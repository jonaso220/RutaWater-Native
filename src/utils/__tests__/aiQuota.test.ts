import { isAiLimitResponse, isAiQuotaSnapshot, quotaFromResponseBody } from '../aiQuota';

describe('AI quota response contract', () => {
  const quota = { count: 10, limit: 10, period: '2026-08', plan: 'free' as const };

  test('accepts only well-formed server snapshots', () => {
    expect(isAiQuotaSnapshot(quota)).toBe(true);
    expect(isAiQuotaSnapshot({ ...quota, period: '08-2026' })).toBe(false);
    expect(isAiQuotaSnapshot({ ...quota, count: -1 })).toBe(false);
  });

  test('recognizes only the structured 429 contract', () => {
    expect(isAiLimitResponse(429, { code: 'AI_LIMIT_REACHED', quota })).toBe(true);
    expect(isAiLimitResponse(500, { code: 'AI_LIMIT_REACHED', quota })).toBe(false);
    expect(quotaFromResponseBody({ quota })).toEqual(quota);
  });
});
