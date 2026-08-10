import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { useTranslation } from 'react-i18next';
import { settingsDocId } from '../utils/helpers';
import {
  EMPTY_WHATSAPP_TEMPLATES,
  WhatsAppTemplateField,
  buildWhatsAppTemplatePatch,
  normalizeWhatsAppTemplates,
  shouldClearTemplateDirtyField,
} from '../utils/whatsAppTemplates';

export const DEFAULT_DEUDA = 'La deuda es de ${total}. Saludos';
export const DEFAULT_RECORDATORIO = 'Hola, buenas \nEste es un mensaje automatico para informarle que, segun nuestros registros, quedo pendiente un saldo por regularizar.\nCuando pueda, le agradecemos que nos indique en que fecha podriamos saldarlo. Si necesita nuevamente los datos de la cuenta, con gusto se los enviamos.\nMuchas gracias.';

export const useWhatsAppTemplates = (uid: string, groupId: string | undefined) => {
  const { t } = useTranslation();
  const scopeKey = uid ? settingsDocId(uid, groupId) : '';
  const [waEnCamino, setWaEnCamino] = useState('');
  const [waTomorrowVisit, setWaTomorrowVisit] = useState('');
  const [waDeuda, setWaDeuda] = useState('');
  const [waRecordatorio, setWaRecordatorio] = useState('');
  const [loadedScopeKey, setLoadedScopeKey] = useState('');
  const [waLoadError, setWaLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const dirtyFieldsRef = useRef<Set<WhatsAppTemplateField>>(new Set());
  const editRevisionRef = useRef<Record<WhatsAppTemplateField, number>>({
    whatsappEnCamino: 0,
    whatsappTomorrowVisit: 0,
    whatsappDeuda: 0,
    whatsappRecordatorio: 0,
  });
  const currentScopeKeyRef = useRef(scopeKey);
  const effectScopeKeyRef = useRef('');
  const latestValuesRef = useRef({
    scopeKey,
    values: EMPTY_WHATSAPP_TEMPLATES,
  });
  currentScopeKeyRef.current = scopeKey;
  const waLoaded = Boolean(scopeKey && loadedScopeKey === scopeKey);

  useEffect(() => {
    let active = true;
    const scopeChanged = effectScopeKeyRef.current !== scopeKey;
    effectScopeKeyRef.current = scopeKey;
    setLoadedScopeKey('');
    setWaLoadError(false);

    if (scopeChanged) {
      setWaEnCamino('');
      setWaTomorrowVisit('');
      setWaDeuda('');
      setWaRecordatorio('');
      dirtyFieldsRef.current.clear();
      editRevisionRef.current = {
        whatsappEnCamino: 0,
        whatsappTomorrowVisit: 0,
        whatsappDeuda: 0,
        whatsappRecordatorio: 0,
      };
      latestValuesRef.current = {
        scopeKey,
        values: EMPTY_WHATSAPP_TEMPLATES,
      };
    }

    if (!scopeKey) return () => { active = false; };

    const unsubscribe = db.collection('settings').doc(scopeKey).onSnapshot(
      (doc) => {
        if (!active || currentScopeKeyRef.current !== scopeKey) return;
        const values = normalizeWhatsAppTemplates(doc.exists ? doc.data() : undefined);
        latestValuesRef.current = { scopeKey, values };
        if (!dirtyFieldsRef.current.has('whatsappEnCamino')) {
          setWaEnCamino(values.whatsappEnCamino);
        }
        if (!dirtyFieldsRef.current.has('whatsappTomorrowVisit')) {
          setWaTomorrowVisit(values.whatsappTomorrowVisit);
        }
        if (!dirtyFieldsRef.current.has('whatsappDeuda')) {
          setWaDeuda(values.whatsappDeuda);
        }
        if (!dirtyFieldsRef.current.has('whatsappRecordatorio')) {
          setWaRecordatorio(values.whatsappRecordatorio);
        }
        setWaLoadError(false);
        setLoadedScopeKey(scopeKey);
      },
      (error) => {
        if (!active || currentScopeKeyRef.current !== scopeKey) return;
        setLoadedScopeKey('');
        setWaLoadError(true);
        reportError(error, 'Error loading templates');
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadAttempt, scopeKey]);

  const updateTemplate = (field: WhatsAppTemplateField, value: string) => {
    dirtyFieldsRef.current.add(field);
    editRevisionRef.current[field] += 1;
    if (field === 'whatsappEnCamino') setWaEnCamino(value);
    if (field === 'whatsappTomorrowVisit') setWaTomorrowVisit(value);
    if (field === 'whatsappDeuda') setWaDeuda(value);
    if (field === 'whatsappRecordatorio') setWaRecordatorio(value);
  };

  const requireLoadedScope = () => {
    if (scopeKey && loadedScopeKey === scopeKey) return;
    Alert.alert(t('settings.templatesLoadingTitle'), t('settings.templatesLoadingMsg'));
    throw new Error('WHATSAPP_TEMPLATES_SCOPE_NOT_READY');
  };

  const handleSaveTemplates = async () => {
    requireLoadedScope();
    const operationScopeKey = scopeKey;
    try {
      if (!uid) throw new Error('WHATSAPP_TEMPLATES_USER_REQUIRED');
      const dirtyFields = new Set(dirtyFieldsRef.current);
      const revisions = new Map(
        [...dirtyFields].map((field) => [field, editRevisionRef.current[field]]),
      );
      const settings = buildWhatsAppTemplatePatch({
        whatsappEnCamino: waEnCamino,
        whatsappTomorrowVisit: waTomorrowVisit,
        whatsappDeuda: waDeuda,
        whatsappRecordatorio: waRecordatorio,
      }, dirtyFields);
      if (Object.keys(settings).length > 0) {
        await db.collection('settings').doc(operationScopeKey).set(settings, { merge: true });
        if (currentScopeKeyRef.current !== operationScopeKey) return false;
        dirtyFields.forEach((field) => {
          if (shouldClearTemplateDirtyField(
            revisions.get(field),
            editRevisionRef.current[field],
          )) {
            dirtyFieldsRef.current.delete(field);
          }
        });
      }
      if (currentScopeKeyRef.current !== operationScopeKey) return false;
      Alert.alert(t('settings.templatesSaved'), t('settings.templatesSavedMsg'));
      return dirtyFieldsRef.current.size === 0;
    } catch (e) {
      reportError(e, 'Error saving templates');
      if (currentScopeKeyRef.current === operationScopeKey) {
        Alert.alert(t('error'), t('settings.templatesSaveError'));
      }
      throw e;
    }
  };

  const handleResetTemplates = async () => {
    requireLoadedScope();
    const operationScopeKey = scopeKey;
    try {
      if (!uid) throw new Error('WHATSAPP_TEMPLATES_USER_REQUIRED');
      await db.collection('settings').doc(operationScopeKey).set(
        {
          whatsappEnCamino: null,
          whatsappTomorrowVisit: null,
          whatsappDeuda: null,
          whatsappRecordatorio: null,
        },
        { merge: true },
      );
      if (currentScopeKeyRef.current !== operationScopeKey) return false;
      setWaEnCamino(EMPTY_WHATSAPP_TEMPLATES.whatsappEnCamino);
      setWaTomorrowVisit(EMPTY_WHATSAPP_TEMPLATES.whatsappTomorrowVisit);
      setWaDeuda(EMPTY_WHATSAPP_TEMPLATES.whatsappDeuda);
      setWaRecordatorio(EMPTY_WHATSAPP_TEMPLATES.whatsappRecordatorio);
      dirtyFieldsRef.current.clear();
      Alert.alert(t('settings.templatesReset'), t('settings.templatesResetMsg'));
      return true;
    } catch (e) {
      reportError(e, 'Error resetting templates');
      if (currentScopeKeyRef.current === operationScopeKey) {
        Alert.alert(t('error'), t('settings.templatesSaveError'));
      }
      throw e;
    }
  };

  const discardDraft = () => {
    dirtyFieldsRef.current.clear();
    editRevisionRef.current = {
      whatsappEnCamino: 0,
      whatsappTomorrowVisit: 0,
      whatsappDeuda: 0,
      whatsappRecordatorio: 0,
    };
    const latest = latestValuesRef.current.scopeKey === scopeKey
      ? latestValuesRef.current.values
      : EMPTY_WHATSAPP_TEMPLATES;
    setWaEnCamino(latest.whatsappEnCamino);
    setWaTomorrowVisit(latest.whatsappTomorrowVisit);
    setWaDeuda(latest.whatsappDeuda);
    setWaRecordatorio(latest.whatsappRecordatorio);
    setLoadAttempt((attempt) => attempt + 1);
  };

  return {
    waEnCamino,
    setWaEnCamino: (value: string) => updateTemplate('whatsappEnCamino', value),
    waTomorrowVisit,
    setWaTomorrowVisit: (value: string) => updateTemplate('whatsappTomorrowVisit', value),
    waDeuda,
    setWaDeuda: (value: string) => updateTemplate('whatsappDeuda', value),
    waRecordatorio,
    setWaRecordatorio: (value: string) => updateTemplate('whatsappRecordatorio', value),
    waLoaded,
    waLoadError,
    reloadTemplates: () => setLoadAttempt((attempt) => attempt + 1),
    discardDraft,
    handleSaveTemplates,
    handleResetTemplates,
  };
};
