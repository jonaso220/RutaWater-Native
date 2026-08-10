import { createHmac } from 'crypto';
import {
  Firestore,
  Timestamp,
} from 'firebase-admin/firestore';
import {
  AppCompatibilityPolicy,
  SupportedAppPlatform,
} from './appCompatibilityPolicy';
import { dataScopeActivationEligibility } from './dataScopeAccountEligibility';

const COMPATIBILITY_COLLECTION = 'appCompatibility';
const MAX_INSTALLATIONS_PER_ACCOUNT = 20;
const MIN_SERVER_REPORT_INTERVAL_MS = 60 * 60 * 1000;

export interface AppCompatibilityInput {
  platform: SupportedAppPlatform;
  appVersion: string;
  buildNumber: number;
  installationId: string;
}

interface InstallationEvidence {
  platform: SupportedAppPlatform;
  appVersion: string;
  buildNumber: number;
  compatible: boolean;
  policyVersion: number;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
}

interface CompatibilityReport {
  policyVersion?: unknown;
  overflow?: unknown;
  installations?: unknown;
}

export type CompatibilityEvidenceStatus =
  | 'compatible'
  | 'missing'
  | 'incompatible'
  | 'stale'
  | 'policy_mismatch'
  | 'overflow';

export interface AppCompatibilityCoverage {
  eligible: number;
  compatible: number;
  missing: number;
  incompatible: number;
  stale: number;
  policyMismatch: number;
  overflow: number;
  inactiveAccounts: number;
  blockedAccounts: number;
  readyForCutover: boolean;
}

export class AppCompatibilityError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AppCompatibilityError';
  }
}

const plainRecord = (value: unknown): Record<string, any> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
);

const timestampMillis = (value: unknown): number | null => {
  if (!value || typeof value !== 'object' || !('toMillis' in value)) return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return null;
  const milliseconds = Number(toMillis.call(value));
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

export const normalizeAppCompatibilityInput = (
  value: unknown,
): AppCompatibilityInput | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.platform !== 'ios' && input.platform !== 'android') return null;
  if (
    typeof input.appVersion !== 'string'
    || !/^[0-9A-Za-z.+_-]{1,32}$/.test(input.appVersion)
  ) return null;
  const buildNumber = typeof input.buildNumber === 'number'
    ? input.buildNumber
    : typeof input.buildNumber === 'string' && /^\d+$/.test(input.buildNumber)
      ? Number(input.buildNumber)
      : NaN;
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) return null;
  // Firebase Installation IDs are opaque URL-safe identifiers. Keep the
  // validation deliberately format-agnostic while rejecting unbounded input.
  if (
    typeof input.installationId !== 'string'
    || !/^[A-Za-z0-9_-]{16,128}$/.test(input.installationId)
  ) return null;
  return {
    platform: input.platform,
    appVersion: input.appVersion,
    buildNumber,
    installationId: input.installationId,
  };
};

const installationDigest = (
  uid: string,
  input: AppCompatibilityInput,
  pepper: string,
): string => createHmac('sha256', pepper)
  .update(`${uid}\0${input.platform}\0${input.installationId}`)
  .digest('hex');

