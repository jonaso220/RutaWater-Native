import RNFS from 'react-native-fs';

// La bienvenida se recuerda por cuenta y por dispositivo en un archivo chico:
// la app no tiene otro almacenamiento local de preferencias y no vale la pena
// escribir en Firestore algo que sólo afecta a esta pantalla.
const ONBOARDING_VERSION = 1;

const markerPath = (uid: string): string =>
  `${RNFS.DocumentDirectoryPath}/onboarding-v${ONBOARDING_VERSION}-${uid.replace(/[^A-Za-z0-9_-]/g, '')}`;

export const hasSeenOnboarding = async (uid: string): Promise<boolean> => {
  try {
    return await RNFS.exists(markerPath(uid));
  } catch {
    // Si no se puede leer, no insistir con la bienvenida.
    return true;
  }
};

export const markOnboardingSeen = async (uid: string): Promise<void> => {
  try {
    await RNFS.writeFile(markerPath(uid), new Date().toISOString(), 'utf8');
  } catch {
    // Sin marcador sólo se vuelve a mostrar la bienvenida; no es un error.
  }
};
