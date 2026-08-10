import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Keyboard,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import ModalOverlay from './ModalOverlay';
import { ProductLabel } from './ProductIcon';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { Frequency, getDayLabel, getFreqLabel } from '../constants/products';
import { useAllProducts } from '../stores/productCatalogStore';
import { getModalWidth, getDayIndex, sanitizePhone } from '../utils/helpers';
import { formatShortDate } from '../utils/format';
import { hasGoogleLocationLinkText, normalizeGoogleMapsLink } from '../utils/googleMapsLink';
import { useLayout } from '../hooks/useLayout';
import { useAiParse, ParseResult, NotesMode } from '../hooks/useAiParse';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { useClientsStore } from '../stores/clientsStore';
import { isValidCalendarDate, isValidScheduleDate } from '../utils/scheduling';

interface SmartOrderModalProps {
  visible: boolean;
  onClose: () => void;
}

// Detecta texto que el LLM generó describiendo sus acciones en vez de citar al usuario.
// Esos textos se filtran tanto del preview como del valor que se guarda.
const looksLikeAutoDescription = (text: string): boolean => {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /^se (quit|agreg|añad|anad|cambi|modific|reempla|sum|añade|añadi|elimi)/i.test(t) ||
    /^modificaci[oó]n de productos/i.test(t) ||
    /^cliente nuevo agregado/i.test(t) ||
    /^pedido (actualizado|modificado|del .* actualizado)/i.test(t) ||
    /del pedido (pendiente|semanal|mensual|quincenal|del lunes|del martes|del mi[eé]rcoles|del jueves|del viernes|del s[aá]bado|del domingo)/i.test(t) ||
    /^el usuario (también|tambi[eé]n) (menciona|pide|solicita)/i.test(t)
  );
};

// El modelo a veces omite notes_mode aunque sea required. Cuando pasa eso,
// inferimos del texto del usuario qué quería hacer con la nota.
const inferNotesModeFromUserText = (userText: string): NotesMode | null => {
  const t = (userText || '').toLowerCase();
  const mentionsNotes = /\bnotas?\b/.test(t);
  if (mentionsNotes) {
    if (/\b(b[óo]rra|borr|saca|limpi|quit|elimin)/i.test(t)) return 'clear';
    if (/\b(cambi|reempla)/i.test(t)) return 'replace';
    if (/\b(agreg|sum|añad|anad|pon|anot|deja|agreg[áa])/i.test(t)) return 'append';
  }
  // Verbos que ya implican nota sin mencionar la palabra: "anotá que ...", "anota que ..."
  if (/\banot[áa]\b/i.test(t)) return 'append';
  return null;
};

const DAY_CANON = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
// "miércoles"/"MARTES"/"sabado" → nombre canónico; '' si no es un día real.
const normalizeDayName = (d: string): string => {
  const idx = getDayIndex(d || '');
  return idx >= 0 ? DAY_CANON[idx] : '';
};

// Set absoluto de productos de la IA: solo enteros positivos razonables.
const cleanProductSet = (p: Record<string, number> | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  Object.entries(p || {}).forEach(([k, v]) => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n > 0 && n <= 9999) out[k] = n;
  });
  return out;
};