export const evaluateCompatibilityReport = (
  report: CompatibilityReport | undefined,
  policy: AppCompatibilityPolicy,
  nowMs = Date.now(),
): {
  status: CompatibilityEvidenceStatus;
  installationCount: number;
  incompatibleInstallationCount: number;
  lastSeenAtMs: number | null;
  evidenceValidUntilMs: number | null;
} => {
  if (!report) {
    return {
      status: 'missing',
      installationCount: 0,
      incompatibleInstallationCount: 0,
      lastSeenAtMs: null,
      evidenceValidUntilMs: null,
    };
  }
  if (report.overflow === true) {
    return {
      status: 'overflow',
      installationCount: Object.keys(plainRecord(report.installations)).length,
      incompatibleInstallationCount: 0,
      lastSeenAtMs: null,
      evidenceValidUntilMs: null,
    };
  }
  const installations = Object.values(plainRecord(report.installations));
  if (installations.length === 0) {
    return {
      status: 'missing',
      installationCount: 0,
      incompatibleInstallationCount: 0,
      lastSeenAtMs: null,
      evidenceValidUntilMs: null,
    };
  }

  let policyMismatch = report.policyVersion !== policy.policyVersion;
  let stale = false;
  let incompatible = 0;
  let latestSeen = 0;
  let earliestExpiry = Number.POSITIVE_INFINITY;
  for (const rawEvidence of installations) {
    const evidence = plainRecord(rawEvidence);
    const platform = evidence.platform;
    const buildNumber = Number(evidence.buildNumber);
    const lastSeenAtMs = timestampMillis(evidence.lastSeenAt);
    if (
      evidence.policyVersion !== policy.policyVersion
      || (platform !== 'ios' && platform !== 'android')
    ) {
      policyMismatch = true;
    }
    if (!lastSeenAtMs || lastSeenAtMs + policy.evidenceMaxAgeMs < nowMs) stale = true;
    if (lastSeenAtMs) {
      latestSeen = Math.max(latestSeen, lastSeenAtMs);
      earliestExpiry = Math.min(earliestExpiry, lastSeenAtMs + policy.evidenceMaxAgeMs);
    }
    if (
      (platform !== 'ios' && platform !== 'android')
      || !Number.isSafeInteger(buildNumber)
      || buildNumber < policy.minimumBuilds[platform as SupportedAppPlatform]
      || evidence.compatible !== true
    ) incompatible += 1;
  }

  const status: CompatibilityEvidenceStatus = policyMismatch
    ? 'policy_mismatch'
    : stale
      ? 'stale'
      : incompatible > 0
        ? 'incompatible'
        : 'compatible';
  return {
    status,
    installationCount: installations.length,
    incompatibleInstallationCount: incompatible,
    lastSeenAtMs: latestSeen || null,
    evidenceValidUntilMs: Number.isFinite(earliestExpiry) ? earliestExpiry : null,
  };
};

export const recordAppCompatibility = async (
  db: Firestore,
  uid: string,
  input: AppCompatibilityInput,
  policy: AppCompatibilityPolicy,
  pepper: string,
) => {
  const userRef = db.collection('users').doc(uid);
  const reportRef = db.collection(COMPATIBILITY_COLLECTION).doc(uid);
  const digest = installationDigest(uid, input, pepper);
  const now = Timestamp.now();
  const compatible = input.buildNumber >= policy.minimumBuilds[input.platform];

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) {
      throw new AppCompatibilityError('ACCOUNT_NOT_READY');
    }
    const accountState = userSnapshot.data()?.accountState;
    if (accountState === 'deleting' || accountState === 'deleted') {
      throw new AppCompatibilityError('ACCOUNT_INACTIVE');
    }
    const snapshot = await transaction.get(reportRef);
    const existing = plainRecord(snapshot.data());
    const installations = { ...plainRecord(existing.installations) };
    const previous = plainRecord(installations[digest]);
    // Overflow is an operator-reviewed safety condition. A known installation
    // must not silently clear it on its next heartbeat.
    if (existing.overflow === true) {
      return { accepted: false, compatibilityStatus: 'overflow' as const };
    }
    if (!installations[digest] && Object.keys(installations).length >= MAX_INSTALLATIONS_PER_ACCOUNT) {
      transaction.set(reportRef, {
        schemaVersion: 1,
        policyVersion: policy.policyVersion,
        overflow: true,
        status: 'overflow',
        evaluatedAt: now,
        updatedAt: now,
      }, { merge: true });
      return { accepted: false, compatibilityStatus: 'overflow' as const };
    }

    const previousSeenAt = timestampMillis(previous.lastSeenAt);
    if (
      previousSeenAt
      && now.toMillis() - previousSeenAt < MIN_SERVER_REPORT_INTERVAL_MS
      && previous.platform === input.platform
      && previous.appVersion === input.appVersion
      && Number(previous.buildNumber) === input.buildNumber
      && previous.policyVersion === policy.policyVersion
    ) {
      const evaluation = evaluateCompatibilityReport(existing, policy, now.toMillis());
      return { accepted: true, compatibilityStatus: evaluation.status };
    }

    installations[digest] = {
      platform: input.platform,
      appVersion: input.appVersion,
      buildNumber: input.buildNumber,
      compatible,
      policyVersion: policy.policyVersion,
      firstSeenAt: previous.firstSeenAt instanceof Timestamp ? previous.firstSeenAt : now,
      lastSeenAt: now,
    } satisfies InstallationEvidence;
    const candidate: CompatibilityReport = {
      policyVersion: policy.policyVersion,
      overflow: false,
      installations,
    };
    const evaluation = evaluateCompatibilityReport(candidate, policy, now.toMillis());
    transaction.set(reportRef, {
      schemaVersion: 1,
      policyVersion: policy.policyVersion,
      overflow: false,
      installations,
      status: evaluation.status,
      activeInstallationCount: evaluation.installationCount,
      incompatibleInstallationCount: evaluation.incompatibleInstallationCount,
      lastSeenAt: evaluation.lastSeenAtMs
        ? Timestamp.fromMillis(evaluation.lastSeenAtMs)
        : null,
      evidenceValidUntil: evaluation.evidenceValidUntilMs
        ? Timestamp.fromMillis(evaluation.evidenceValidUntilMs)
        : null,
      evaluatedAt: now,
      updatedAt: now,
      ...(snapshot.exists ? {} : { createdAt: now }),
    }, { merge: true });
    return { accepted: true, compatibilityStatus: evaluation.status };
  });
};

