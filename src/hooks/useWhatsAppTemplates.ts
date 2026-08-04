import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { useTranslation } from 'react-i18next';
import { settingsDocId } from '../utils/helpers';

export const DEFAULT_EN_CAMINO = 'Buenas 🚚. Ya estamos en camino, sos el/la siguiente en la lista de entrega. ¡Nos vemos en unos minutos!\n\nAquapura';
export const DEFAULT_DEUDA = 'La deuda es de ${total}. Saludos';
export const DEFAULT_RECORDATORIO = 'Hola, buenas \nEste es un mensaje automatico para informarle que, segun nuestros registros, quedo pendiente un saldo por regularizar.\nCuando pueda, le agradecemos que nos indique en que fecha podriamos saldarlo. Si necesita nuevamente los datos de la cuenta, con gusto se los enviamos.\nMuchas gracias.';

export const useWhatsAppTemplates = (uid: string, groupId: string | undefined) => {
  const { t } = useTranslation();
  const [waEnCamino, setWaEnCamino] = useState('');
  const [waDeuda, setWaDeuda] = useState('');
  const [waRecordatorio, setWaRecordatorio] = useState('');
  const [waLoaded, setWaLoaded] = useState(false);

  useEffect(() => {
    if (!uid) return;
    db.collection('settings').doc(settingsDocId(uid, groupId)).get().then((doc) => {
      if (doc.exists) {
        const data = doc.data();
        if (data?.whatsappEnCamino) setWaEnCamino(data.whatsappEnCamino);
        if (data?.whatsappDeuda) setWaDeuda(data.whatsappDeuda);
        if (data?.whatsappRecordatorio) setWaRecordatorio(data.whatsappRecordatorio);
      }
      setWaLoaded(true);
    }).catch((error) => {
      reportError(error, 'Error loading templates');
      setWaLoaded(true);
    });
  }, [uid, groupId]);

  const handleSaveTemplates = async () => {
    try {
      if (!uid) throw new Error('WHATSAPP_TEMPLATES_USER_REQUIRED');
      const settings: Record<string, string | null> = {
        whatsappEnCamino: waEnCamino.trim() || null,
        whatsappDeuda: waDeuda.trim() || null,
        whatsappRecordatorio: waRecordatorio.trim() || null,
      };
      await db.collection('settings').doc(settingsDocId(uid, groupId)).set(settings, { merge: true });
      Alert.alert(t('settings.templatesSaved'), t('settings.templatesSavedMsg'));
    } catch (e) {
      reportError(e, 'Error saving templates');
      Alert.alert(t('error'), t('settings.templatesSaveError'));
      throw e;
    }
  };

  const handleResetTemplates = async () => {
    try {
      if (!uid) throw new Error('WHATSAPP_TEMPLATES_USER_REQUIRED');
      await db.collection('settings').doc(settingsDocId(uid, groupId)).set(
        { whatsappEnCamino: null, whatsappDeuda: null, whatsappRecordatorio: null },
        { merge: true },
      );
      setWaEnCamino('');
      setWaDeuda('');
      setWaRecordatorio('');
      Alert.alert(t('settings.templatesReset'), t('settings.templatesResetMsg'));
    } catch (e) {
      reportError(e, 'Error resetting templates');
      Alert.alert(t('error'), t('settings.templatesSaveError'));
      throw e;
    }
  };

  return {
    waEnCamino,
    setWaEnCamino,
    waDeuda,
    setWaDeuda,
    waRecordatorio,
    setWaRecordatorio,
    waLoaded,
    handleSaveTemplates,
    handleResetTemplates,
  };
};
