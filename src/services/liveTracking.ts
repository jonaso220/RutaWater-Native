import 'react-native-get-random-values';
import Geolocation, { GeolocationError, GeolocationResponse } from '@react-native-community/geolocation';
import { firebase } from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';
import notifee, { AndroidForegroundServiceType, AndroidImportance } from '@notifee/react-native';
import { PermissionsAndroid, Platform } from 'react-native';
import i18n from '../i18n';
import { reportError } from '../lib/crashReporting';
import { toLocalDateString } from '../utils/helpers';
import {
  isFreshFix, liveLinks, MIN_WRITE_INTERVAL_MS, newTrackingRecord, newTrackingToken, positionFields,
  shouldAddTrailPoint, TRACKING_LINK_MINUTES, TrackingFix, TrackingLink, trackingUrl,
} from '../utils/liveTracking';

// Instancia por defecto del proyecto (us-central1). Los GoogleService-Info /
// google-services.json son de antes de crear la base, así que va explícita.
const DATABASE_URL = 'https://rutawater-default-rtdb.firebaseio.com';
// Para probar contra el emulador en desarrollo: '127.0.0.1' (iOS) o '10.0.2.2' (Android).
const EMULATOR_HOST: string | null = null;

const CHANNEL_ID = 'live-tracking';
const NOTIFICATION_ID = 'live-tracking';
export const STOP_TRACKING_ACTION = 'stop-live-tracking';

let links: TrackingLink[] = [];
let lastFix: TrackingFix | null = null;
let lastTrailPoint: TrackingFix | null = null;
let lastWriteAt = 0;
let watchId: number | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let stopService: (() => void) | null = null;

const database = () => {
  const db = firebase.app().database(DATABASE_URL);
  if (__DEV__ && EMULATOR_HOST) db.useEmulator(EMULATOR_HOST, 9000);
  return db;
};
const linkRef = (token: string) => database().ref(`seguimiento/${token}`);
const serverTime = () => firebase.database.ServerValue.TIMESTAMP;

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

/** Android corre el seguimiento como servicio en primer plano; se registra al arrancar (index.js). */
export const registerLiveTrackingService = (): void => {
  if (Platform.OS !== 'android') return;
  notifee.registerForegroundService(() => new Promise<void>((resolve) => { stopService = resolve; }));
};

// Ninguna API de permiso responde siempre: en iOS requestAuthorization solo
// avisa cuando el permiso cambia (ya concedido = nunca), y en Android con RN 0.77
// pedir uno ya concedido puede quedar pendiente. Android consulta antes de
// pedir; iOS pide una posición, que pregunta si hace falta y falla enseguida si
// está negado. Igual, «En camino» nunca espera más que esto para abrir WhatsApp.
const PERMISSION_TIMEOUT_MS = 20000;
const START_TIMEOUT_MS = 25000;

const requestPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    if (await PermissionsAndroid.check(permission)) return true;
    return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
  }
  Geolocation.setRNConfiguration({ skipPermissionRequests: false, authorizationLevel: 'whenInUse' });
  return new Promise((resolve) => Geolocation.getCurrentPosition(
    (position) => {
      onFix(position);
      resolve(true);
    },
    // Sin señal todavía (timeout) no es falta de permiso.
    (error) => resolve(error.code !== error.PERMISSION_DENIED),
    { enableHighAccuracy: false, timeout: PERMISSION_TIMEOUT_MS, maximumAge: 60000 },
  ));
};

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(fallback), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    () => { clearTimeout(timer); resolve(fallback); },
  );
});

const startAndroidService = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({ id: CHANNEL_ID, name: i18n.t('liveTracking.channel'), importance: AndroidImportance.LOW });
  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title: i18n.t('liveTracking.notificationTitle'),
    body: i18n.t('liveTracking.notificationBody', { minutes: TRACKING_LINK_MINUTES }),
    android: {
      channelId: CHANNEL_ID,
      smallIcon: 'ic_notification',
      asForegroundService: true,
      foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION],
      ongoing: true,
      pressAction: { id: 'default' },
      actions: [{ title: i18n.t('liveTracking.stop'), pressAction: { id: STOP_TRACKING_ACTION } }],
    },
  });
};

