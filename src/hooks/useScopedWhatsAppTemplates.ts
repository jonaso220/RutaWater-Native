import { useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { settingsDocId } from '../utils/helpers';
import {
  normalizeWhatsAppTemplates,
  ScopedWhatsAppTemplates,
  templatesForScope,
} from '../utils/whatsAppTemplates';

/**
 * Plantillas de WhatsApp de la cuenta, en vivo. Inicio las lee con su propio
 * escucha; este hook es para las demás pantallas (Directorio), que antes
 * mandaban siempre el mensaje de deuda por defecto.
 */
export const useScopedWhatsAppTemplates = (uid: string | undefined, groupId: string | undefined) => {
  const scopeKey = uid ? settingsDocId(uid, groupId) : '';
  const [snapshot, setSnapshot] = useState<ScopedWhatsAppTemplates>({ scopeKey: '', data: null });

  useEffect(() => {
    let active = true;
    setSnapshot({ scopeKey, data: null });
    if (!scopeKey) return () => { active = false; };

    const unsubscribe = db.collection('settings').doc(scopeKey).onSnapshot((doc) => {
      if (!active) return;
      setSnapshot({ scopeKey, data: doc.exists ? normalizeWhatsAppTemplates(doc.data()) : null });
    }, (error) => {
      if (!active) return;
      setSnapshot({ scopeKey, data: null });
      reportError(error, 'Error loading WhatsApp templates');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [scopeKey]);

  return templatesForScope(scopeKey, snapshot);
};
