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
