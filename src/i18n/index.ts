import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as RNLocalize from 'react-native-localize';
import es from './locales/es';
import en from './locales/en';
import pt from './locales/pt';

const resources = { es: { translation: es }, en: { translation: en }, pt: { translation: pt } };

// Detect device language and map to supported locale
const getDeviceLanguage = (): string => {
  const locales = RNLocalize.getLocales();
  if (locales.length === 0) return 'es';

  const lang = locales[0].languageCode;
  if (lang === 'pt') return 'pt';
  if (lang === 'en') return 'en';
  return 'es'; // Default to Spanish
};

i18n.use(initReactI18next).init({
  resources,
  lng: getDeviceLanguage(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

export default i18n;
