// Firebase config for React Native
// The config is set via GoogleService-Info.plist (iOS) and google-services.json (Android)
// @react-native-firebase/app reads them automatically at build time.
//
// Firebase project: rutawater
// Same Firestore database as the web app (rutawaterplus.netlify.app)

import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Platform } from 'react-native';

// Android configures the same persistent, unlimited cache synchronously in
// MainApplication before React Native (including background alarm tasks) starts.
// Sending settings asynchronously over the bridge races the first listeners
// and can crash the native SDK once Firestore has already started.
if (Platform.OS !== 'android') {
  firestore().settings({
    persistence: true,
    cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
  });
}

export const db = firestore();
export const fbAuth = auth();