interface AccountEvidenceRecord {
  id: string;
  data: Record<string, any>;
}

export const summarizeAppCompatibilityCoverage = (
  users: AccountEvidenceRecord[],
  reports: Map<string, Record<string, any>>,
  policy: AppCompatibilityPolicy,
  nowMs = Date.now(),
): AppCompatibilityCoverage => {
  const coverage: AppCompatibilityCoverage = {
    eligible: 0,
    compatible: 0,
    missing: 0,
    incompatible: 0,
    stale: 0,
    policyMismatch: 0,
    overflow: 0,
    inactiveAccounts: 0,
    blockedAccounts: 0,
    readyForCutover: false,
  };
  users.forEach((user) => {
    const eligibility = dataScopeActivationEligibility(user.data);
    if (eligibility === 'inactive') {
      coverage.inactiveAccounts += 1;
      return;
    }
    if (eligibility === 'blocked') {
      coverage.blockedAccounts += 1;
      return;
    }
    coverage.eligible += 1;
    const status = evaluateCompatibilityReport(reports.get(user.id), policy, nowMs).status;
    if (status === 'compatible') coverage.compatible += 1;
    else if (status === 'missing') coverage.missing += 1;
    else if (status === 'incompatible') coverage.incompatible += 1;
    else if (status === 'stale') coverage.stale += 1;
    else if (status === 'policy_mismatch') coverage.policyMismatch += 1;
    else coverage.overflow += 1;
  });
  coverage.readyForCutover = coverage.eligible > 0
    && coverage.compatible === coverage.eligible
    && coverage.blockedAccounts === 0;
  return coverage;
};

export const getAppCompatibilityCoverage = async (
  db: Firestore,
  policy: AppCompatibilityPolicy,
): Promise<AppCompatibilityCoverage> => {
  const [usersSnapshot, reportsSnapshot] = await Promise.all([
    db.collection('users').get(),
    db.collection(COMPATIBILITY_COLLECTION).get(),
  ]);
  const users = usersSnapshot.docs.map((document) => ({
    id: document.id,
    data: document.data() || {},
  }));
  const reports = new Map(reportsSnapshot.docs.map((document) => [
    document.id,
    document.data() || {},
  ]));
  return summarizeAppCompatibilityCoverage(users, reports, policy);
};