const SmartOrderModal: React.FC<SmartOrderModalProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = useMemo(() => getStyles(colors, isTablet, modalWidth, fontScale), [colors, isTablet, modalWidth, fontScale]);

  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const { parsing, parse, error, limitReached, reset } = useAiParse();
  const usage = useAiUsageStore();
  const aiCreateClient = useClientsStore((s) => s.aiCreateClient);
  const scheduleFromDirectory = useClientsStore((s) => s.scheduleFromDirectory);
  const updateClient = useClientsStore((s) => s.updateClient);
  const addNote = useClientsStore((s) => s.addNote);
  const clients = useClientsStore((s) => s.clients);
  const canAddClient = useClientsStore((s) => s.canAddClient);

  useEffect(() => {
    if (!visible) return;
    if (limitReached) {
      AccessibilityInfo.announceForAccessibility(t('smartOrder.limitTitle'));
    } else if (error) {
      AccessibilityInfo.announceForAccessibility(`${t('smartOrder.parseErrorTitle')}. ${error}`);
    } else if (result) {
      AccessibilityInfo.announceForAccessibility(t('smartOrder.previewReady'));
    }
  }, [error, limitReached, result, t, visible]);

  // Calcula el valor final de la nota a guardar.
  // Orden de prioridad para determinar el mode:
  //   1. notes_mode explícito de la IA (cuando viene)
  //   2. inferencia desde el texto del usuario (clear / append / replace)
  //   3. fallback: 'append' si hay texto incoming, 'keep' si no
  // Devuelve undefined si no hay que tocar la nota.
  const resolveNotes = (current: string | undefined, incoming: string, mode: NotesMode | undefined, userText: string): string | undefined => {
    const cur = (current || '').trim();
    let inc = (incoming || '').trim();
    if (looksLikeAutoDescription(inc)) inc = '';
    const inferred = inferNotesModeFromUserText(userText);
    const m: NotesMode = mode || inferred || (inc ? 'append' : 'keep');
    if (m === 'keep') return undefined;
    if (m === 'clear') return '';
    if (m === 'replace') return inc;
    // append
    if (!inc) return undefined; // nada que agregar
    if (!cur) return inc;
    if (cur.toLowerCase().includes(inc.toLowerCase())) return undefined; // ya está
    return `${cur}. ${inc}`;
  };

  const handleClose = useCallback(() => {
    setText('');
    setResult(null);
    setSaving(false);
    reset();
    onClose();
  }, [onClose, reset]);

  const handleInterpret = useCallback(async () => {
    // La vista previa aparece debajo del editor: al interpretar, liberar ese
    // espacio y dejar que el usuario vuelva a abrir el teclado tocando el texto.
    inputRef.current?.blur();
    Keyboard.dismiss();
    if (!text.trim()) {
      Alert.alert(t('smartOrder.missingTextTitle'), t('smartOrder.missingTextMsg'));
      return;
    }
    setResult(null);
    const r = await parse(text.trim());
    if (r) {
      // La preview y el guardado deben usar exactamente el mismo link válido.
      // Si el modelo lo omitió o añadió puntuación, recuperarlo del texto pegado.
      if (r.tool === 'create_new_client' || r.tool === 'update_client_data') {
        const mapsLink = normalizeGoogleMapsLink(r.input.mapsLink, text);
        setResult({ ...r, input: { ...r.input, mapsLink } } as ParseResult);
      } else {
        setResult(r);
      }
    }
  }, [text, parse, t]);

  const handleConfirm = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    try {
      if (result.tool === 'create_new_client') {
        const i = result.input;
        // La IA también crea documentos de cliente: respeta el límite del
        // plan free igual que el botón "+" (antes era un bypass).
        if (!canAddClient) {
          Alert.alert(
            t('smartOrder.clientLimitTitle'),
            t('smartOrder.clientLimitMsg'),
          );
          setSaving(false);
          return;
        }
        if (!isValidScheduleDate(i.freq, i.specificDate || '')) {
          Alert.alert(
            t('error'),
            t(i.specificDate ? 'smartOrder.invalidDate' : 'smartOrder.missingDate', { date: i.specificDate }),
          );
          setSaving(false);
          return;
        }
        const newVisitDay = i.visitDay ? normalizeDayName(i.visitDay) : '';
        if (i.visitDay && !newVisitDay) {
          Alert.alert(t('error'), t('smartOrder.invalidDay', { day: i.visitDay }));
          setSaving(false);
          return;
        }
        const mapsLink = normalizeGoogleMapsLink(i.mapsLink, text);
        if (hasGoogleLocationLinkText(text) && !mapsLink) {
          Alert.alert(t('error'), t('smartOrder.invalidMapsLink'));
          setSaving(false);
          return;
        }
        const created = await aiCreateClient({
          name: i.name,
          phone: sanitizePhone(i.phone || ''),
          address: i.address || '',
          mapsLink,
          notes: i.notes || '',
          products: cleanProductSet(i.products),
          freq: i.freq as Frequency,
          visitDay: newVisitDay,
          specificDate: i.specificDate || '',
        });
        if (!created) {
          Alert.alert(t('error'), t('smartOrder.createFailed'));
          setSaving(false);
          return;
        }
        const createdWithOrder = i.freq !== 'on_demand' && Boolean(i.visitDay || i.specificDate);
        Alert.alert(
          t('done'),
          t(createdWithOrder ? 'smartOrder.clientAndOrderCreated' : 'smartOrder.clientCreated', { name: i.name }),
        );
        handleClose();
        return;
      }

      if (result.tool === 'merge_products_into_order') {
        const i = result.input;
        const client = clients.find((c) => c.id === i.matched_client_id);
        if (!client) {
          Alert.alert(t('error'), t('smartOrder.clientNotFound'));
          setSaving(false);
          return;
        }
        // Partimos de los productos actuales, sumamos add_products y restamos remove_products.
        const merged: Record<string, number> = {};
        const current = (client.products || {}) as Record<string, string | number>;
        Object.entries(current).forEach(([k, v]) => {
          const n = typeof v === 'number' ? v : parseInt(String(v), 10);
          if (n > 0) merged[k] = n;
        });
        Object.entries(i.add_products || {}).forEach(([k, v]) => {
          if (v > 0) merged[k] = (merged[k] || 0) + v;
        });
        Object.entries(i.remove_products || {}).forEach(([k, v]) => {
          if (v > 0 && merged[k]) {
            const next = merged[k] - v;
            if (next > 0) merged[k] = next;
            else delete merged[k];
          }
        });
        const updates: any = { products: merged, updatedAt: new Date() };
        const nextNotes = resolveNotes(client.notes as any, i.notes, i.notes_mode, text);
        if (nextNotes !== undefined) updates.notes = nextNotes;
        const mergedOk = await updateClient(client.id, updates);
        if (!mergedOk) {
          Alert.alert(t('error'), t('smartOrder.mergeFailed'));
          setSaving(false);
          return;
        }
        const addCount = Object.keys(i.add_products || {}).length;
        const removeCount = Object.keys(i.remove_products || {}).length;
        const mergeMsgKey =
          addCount && removeCount ? 'smartOrder.mergeUpdated' :
          removeCount ? 'smartOrder.mergeTrimmed' :
          'smartOrder.mergeAdded';
        Alert.alert(t('done'), t(mergeMsgKey, { name: i.matched_client_name }));
        handleClose();
        return;
      }

      if (result.tool === 'update_client_data') {
        const i = result.input;
        const client = clients.find((c) => c.id === i.matched_client_id);
        if (!client) {
          Alert.alert(t('error'), t('smartOrder.clientNotFoundDirectory'));
          setSaving(false);
          return;
        }
        const updates: Record<string, string> = {};
        const mapsLink = normalizeGoogleMapsLink(i.mapsLink, text);
        if (hasGoogleLocationLinkText(text) && !mapsLink) {
          Alert.alert(t('error'), t('smartOrder.invalidMapsLink'));
          setSaving(false);
          return;
        }
        if (mapsLink) updates.mapsLink = mapsLink;
        if (i.address) updates.address = i.address;
        if (i.phone) updates.phone = sanitizePhone(i.phone);
        const nextNotes = resolveNotes(client.notes as any, i.notes, i.notes_mode, text);
        if (nextNotes !== undefined) updates.notes = nextNotes;
        if (Object.keys(updates).length === 0) {
          Alert.alert(t('smartOrder.noChangesTitle'), t('smartOrder.noChangesMsg'));
          setSaving(false);
          return;
        }
        const updatedOk = await updateClient(client.id, updates as any);
        if (!updatedOk) {
          Alert.alert(t('error'), t('smartOrder.updateFailed'));
          setSaving(false);
          return;
        }
        Alert.alert(t('done'), t('smartOrder.dataUpdated', { name: i.matched_client_name }));
        handleClose();
        return;
      }

      if (result.tool === 'schedule_existing_client') {
        const i = result.input;
        const client = clients.find((c) => c.id === i.matched_client_id);
        if (!client) {
          Alert.alert(t('error'), t('smartOrder.clientNotFoundRetry'));
          setSaving(false);
          return;
        }
        // Defensa contra cancelación silenciosa: si la IA pasa freq='on_demand' o vacía
        // toda la agenda (sin visitDay y sin specificDate), bloqueamos. No hay tool de
        // delete por IA — debe hacerse manualmente desde la UI para evitar accidentes.
        const isCancellation = i.freq === 'on_demand'
          || (!i.visitDay && !i.specificDate && i.freq !== 'keep' && i.freq !== 'once');
        if (isCancellation) {
          Alert.alert(
            t('smartOrder.cannotCancelTitle'),
            t('smartOrder.cannotCancelMsg'),
          );
          setSaving(false);
          return;
        }
        const schedVisitDay = i.visitDay ? normalizeDayName(i.visitDay) : '';
        if (i.visitDay && !schedVisitDay) {
          Alert.alert(t('error'), t('smartOrder.invalidDay', { day: i.visitDay }));
          setSaving(false);
          return;
        }
        let freq: Frequency = i.freq === 'keep' ? (client.freq as Frequency) : (i.freq as Frequency);
        // 'keep' sobre un cliente de directorio hereda on_demand (la guardia de
        // arriba solo bloquea el on_demand explícito). Sin fecha sería un no-op
        // silencioso con "Listo" en falso; con fecha, la intención es un pedido
        // puntual.
        if (freq === 'on_demand') {
          if (i.specificDate) {
            freq = 'once';
          } else {
            Alert.alert(t('smartOrder.nothingToScheduleTitle'), t('smartOrder.nothingToScheduleMsg'));
            setSaving(false);
            return;
          }
        }
        if (!isValidScheduleDate(freq, i.specificDate || '')) {
          Alert.alert(
            t('error'),
            t(i.specificDate ? 'smartOrder.invalidDate' : 'smartOrder.missingDate', { date: i.specificDate }),
          );
          setSaving(false);
          return;
        }
        let days = schedVisitDay ? [schedVisitDay] : (client.visitDays && client.visitDays.length ? client.visitDays : (client.visitDay ? [client.visitDay] : []));
        // Pedido periódico con fecha ("semanal a partir del sábado 11") sin día
        // explícito: el día de visita pasa a ser el de la fecha, que actúa como
        // ancla de inicio en scheduleFromDirectory.
        if (i.specificDate && !schedVisitDay && freq !== 'once') {
          const anchorDay = new Date(i.specificDate + 'T12:00:00');
          if (!isNaN(anchorDay.getTime())) {
            days = [DAY_CANON[anchorDay.getDay()]];
          }
        }
        // Resolve notes via shared resolver (supports notes_mode = clear/replace/append/keep).
        // If undefined → keep current; otherwise pass the resolved value.
        const resolvedNotes = resolveNotes(client.notes as any, i.notes, i.notes_mode, text);
        const notesToPass = resolvedNotes !== undefined ? resolvedNotes : (client.notes || '');
        // Products precedence:
        //   1. If `products` is non-empty → absolute set replacement.
        //   2. Else start from client's current products and apply add_products / remove_products.
        //   3. Else (no signals) just keep client's current products.
        const hasAbsoluteSet = i.products && typeof i.products === 'object' && Object.keys(i.products).length > 0;
        const hasDelta = (i.add_products && Object.keys(i.add_products).length > 0)
                      || (i.remove_products && Object.keys(i.remove_products).length > 0);
        let productsToPass: Record<string, number>;
        if (hasAbsoluteSet) {
          productsToPass = cleanProductSet(i.products);
        } else if (hasDelta) {
          productsToPass = {};
          const current = (client.products || {}) as Record<string, string | number>;
          Object.entries(current).forEach(([k, v]) => {
            const n = typeof v === 'number' ? v : parseInt(String(v), 10);
            if (n > 0) productsToPass[k] = n;
          });
          Object.entries(i.add_products || {}).forEach(([k, v]) => {
            if (v > 0) productsToPass[k] = (productsToPass[k] || 0) + v;
          });
          Object.entries(i.remove_products || {}).forEach(([k, v]) => {
            if (v > 0 && productsToPass[k]) {
              const next = productsToPass[k] - v;
              if (next > 0) productsToPass[k] = next;
              else delete productsToPass[k];
            }
          });
        } else {
          productsToPass = (client.products as Record<string, number>) || {};
        }
        // Default to 'replace' (move) when the AI doesn't specify schedule_mode — the AI is
        // expected to set it explicitly, but this matches the most common intent ("movélo a X").
        // If the current client is on_demand the store already updates in place regardless.
        const scheduleMode: 'add' | 'replace' = i.schedule_mode === 'add' ? 'add' : 'replace';
        const scheduledOk = await scheduleFromDirectory(
          client,
          days,
          freq,
          i.specificDate || '',
          notesToPass,
          productsToPass,
          scheduleMode,
        );
        if (!scheduledOk) {
          Alert.alert(t('error'), t('smartOrder.scheduleFailed'));
          setSaving(false);
          return;
        }
        const scheduledMsgKey = scheduleMode === 'add' ? 'smartOrder.scheduledExtra' : 'smartOrder.scheduledUpdated';
        Alert.alert(t('done'), t(scheduledMsgKey, { name: i.matched_client_name }));
        handleClose();
        return;
      }

      if (result.tool === 'add_standalone_note') {
        const i = result.input;
        if (!i.notes?.trim() || !i.specificDate) {
          Alert.alert(t('error'), t('smartOrder.noteMissing'));
          setSaving(false);
          return;
        }
        if (!isValidCalendarDate(i.specificDate)) {
          Alert.alert(t('error'), t('smartOrder.invalidDateNote', { date: i.specificDate }));
          setSaving(false);
          return;
        }
        const noteOk = await addNote(i.notes.trim(), i.specificDate);
        if (!noteOk) {
          Alert.alert(t('error'), t('smartOrder.noteFailed'));
          setSaving(false);
          return;
        }
        Alert.alert(t('done'), t('smartOrder.noteAdded', { date: formatShortDate(i.specificDate) }));
        handleClose();
        return;
      }

      // Los resultados informativos nunca llegan acá (no tienen botón de confirmar).
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || t('smartOrder.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [result, aiCreateClient, scheduleFromDirectory, updateClient, addNote, clients, canAddClient, handleClose, text, t]);

  const remainingUses = Math.max(0, usage.limit - usage.count);

  return (
    <ModalOverlay visible={visible} onClose={handleClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="sparkles" size={20} color={colors.primary} />
              <Text style={styles.headerTitle}>{t('smartOrder.title')}</Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            {/* Usage banner */}
            <View style={styles.usageBanner}>
              <Ionicons name="flash" size={14} color={colors.textMuted} />
              <Text style={styles.usageText}>
                {usage.loading
                  ? t('smartOrder.usageLoading')
                  : t('smartOrder.usageCount', { used: usage.count, limit: usage.limit })}
              </Text>
            </View>

            {/* Input */}
            <Text style={styles.sectionTitle}>{t('smartOrder.orderSection')}</Text>
            <View style={styles.inputBox}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={t('smartOrder.placeholder')}
                placeholderTextColor={colors.textHint}
                multiline
                textAlignVertical="top"
                autoCapitalize="sentences"
                accessibilityLabel={t('smartOrder.orderSection')}
              />
            </View>

            {/* Interpret button */}
            <TouchableOpacity
              style={[styles.primaryBtn, (parsing || !text.trim()) && styles.primaryBtnDisabled]}
              onPress={handleInterpret}
              disabled={parsing || !text.trim()}
              accessibilityRole="button"
              accessibilityLabel={t('smartOrder.interpretBtn')}
              accessibilityState={{ disabled: parsing || !text.trim(), busy: parsing }}
            >
              {parsing ? (
                <ActivityIndicator color={colors.textWhite} />
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color={colors.textWhite} />
                  <Text style={styles.primaryBtnText}>{t('smartOrder.interpretBtn')}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Limit reached */}
            {limitReached && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorTitle}>{t('smartOrder.limitTitle')}</Text>
                <Text style={styles.errorMsg}>
                  {t('smartOrder.limitMsg', { limit: usage.limit })}
                </Text>
              </View>
            )}

            {/* Generic error */}
            {error && !limitReached && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorTitle}>{t('smartOrder.parseErrorTitle')}</Text>
                <Text style={styles.errorMsg}>{error}</Text>
                <Text style={styles.errorHint}>{t('smartOrder.parseErrorHint')}</Text>
              </View>
            )}

            {/* Result preview */}
            {result && <ResultPreview result={result} sourceText={text} colors={colors} styles={styles} />}
          </ScrollView>

          {/* Footer with confirm/cancel */}
          {result && result.tool !== 'report_not_found' && result.tool !== 'report_no_action' && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setResult(null)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={t('back')}
                accessibilityState={{ disabled: saving }}
              >
                <Text style={styles.secondaryBtnText}>{t('back')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, saving && styles.primaryBtnDisabled]}
                onPress={handleConfirm}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={t('smartOrder.confirmBtn')}
                accessibilityState={{ disabled: saving, busy: saving }}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textWhite} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={colors.textWhite} />
                    <Text style={styles.confirmBtnText}>{t('smartOrder.confirmBtn')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {result && (result.tool === 'report_not_found' || result.tool === 'report_no_action') && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.confirmBtn, { flex: 1 }]}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel={t('smartOrder.understoodBtn')}
              >
                <Text style={styles.confirmBtnText}>{t('smartOrder.understoodBtn')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

// ---------- ResultPreview ----------

interface PreviewProps {
  result: ParseResult;
  sourceText: string;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
}

const ResultPreview: React.FC<PreviewProps> = ({ result, sourceText, colors, styles }) => {
  const { t } = useTranslation();
  if (result.tool === 'report_no_action') {
    return (
      <View style={[styles.resultBox, { borderColor: colors.warning }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="information-circle" size={20} color={colors.warning} />
          <Text style={styles.resultTitle}>{t('smartOrder.noActionTitle')}</Text>
        </View>
        <Text style={styles.resultText}>{result.input.message}</Text>
      </View>
    );
  }

  if (result.tool === 'report_not_found') {
    return (
      <View style={[styles.resultBox, { borderColor: colors.warning }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="alert-circle" size={20} color={colors.warning} />
          <Text style={styles.resultTitle}>{t('smartOrder.notFoundTitle')}</Text>
        </View>
        <Text style={styles.resultText}>
          {t('smartOrder.notFoundMsg', { name: result.input.mentioned_name })}
        </Text>
        <Text style={[styles.resultText, { marginTop: 6, color: colors.textMuted }]}>
          {result.input.reason}
        </Text>
      </View>
    );
  }

  if (result.tool === 'add_standalone_note') {
    const i = result.input;
    return (
      <View style={[styles.resultBox, { borderColor: colors.primary }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="document-text" size={20} color={colors.primary} />
          <Text style={styles.resultTitle}>{t('smartOrder.standaloneNoteTitle')}</Text>
        </View>
        <Text style={[styles.resultText, { color: colors.textMuted, marginBottom: 8 }]}>
          {t('smartOrder.standaloneNoteSubtitle')}
        </Text>
        <Field label={t('smartOrder.fieldDate')} value={formatShortDate(i.specificDate)} styles={styles} />
        <Field label={t('smartOrder.fieldNote')} value={i.notes} styles={styles} />
      </View>
    );
  }

  if (result.tool === 'merge_products_into_order') {
    const i = result.input;
    const addEntries = Object.entries(i.add_products || {}).filter(([_, v]) => v > 0);
    const removeEntries = Object.entries(i.remove_products || {}).filter(([_, v]) => v > 0);
    const onlyRemoves = addEntries.length === 0 && removeEntries.length > 0;
    const headerText = onlyRemoves
      ? t('smartOrder.mergeRemoveTitle', { name: i.matched_client_name })
      : addEntries.length && removeEntries.length
        ? t('smartOrder.mergeModifyTitle', { name: i.matched_client_name })
        : t('smartOrder.mergeAddTitle', { name: i.matched_client_name });
    const subtitle = onlyRemoves
      ? t('smartOrder.mergeRemoveSubtitle')
      : addEntries.length && removeEntries.length
        ? t('smartOrder.mergeModifySubtitle')
        : t('smartOrder.mergeAddSubtitle');
    return (
      <View style={[styles.resultBox, { borderColor: colors.primary }]}>
        <View style={styles.resultHeader}>
          <Ionicons name={onlyRemoves ? 'remove-circle' : 'add-circle'} size={20} color={colors.primary} />
          <Text style={styles.resultTitle}>{headerText}</Text>
        </View>
        <Text style={[styles.resultText, { color: colors.textMuted, marginBottom: 8 }]}>
          {subtitle}
        </Text>
        {addEntries.length > 0 && (
          <View>
            <Text style={[styles.fieldLabel, { color: colors.success }]}>{t('smartOrder.addLabel')}</Text>
            <ProductsList products={i.add_products} styles={styles} />
          </View>
        )}
        {removeEntries.length > 0 && (
          <View style={{ marginTop: addEntries.length ? 8 : 0 }}>
            <Text style={[styles.fieldLabel, { color: colors.warning }]}>{t('smartOrder.removeLabel')}</Text>
            <ProductsList products={i.remove_products} styles={styles} />
          </View>
        )}
        {i.notes_mode === 'clear' ? (
          <Field label={t('smartOrder.fieldNotes')} value={t('smartOrder.clearNotesValue')} styles={styles} />
        ) : i.notes && !looksLikeAutoDescription(i.notes) ? (
          <Field label={t('smartOrder.fieldNotes')} value={i.notes} styles={styles} />
        ) : null}
      </View>
    );
  }

  if (result.tool === 'update_client_data') {
    const i = result.input;
    const mapsLink = normalizeGoogleMapsLink(i.mapsLink, sourceText);
    return (
      <View style={[styles.resultBox, { borderColor: colors.primary }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="create" size={20} color={colors.primary} />
          <Text style={styles.resultTitle}>{t('smartOrder.updateTitle', { name: i.matched_client_name })}</Text>
        </View>
        {mapsLink ? <Field label="Maps" value={mapsLink} styles={styles} /> : null}
        {i.address ? <Field label={t('smartOrder.fieldAddress')} value={i.address} styles={styles} /> : null}
        {i.phone ? <Field label={t('smartOrder.fieldPhone')} value={i.phone} styles={styles} /> : null}
        {i.notes_mode === 'clear' ? (
          <Field label={t('smartOrder.fieldNotes')} value={t('smartOrder.clearNotesValue')} styles={styles} />
        ) : i.notes && !looksLikeAutoDescription(i.notes) ? (
          <Field label={t('smartOrder.fieldNotes')} value={i.notes} styles={styles} />
        ) : null}
      </View>
    );
  }

  if (result.tool === 'create_new_client') {
    const i = result.input;
    const mapsLink = normalizeGoogleMapsLink(i.mapsLink, sourceText);
    return (
      <View style={[styles.resultBox, { borderColor: colors.primary }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="person-add" size={20} color={colors.primary} />
          <Text style={styles.resultTitle}>{t('smartOrder.newClientTitle', { name: i.name })}</Text>
        </View>
        {i.address ? <Field label={t('smartOrder.fieldAddress')} value={i.address} styles={styles} /> : null}
        {mapsLink ? <Field label="Maps" value={mapsLink} styles={styles} /> : null}
        {i.phone ? <Field label={t('smartOrder.fieldPhone')} value={i.phone} styles={styles} /> : null}
        <Field label={t('smartOrder.fieldFreq')} value={getFreqLabel(i.freq)} styles={styles} />
        {i.visitDay ? <Field label={t('smartOrder.fieldDay')} value={getDayLabel(i.visitDay)} styles={styles} /> : null}
        {i.specificDate ? <Field label={t('smartOrder.fieldDate')} value={formatShortDate(i.specificDate)} styles={styles} /> : null}
        <ProductsList products={i.products} styles={styles} />
        {i.notes && !looksLikeAutoDescription(i.notes) ? <Field label={t('smartOrder.fieldNotes')} value={i.notes} styles={styles} /> : null}
      </View>
    );
  }

  // schedule_existing_client
  const i = result.input;
  const isExtra = i.schedule_mode === 'add';
  const hasAbsolute = i.products && Object.keys(i.products).length > 0;
  const addEntries = Object.entries(i.add_products || {}).filter(([_, v]) => v > 0);
  const removeEntries = Object.entries(i.remove_products || {}).filter(([_, v]) => v > 0);
  const showClearNotes = i.notes_mode === 'clear';
  const showIncomingNotes = !showClearNotes && i.notes && !looksLikeAutoDescription(i.notes);
  return (
    <View style={[styles.resultBox, { borderColor: colors.primary }]}>
      <View style={styles.resultHeader}>
        <Ionicons name="calendar" size={20} color={colors.primary} />
        <Text style={styles.resultTitle}>{i.matched_client_name}</Text>
      </View>
      <Text style={[styles.resultText, { color: colors.textMuted, marginBottom: 8 }]}>
        {isExtra ? t('smartOrder.extraSubtitle') : t('smartOrder.moveSubtitle')}
      </Text>
      {i.freq && i.freq !== 'keep' && (
        <Field label={t('smartOrder.fieldFreq')} value={getFreqLabel(i.freq)} styles={styles} />
      )}
      {i.visitDay ? <Field label={t('smartOrder.fieldDay')} value={getDayLabel(i.visitDay)} styles={styles} /> : null}
      {i.specificDate ? <Field label={t('smartOrder.fieldDate')} value={formatShortDate(i.specificDate)} styles={styles} /> : null}
      {hasAbsolute && <ProductsList products={i.products} styles={styles} />}
      {addEntries.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.fieldLabel, { color: colors.success }]}>{t('smartOrder.addLabel')}</Text>
          <ProductsList products={i.add_products || {}} styles={styles} />
        </View>
      )}
      {removeEntries.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.fieldLabel, { color: colors.warning }]}>{t('smartOrder.removeLabel')}</Text>
          <ProductsList products={i.remove_products || {}} styles={styles} />
        </View>
      )}
      {showClearNotes && <Field label={t('smartOrder.fieldNotes')} value={t('smartOrder.clearNotesValue')} styles={styles} />}
      {showIncomingNotes && <Field label={t('smartOrder.fieldNotes')} value={i.notes} styles={styles} />}
    </View>
  );
};

const Field: React.FC<{ label: string; value: string; styles: ReturnType<typeof getStyles> }> = ({ label, value, styles }) => (
  <View style={styles.fieldRow}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Text style={styles.fieldValue}>{value}</Text>
  </View>
);

const ProductsList: React.FC<{ products: Record<string, number>; styles: ReturnType<typeof getStyles> }> = ({ products, styles }) => {
  const { t } = useTranslation();
  const allProducts = useAllProducts();
  const { fontScale } = useLayout();
  const entries = Object.entries(products || {}).filter(([_, v]) => v > 0);
  if (entries.length === 0) return null;
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={styles.fieldLabel}>{t('smartOrder.fieldProducts')}</Text>
      {entries.map(([id, qty]) => {
        const p = allProducts.find((x) => x.id === id);
        return (
          <View key={id} style={styles.productLine}>
            <ProductLabel
              value={p?.emoji || '•'}
              label={p?.label || id}
              size={Math.round(16 * fontScale)}
              style={styles.productLineText}
            />
            <Text style={styles.productQty}>× {qty}</Text>
          </View>
        );
      })}
    </View>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: isTablet ? 'center' : 'flex-end',
      alignItems: 'center',
      paddingHorizontal: isTablet ? 24 : 8,
      paddingVertical: isTablet ? 24 : 0,
    },
    modal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: s(20),
      borderTopRightRadius: s(20),
      borderBottomLeftRadius: isTablet ? s(20) : 0,
      borderBottomRightRadius: isTablet ? s(20) : 0,
      maxHeight: Platform.OS === 'android' ? '100%' : '90%',
      maxWidth: isTablet ? undefined : 600,
      alignSelf: 'center' as const,
      width: isTablet ? modalWidth : ('100%' as const),
      overflow: 'hidden' as const,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: s(16),
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: {
      fontSize: s(20),
      fontWeight: '700',
      color: colors.textPrimary,
    },
    closeBtn: {
      width: s(32),
      height: s(32),
      borderRadius: s(16),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeBtnText: {
      fontSize: s(18),
      color: colors.textMuted,
    },
    body: {
      padding: s(16),
    },
    usageBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(6),
      paddingHorizontal: s(10),
      paddingVertical: s(6),
      backgroundColor: colors.sectionBackground,
      borderRadius: s(8),
      alignSelf: 'flex-start',
      marginBottom: s(14),
    },
    usageText: {
      fontSize: s(12),
      color: colors.textMuted,
      fontWeight: '600',
    },
    sectionTitle: {
      fontSize: s(13),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: s(8),
    },
    inputBox: {
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.inputBorder,
      padding: s(12),
      minHeight: 110,
    },
    input: {
      fontSize: s(16),
      color: colors.textPrimary,
      padding: 0,
      minHeight: 100,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(8),
      backgroundColor: colors.primary,
      paddingVertical: s(14),
      borderRadius: s(10),
      marginTop: s(14),
    },
    primaryBtnDisabled: {
      opacity: 0.5,
    },
    primaryBtnText: {
      color: colors.textWhite,
      fontSize: s(16),
      fontWeight: '700',
    },
    errorBox: {
      marginTop: s(16),
      padding: s(12),
      borderRadius: s(10),
      backgroundColor: colors.warningLightBg || '#FEF3C7',
      borderWidth: 1,
      borderColor: colors.warning || '#F59E0B',
    },
    errorTitle: {
      fontSize: s(14),
      fontWeight: '700',
      color: colors.warningOrangeText || '#92400E',
      marginBottom: s(4),
    },
    errorMsg: {
      fontSize: s(13),
      color: colors.textSecondary,
    },
    errorHint: {
      fontSize: s(12),
      color: colors.textMuted,
      marginTop: s(6),
      fontStyle: 'italic',
    },
    resultBox: {
      marginTop: s(16),
      padding: s(14),
      borderRadius: s(12),
      backgroundColor: colors.sectionBackground,
      borderWidth: 1.5,
    },
    resultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
      marginBottom: s(10),
    },
    resultTitle: {
      fontSize: s(17),
      fontWeight: '700',
      color: colors.textPrimary,
      flex: 1,
    },
    resultText: {
      fontSize: s(14),
      color: colors.textSecondary,
    },
    fieldRow: {
      flexDirection: 'row',
      paddingVertical: s(4),
      gap: s(8),
    },
    fieldLabel: {
      fontSize: s(13),
      fontWeight: '600',
      color: colors.textMuted,
      width: 90,
    },
    fieldValue: {
      flex: 1,
      fontSize: s(14),
      color: colors.textPrimary,
    },
    productLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: s(4),
      paddingLeft: s(4),
    },
    productLineText: {
      fontSize: s(14),
      color: colors.textPrimary,
    },
    productQty: {
      fontSize: s(14),
      fontWeight: '700',
      color: colors.primary,
    },
    footer: {
      flexDirection: 'row',
      gap: s(8),
      padding: s(16),
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    secondaryBtn: {
      paddingHorizontal: s(18),
      paddingVertical: s(14),
      borderRadius: s(10),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
    },
    secondaryBtnText: {
      fontSize: s(15),
      fontWeight: '600',
      color: colors.textSecondary,
    },
    confirmBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(8),
      backgroundColor: colors.primary,
      paddingVertical: s(14),
      borderRadius: s(10),
    },
    confirmBtnText: {
      color: colors.textWhite,
      fontSize: s(16),
      fontWeight: '700',
    },
  });
};

export default SmartOrderModal;
