import { Platform } from 'react-native';

// URL base del backend de IA.
//
// - DEV (Metro corriendo): apunta al servidor Express local (`local-server/`).
//   - iOS Simulator: 'localhost' resuelve al host (la Mac).
//   - Android Emulator: '10.0.2.2' es el alias hacia el host.
//   - Device físico (futuro): habría que poner la IP LAN de la Mac.
//
// - PROD (build release): apunta a Netlify Functions. El redirect /api/* → /.netlify/functions/*
//   está configurado en netlify.toml.
//
// IMPORTANTE: cuando crees el site en Netlify (sugerido: "rutawater-api"),
// actualizá PROD_BASE_URL con el slug real (ej: 'https://rutawater-api.netlify.app').

const LOCAL_PORT = 3000;
const PROD_BASE_URL = 'https://rutawater-api.netlify.app';

const DEV_BASE_URL = Platform.select({
  ios: `http://localhost:${LOCAL_PORT}`,
  android: `http://10.0.2.2:${LOCAL_PORT}`,
  default: `http://localhost:${LOCAL_PORT}`,
});

export const API_BASE_URL = __DEV__ ? DEV_BASE_URL : PROD_BASE_URL;

export const API_ENDPOINTS = {
  // El canje siempre usa el backend publicado: necesita credenciales Admin y
  // códigos privados que nunca deben existir en Metro ni en el bundle móvil.
  redeemPromo: `${PROD_BASE_URL}/api/redeem-promo`,
  // Se llama únicamente después de que Firebase Auth confirmó la eliminación;
  // limpia con Admin los docs que las reglas nunca permiten borrar al cliente.
  cleanupDeletedAccount: `${PROD_BASE_URL}/api/cleanup-deleted-account`,
  // La creación migra datos personales en el servidor de forma reanudable;
  // no debe ejecutarse con batches locales que puedan quedar a medias.
  createGroup: `${PROD_BASE_URL}/api/create-group`,
  // Repara únicamente users/{uid}.groupId/role cuando un único grupo legacy
  // todavía reconoce al usuario autenticado como admin canónico.
  recoverFamilyGroup: `${PROD_BASE_URL}/api/recover-family-group`,
  // Las búsquedas por código y las altas de membresía ocurren solo con Admin
  // en el backend; así los códigos y documentos ajenos no son listables desde
  // una app modificada. Estas Functions caben en el plan gratuito de Netlify.
  joinGroup: `${PROD_BASE_URL}/api/join-group`,
  // Las altas de clientes pasan por backend para aplicar el cupo Free de forma
  // transaccional y global, incluso entre repartos y escrituras simultáneas.
  createClient: `${PROD_BASE_URL}/api/create-client`,
  createProfile: `${PROD_BASE_URL}/api/create-profile`,
  joinProfile: `${PROD_BASE_URL}/api/join-profile`,
  syncProfileIds: `${PROD_BASE_URL}/api/sync-profile-ids`,
  // Server-only compatibility evidence for the guarded data-scope rollout.
  // The endpoint stores a keyed digest of the Firebase Installation ID, never
  // the raw identifier, and a failure must not block normal app startup.
  // Debug/Simulator must never contaminate production adoption evidence with
  // its local build number. Release/TestFlight/App Store builds report here.
  reportAppVersion: __DEV__ ? null : `${PROD_BASE_URL}/api/report-app-version`,
  parseOrder: __DEV__
    ? `${API_BASE_URL}/parse-order`
    : `${API_BASE_URL}/api/parse-order`,
  // En Debug preferimos el servidor local para desarrollar prompts, pero el
  // simulador sigue siendo utilizable si no está instalado/configurado.
  parseOrderFallback: __DEV__
    ? `${PROD_BASE_URL}/api/parse-order`
    : null,
  health: __DEV__
    ? `${API_BASE_URL}/health`
    : `${API_BASE_URL}/api/health`,
};
