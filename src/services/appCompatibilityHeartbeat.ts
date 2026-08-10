import { Platform } from 'react-native';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import installations from '@react-native-firebase/installations';
import DeviceInfo from 'react-native-device-info';
import { API_ENDPOINTS } from '../config/api';

const REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const lastSuccessfulReport = new Map<string, number>();
const reportsInFlight = new Map<string, Promise<void>>();

const reportKey = (uid: string, installationId: string): string =>
  `${uid}:${Platform.OS}:${installationId}`;

const sendAppVersionReport = async (
  user: FirebaseAuthTypes.User,
  installationId: string,
  endpoint: string,
): Promise<void> => {
  const buildNumber = Number(DeviceInfo.getBuildNumber());
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
    throw new Error('APP_BUILD_NUMBER_INVALID');
  }
  const token = await user.getIdToken();
  // A delayed token/FID read from a previous session must never report under
  // the account that subsequently signed in on the same process.
  if (auth().currentUser?.uid !== user.uid) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform: Platform.OS,
        appVersion: DeviceInfo.getVersion(),
        buildNumber,
        installationId,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`APP_VERSION_REPORT_HTTP_${response.status}`);
    const payload = await response.json().catch(() => null) as { status?: string } | null;
    if (payload?.status !== 'ok') throw new Error('APP_VERSION_REPORT_INVALID_RESPONSE');
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Best-effort evidence for the guarded Firestore rollout. It never blocks auth
 * or data loading; callers deliberately report failures to Crashlytics and
 * retry on the next foreground window.
 */
export const reportAppCompatibility = async (
  user: FirebaseAuthTypes.User,
  now = Date.now(),
): Promise<void> => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const endpoint = API_ENDPOINTS.reportAppVersion;
  if (!endpoint) return;
  const installationId = await installations().getId();
  const key = reportKey(user.uid, installationId);
  const lastSuccess = lastSuccessfulReport.get(key) || 0;
  if (now - lastSuccess < REPORT_INTERVAL_MS) return;
  const existing = reportsInFlight.get(key);
  if (existing) return existing;

  const request = sendAppVersionReport(user, installationId, endpoint)
    .then(() => {
      if (auth().currentUser?.uid === user.uid) {
        lastSuccessfulReport.set(key, Date.now());
      }
    })
    .finally(() => {
      reportsInFlight.delete(key);
    });
  reportsInFlight.set(key, request);
  return request;
};
