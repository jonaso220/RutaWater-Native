import type { EnvironmentReader } from './firebaseAdmin';

export type SupportedAppPlatform = 'ios' | 'android';

export interface AppCompatibilityPolicy {
  policyVersion: number;
  minimumBuilds: Record<SupportedAppPlatform, number>;
  evidenceMaxAgeMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const positiveInteger = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * The migration gate stays closed unless the entire server-owned policy is
 * configured. Build values are numeric because marketing versions are not
 * ordered reliably and Xcode Cloud may override the source build number.
 */
export const readAppCompatibilityPolicy = (
  readEnvironment: EnvironmentReader,
): AppCompatibilityPolicy | null => {
  const policyVersion = positiveInteger(
    readEnvironment('DATA_SCOPE_COMPATIBILITY_POLICY_VERSION'),
  );
  const minimumIosBuild = positiveInteger(
    readEnvironment('DATA_SCOPE_MINIMUM_IOS_BUILD'),
  );
  const minimumAndroidBuild = positiveInteger(
    readEnvironment('DATA_SCOPE_MINIMUM_ANDROID_BUILD'),
  );
  const maxAgeDays = positiveInteger(
    readEnvironment('DATA_SCOPE_COMPATIBILITY_MAX_AGE_DAYS'),
  );
  if (!policyVersion || !minimumIosBuild || !minimumAndroidBuild || !maxAgeDays) {
    return null;
  }
  // Refuse accidental gates that would expire instantly or retain evidence
  // indefinitely. The exact operational value remains server-controlled.
  if (maxAgeDays < 1 || maxAgeDays > 90) return null;
  return {
    policyVersion,
    minimumBuilds: {
      ios: minimumIosBuild,
      android: minimumAndroidBuild,
    },
    evidenceMaxAgeMs: maxAgeDays * DAY_MS,
  };
};

export const validCompatibilityPepper = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length >= 32;

export const appCompatibilityPolicyLabel = (
  policy: AppCompatibilityPolicy,
): string => [
  `policy=${policy.policyVersion}`,
  `ios>=${policy.minimumBuilds.ios}`,
  `android>=${policy.minimumBuilds.android}`,
].join(';');