const writePosition = (fix: TrackingFix): void => {
  const position = positionFields(fix);
  const addTrail = shouldAddTrailPoint(lastTrailPoint, fix);
  if (addTrail) lastTrailPoint = fix;
  links.forEach(({ token }) => {
    const ref = linkRef(token);
    ref.update({ estado: 'en_camino', ...position, actualizado: serverTime() })
      .catch((error) => reportError(error, 'Live tracking position'));
    if (addTrail) {
      // push devuelve una referencia «thenable»: Promise.resolve la espera.
      Promise.resolve(ref.child('rastro').push({ lat: position.lat, lng: position.lng, t: serverTime() }))
        .catch((error) => reportError(error, 'Live tracking trail'));
    }
  });
};

const onFix = ({ coords, timestamp }: GeolocationResponse): void => {
  const fix: TrackingFix = {
    lat: coords.latitude,
    lng: coords.longitude,
    precision: coords.accuracy ?? undefined,
    rumbo: coords.heading ?? undefined,
    at: timestamp || Date.now(),
  };
  lastFix = fix;
  if (!pruneLinks()) return;
  if (Date.now() - lastWriteAt < MIN_WRITE_INTERVAL_MS) return;
  lastWriteAt = Date.now();
  writePosition(fix);
};

const onLocationError = (error: GeolocationError): void => {
  reportError(new Error(`${error.code}: ${error.message}`), 'Live tracking location');
  // Permiso revocado mientras se compartía: no hay más posiciones que mandar.
  if (error.code === error.PERMISSION_DENIED) stopLiveTracking();
};

const startWatching = (): void => {
  if (watchId !== null) return;
  if (Platform.OS === 'ios') {
    // Con el permiso ya pedido, así se habilitan las actualizaciones con la app en segundo plano.
    Geolocation.setRNConfiguration({
      skipPermissionRequests: true, authorizationLevel: 'whenInUse', enableBackgroundLocationUpdates: true,
    });
  }
  watchId = Geolocation.watchPosition(onFix, onLocationError, {
    enableHighAccuracy: true, distanceFilter: 15, interval: 15000, fastestInterval: 10000, maximumAge: 10000,
  });
};

const scheduleExpiry = (): void => {
  if (expiryTimer) clearTimeout(expiryTimer);
  if (!links.length) return;
  const next = Math.min(...links.map((link) => link.vence));
  expiryTimer = setTimeout(() => { pruneLinks(); scheduleExpiry(); }, Math.max(1000, next - Date.now()));
};

/** Saca los links vencidos (y borra sus registros); sin ninguno vivo, apaga el GPS. */
function pruneLinks(): boolean {
  const alive = liveLinks(links, Date.now());
  links.filter((link) => !alive.includes(link)).forEach(({ token }) => {
    linkRef(token).remove().catch((error) => reportError(error, 'Live tracking cleanup'));
  });
  links = alive;
  if (!links.length) stopLiveTracking();
  return links.length > 0;
}

/** Corta todo: GPS, notificación de Android y los links que quedaban (el cliente ve «terminó»). */
export function stopLiveTracking(): void {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  links.forEach(({ token }) => {
    linkRef(token).remove().catch((error) => reportError(error, 'Live tracking stop'));
  });
  links = [];
  lastTrailPoint = null;
  if (Platform.OS === 'android' && stopService) {
    notifee.stopForegroundService().catch((error) => reportError(error, 'Live tracking service'));
    stopService();
    stopService = null;
  }
}

/**
 * «En camino»: crea un link de 30 minutos y empieza (o sigue) mandando la
 * ubicación a todos los links vivos. Devuelve la URL, o null si no hay
 * permiso de ubicación o sesión: el mensaje sale igual, sin link.
 */
export const startEnCaminoLink = async (): Promise<string | null> => {
  const uid = auth().currentUser?.uid;
  if (!uid) return null;
  try {
    if (!(await withTimeout(requestPermission(), START_TIMEOUT_MS, false))) return null;
    const now = Date.now();
    const link: TrackingLink = { token: newTrackingToken(randomBytes), vence: now + TRACKING_LINK_MINUTES * 60000 };
    const fix = isFreshFix(lastFix, now) ? lastFix : null;
    // Sin esperar la confirmación del servidor: WhatsApp abre al instante.
    linkRef(link.token).set(newTrackingRecord(uid, toLocalDateString(new Date(now)), link.vence, fix, now, serverTime()))
      .catch((error) => {
        links = links.filter((candidate) => candidate !== link);
        reportError(error, 'Live tracking link');
      });
    if (fix) lastTrailPoint = null;
    links = [...links, link];
    await startAndroidService().catch((error) => reportError(error, 'Live tracking service'));
    startWatching();
    scheduleExpiry();
    return trackingUrl(link.token);
  } catch (error) {
    reportError(error, 'Live tracking start');
    return null;
  }
};
