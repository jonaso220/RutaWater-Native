import { Linking } from 'react-native';
import { normalizePhone } from './helpers';

/** Opens the client's WhatsApp chat with no draft; `onError` runs when WhatsApp cannot open. */
export const openWhatsAppChat = (phone: string, onError: () => void): void => {
  if (!phone) return;
  Linking.openURL(`whatsapp://send?phone=${normalizePhone(phone)}`).catch(onError);
};
