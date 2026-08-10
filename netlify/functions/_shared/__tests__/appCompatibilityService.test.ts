import type { Firestore } from 'firebase-admin/firestore';
import {
  evaluateCompatibilityReport,
  normalizeAppCompatibilityInput,
  recordAppCompatibility,
  summarizeAppCompatibilityCoverage,
} from '../appCompatibilityService';
import type { AppCompatibilityPolicy } from '../appCompatibilityPolicy';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const PEPPER = 'compatibility-pepper-abcdefghijklmnopqrstuvwxyz';
const policy: AppCompatibilityPolicy = {
  policyVersion: 2,
  minimumBuilds: { ios: 55, android: 22 },
  evidenceMaxAgeMs: 30 * DAY_MS,
};
const timestamp = (milliseconds: number) => ({ toMillis: () => milliseconds });
const evidence = (
  overrides: Record<string, unknown> = {},
) => ({
  platform: 'ios',
  appVersion: '1.50',
  buildNumber: 55,
  compatible: true,
  policyVersion: 2,
  firstSeenAt: timestamp(NOW - DAY_MS),
  lastSeenAt: timestamp(NOW - DAY_MS),
  ...overrides,
});
const report = (installations: Record<string, unknown>, overrides = {}) => ({
  policyVersion: 2,
  overflow: false,
  installations,
  ...overrides,
});

describe('app compatibility service', () => {
  test('normalizes only bounded native build evidence', () => {
    expect(normalizeAppCompatibilityInput({
      platform: 'ios',
      appVersion: '1.50',
      buildNumber: '55',
      installationId: 'cdefghijklmnopqrstuvwx',
    })).toEqual({
      platform: 'ios',
      appVersion: '1.50',
      buildNumber: 55,
      installationId: 'cdefghijklmnopqrstuvwx',
    });
    expect(normalizeAppCompatibilityInput({
      platform: 'web',
      appVersion: '1.50',
      buildNumber: 55,
      installationId: 'cdefghijklmnopqrstuvwx',
    })).toBeNull();
    expect(normalizeAppCompatibilityInput({
      platform: 'ios',
      appVersion: '1.50',
      buildNumber: 0,
      installationId: 'cdefghijklmnopqrstuvwx',
    })).toBeNull();
  });

  test('fails closed for stale, downgraded, old-policy and overflow evidence', () => {
    expect(evaluateCompatibilityReport(
      report({ current: evidence() }), policy, NOW,
    ).status).toBe('compatible');
    expect(evaluateCompatibilityReport(
      report({ stale: evidence({ lastSeenAt: timestamp(NOW - 31 * DAY_MS) }) }),
      policy,
      NOW,
    ).status).toBe('stale');
    expect(evaluateCompatibilityReport(
      report({ old: evidence({ buildNumber: 54, compatible: false }) }), policy, NOW,
    ).status).toBe('incompatible');
    expect(evaluateCompatibilityReport(
      report({ oldPolicy: evidence({ policyVersion: 1 }) }), policy, NOW,
    ).status).toBe('policy_mismatch');
    expect(evaluateCompatibilityReport(
      report({ current: evidence() }, { overflow: true }), policy, NOW,
    ).status).toBe('overflow');
  });

  test('requires evidence for every active account, including group members', () => {
    const users = [
      { id: 'owner', data: { groupId: 'family', role: 'admin' } },
      { id: 'member', data: { groupId: 'family', role: 'member' } },
      { id: 'personal', data: {} },
      { id: 'deleted', data: { accountState: 'deleted' } },
      { id: 'deleting', data: { accountState: 'deleting' } },
      { id: 'pending', data: { pendingGroupId: 'family' } },
    ];
    const reports = new Map<string, Record<string, any>>([
      ['owner', report({ ownerInstall: evidence() })],
      ['member', report({ memberInstall: evidence() })],
      ['personal', report({ oldInstall: evidence({ buildNumber: 54, compatible: false }) })],
    ]);
    expect(summarizeAppCompatibilityCoverage(users, reports, policy, NOW)).toEqual({
      eligible: 3,
      compatible: 2,
      missing: 0,
      incompatible: 1,
      stale: 0,
      policyMismatch: 0,
      overflow: 0,
      inactiveAccounts: 1,
      blockedAccounts: 2,
      readyForCutover: false,
    });
  });

  test('stores only an HMAC map key, never the raw Firebase Installation ID', async () => {
    const set = jest.fn();
    const userRef = { path: 'users/token-owner' };
    const reportRef = { path: 'appCompatibility/token-owner' };
    const transaction = {
      get: jest.fn(async (ref: { path: string }) => (
        ref.path === userRef.path
          ? { exists: true, data: () => ({ accountState: 'active' }) }
          : { exists: false, data: () => undefined }
      )),
      set,
    };
    const db = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn(() => name === 'users' ? userRef : reportRef),
      })),
      runTransaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
        callback(transaction)),
    } as unknown as Firestore;
    const installationId = 'cdefghijklmnopqrstuvwx';

    const result = await recordAppCompatibility(db, 'token-owner', {
      platform: 'ios', appVersion: '1.50', buildNumber: 55, installationId,
    }, policy, PEPPER);

    expect(result).toEqual({ accepted: true, compatibilityStatus: 'compatible' });
    const written = set.mock.calls[0][1];
    expect(JSON.stringify(written)).not.toContain(installationId);
    expect(Object.keys(written.installations)).toHaveLength(1);
    expect(Object.keys(written.installations)[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  test.each([
    { exists: false, data: undefined, code: 'ACCOUNT_NOT_READY' },
    { exists: true, data: { accountState: 'deleting' }, code: 'ACCOUNT_INACTIVE' },
  ])('rejects an unavailable account before writing compatibility evidence', async ({
    exists, data, code,
  }) => {
    const userRef = { path: 'users/token-owner' };
    const reportRef = { path: 'appCompatibility/token-owner' };
    const transaction = {
      get: jest.fn(async (ref: { path: string }) => (
        ref.path === userRef.path
          ? { exists, data: () => data }
          : { exists: false, data: () => undefined }
      )),
      set: jest.fn(),
    };
    const db = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn(() => name === 'users' ? userRef : reportRef),
      })),
      runTransaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
        callback(transaction)),
    } as unknown as Firestore;

    await expect(recordAppCompatibility(db, 'token-owner', {
      platform: 'ios', appVersion: '1.50', buildNumber: 55,
      installationId: 'cdefghijklmnopqrstuvwx',
    }, policy, PEPPER)).rejects.toMatchObject({ code });
    expect(transaction.set).not.toHaveBeenCalled();
  });

  test('keeps an installation overflow sticky until an operator reviews it', async () => {
    const userRef = { path: 'users/token-owner' };
    const reportRef = { path: 'appCompatibility/token-owner' };
    const transaction = {
      get: jest.fn(async (ref: { path: string }) => (
        ref.path === userRef.path
          ? { exists: true, data: () => ({ accountState: 'active' }) }
          : {
            exists: true,
            data: () => ({ overflow: true, installations: {} }),
          }
      )),
      set: jest.fn(),
    };
    const db = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn(() => name === 'users' ? userRef : reportRef),
      })),
      runTransaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
        callback(transaction)),
    } as unknown as Firestore;

    await expect(recordAppCompatibility(db, 'token-owner', {
      platform: 'ios', appVersion: '1.50', buildNumber: 55,
      installationId: 'cdefghijklmnopqrstuvwx',
    }, policy, PEPPER)).resolves.toEqual({
      accepted: false,
      compatibilityStatus: 'overflow',
    });
    expect(transaction.set).not.toHaveBeenCalled();
  });
});
