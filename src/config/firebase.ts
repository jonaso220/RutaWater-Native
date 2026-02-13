// Firebase config for React Native
// The config is set via GoogleService-Info.plist (iOS) and google-services.json (Android)
// @react-native-firebase/app reads them automatically at build time.
//
// Firebase project: rutawater
// Same Firestore database as the web app (rutawaterplus.netlify.app)

import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

// Enable offline persistence (Firestore caches data locally)
firestore().settings({
  persistence: true,
  cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
});

export const db = firestore();
export const fbAuth = auth();
