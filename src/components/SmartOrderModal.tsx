import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ModalOverlay from './ModalOverlay';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { PRODUCTS, FREQUENCY_LABELS, Frequency } from '../constants/products';
import { getModalWidth } from '../utils/helpers';
import { useAiParse, ParseResult, NotesMode } from '../hooks/useAiParse';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { useClientsStore } from '../stores/clientsStore';

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

const SmartOrderModal: React.FC<SmartOrderModalProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = useMemo(() => getStyles(colors, isTablet, modalWidth), [colors, isTablet, modalWidth]);

  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [saving, setSaving] = useState(false);

  const { parsing, parse, error, limitReached, reset } = useAiParse();
  const usage = useAiUsageStore();
  const aiCreateClient = useClientsStore((s) => s.aiCreateClient);
  const scheduleFromDirectory = useClientsStore((s) => s.scheduleFromDirectory);
  const updateClient = useClientsStore((s) => s.updateClient);
  const addNote = useClientsStore((s) => s.addNote);
  const clients = useClientsStore((s) => s.clients);

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
    if (!text.trim()) {
      Alert.alert('Falta texto', 'Pegá o escribí el pedido para que la IA lo interprete.');
      return;
    }
    setResult(null);
    const r = await parse(text.trim());
    if (r) setResult(r);
  }, [text, parse]);

  const handleConfirm = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    try {
      if (result.tool === 'create_new_client') {
        const i = result.input;
        await aiCreateClient({
          name: i.name,
          phone: i.phone || '',
          address: i.address || '',
          mapsLink: i.mapsLink || '',
          notes: i.notes || '',
          products: i.products || {},
          freq: i.freq as Frequency,
          visitDay: i.visitDay || '',
          specificDate: i.specificDate || '',
        });
        Alert.alert('Listo', `Cliente "${i.name}" creado.`);
        handleClose();
        return;
      }

      if (result.tool === 'merge_products_into_order') {
        const i = result.input;
        const client = clients.find((c) => c.id === i.matched_client_id);
        if (!client) {
          Alert.alert('Error', 'No se encontró el cliente.');
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
        await updateClient(client.id, updates);
        const addCount = Object.keys(i.add_products || {}).length;
        const removeCount = Object.keys(i.remove_products || {}).length;
        const verb =
          addCount && removeCount ? 'actualizado' :
          removeCount ? 'recortado' :
          'agregado';
        Alert.alert('Listo', `Pedido de ${i.matched_client_name} ${verb}.`);
        handleClose();
        return;
      }

      if (result.tool === 'update_client_data') {
        const i = result.input;
        const client = clients.find((c) => c.id === i.matched_client_id);
        if (!client) {
          Alert.alert('Error', 'No se encontró el cliente en el directorio actual.');
          setSaving(false);
          return;
        }
        const updates: Record<string, string> = {};
        if (i.mapsLink) updates.mapsLink = i.mapsLink;
        if (i.address) updates.address = i.address;
        if (i.phone) updates.phone = i.phone;
        const nextNotes = resolveNotes(client.notes as any, i.notes, i.notes_mode, text);
        if (nextNotes !== undefined) updates.notes = nextNotes;
        if (Object.keys(updates).length === 0) {
          Alert.alert('Sin cambios', 'No detecté ningún dato para actualizar.');
          setSaving(false);
          return;
        }
        await updateClient(client.id, updates as any);
        Alert.alert('Listo', `Datos de ${i.matched_client_name} actualizados.`);
        handleClose();
        return;
      }

      if (result.tool === 'schedule_existing_client') {
        const i = result.input;
        const client = clients.find((c) => c.id === i.matched_client_id);
        if (!client) {
          Alert.alert('Error', 'No se encontró el cliente en el directorio actual. Probá de nuevo.');
          setSaving(false);
          return;
        }
        // Defensa contra cancelación silenciosa: si la IA pasa freq='on_demand' o vacía
        // toda la agenda (sin visitDay y sin specificDate), bloqueamos. No hay tool de
        // delete por IA — debe hacerse manualmente desde la UI para evitar accidentes.
        const isCancellation = i.freq === 'on_demand'
          || (!i.visitDay && !i.specificDate && i.freq !== 'keep');
        if (isCancellation) {
          Alert.alert(
            'No se puede cancelar por IA',
            'Para borrar o cancelar un pedido, usá los botones de la app (Eliminar / Completar / Quitar del día). La IA no tiene permitido eliminar.',
          );
          setSaving(false);
          return;
        }
        const days = i.visitDay ? [i.visitDay] : (client.visitDays && client.visitDays.length ? client.visitDays : (client.visitDay ? [client.visitDay] : []));
        const freq: Frequency = i.freq === 'keep' ? (client.freq as Frequency) : (i.freq as Frequency);
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
          productsToPass = i.products;
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
        await scheduleFromDirectory(
          client,
          days,
          freq,
          i.specificDate || '',
          notesToPass,
          productsToPass,
          scheduleMode,
        );
        const verb = scheduleMode === 'add' ? 'agendado (extra)' : 'actualizado';
        Alert.alert('Listo', `Pedido de ${i.matched_client_name} ${verb}.`);
        handleClose();
        return;
      }

      if (result.tool === 'add_standalone_note') {
        const i = result.input;
        if (!i.notes?.trim() || !i.specificDate) {
          Alert.alert('Error', 'No se pudo crear la nota: falta texto o fecha.');
          setSaving(false);
          return;
        }
        await addNote(i.notes.trim(), i.specificDate);
        Alert.alert('Listo', `Nota agregada para ${i.specificDate}.`);
        handleClose();
        return;
      }

      // report_not_found nunca llega acá (no hay botón de confirmar)
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar el pedido.');
    } finally {
      setSaving(false);
    }
  }, [result, aiCreateClient, scheduleFromDirectory, updateClient, addNote, clients, handleClose, text]);

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
              <Text style={styles.headerTitle}>Pedido inteligente</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Usage banner */}
            <View style={styles.usageBanner}>
              <Ionicons name="flash" size={14} color={colors.textMuted} />
              <Text style={styles.usageText}>
                {usage.loading ? 'Cargando uso...' : `${usage.count} / ${usage.limit} parseos este mes`}
              </Text>
            </View>

            {/* Input */}
            <Text style={styles.sectionTitle}>Pedido</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="Ej: Juan García, Belgrano 432, los lunes 2 botellones de 20L y un sifón soda."
                placeholderTextColor={colors.textHint}
                multiline
                textAlignVertical="top"
                autoCapitalize="sentences"
              />
            </View>

            {/* Interpret button */}
            <TouchableOpacity
              style={[styles.primaryBtn, (parsing || !text.trim()) && styles.primaryBtnDisabled]}
              onPress={handleInterpret}
              disabled={parsing || !text.trim()}
            >
              {parsing ? (
                <ActivityIndicator color={colors.textWhite} />
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color={colors.textWhite} />
                  <Text style={styles.primaryBtnText}>Interpretar con IA</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Limit reached */}
            {limitReached && (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>Llegaste al límite del mes</Text>
                <Text style={styles.errorMsg}>
                  Ya usaste tus {usage.limit} parseos de IA. Podés seguir cargando pedidos a mano y vuelve a estar disponible el 1° del próximo mes.
                </Text>
              </View>
            )}

            {/* Generic error */}
            {error && !limitReached && (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>Error al interpretar</Text>
                <Text style={styles.errorMsg}>{error}</Text>
                <Text style={styles.errorHint}>Verificá que el servidor local esté corriendo en puerto 3000.</Text>
              </View>
            )}

            {/* Result preview */}
            {result && <ResultPreview result={result} colors={colors} styles={styles} />}
          </ScrollView>

          {/* Footer with confirm/cancel */}
          {result && result.tool !== 'report_not_found' && (
            <View style={styles.footer}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setResult(null)} disabled={saving}>
                <Text style={styles.secondaryBtnText}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, saving && styles.primaryBtnDisabled]}
                onPress={handleConfirm}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textWhite} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={colors.textWhite} />
                    <Text style={styles.confirmBtnText}>Confirmar y guardar</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {result && result.tool === 'report_not_found' && (
            <View style={styles.footer}>
              <TouchableOpacity style={[styles.confirmBtn, { flex: 1 }]} onPress={handleClose}>
                <Text style={styles.confirmBtnText}>Entendido</Text>
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
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
}

const ResultPreview: React.FC<PreviewProps> = ({ result, colors, styles }) => {
  if (result.tool === 'report_not_found') {
    return (
      <View style={[styles.resultBox, { borderColor: colors.warning }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="alert-circle" size={20} color={colors.warning} />
          <Text style={styles.resultTitle}>Cliente no encontrado</Text>
        </View>
        <Text style={styles.resultText}>
          No encontré a "{result.input.mentioned_name}" en tu directorio.
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
          <Text style={styles.resultTitle}>Nota suelta del día</Text>
        </View>
        <Text style={[styles.resultText, { color: colors.textMuted, marginBottom: 8 }]}>
          Recordatorio sin cliente asociado.
        </Text>
        <Field label="Fecha" value={i.specificDate} styles={styles} />
        <Field label="Nota" value={i.notes} styles={styles} />
      </View>
    );
  }

  if (result.tool === 'merge_products_into_order') {
    const i = result.input;
    const addEntries = Object.entries(i.add_products || {}).filter(([_, v]) => v > 0);
    const removeEntries = Object.entries(i.remove_products || {}).filter(([_, v]) => v > 0);
    const onlyRemoves = addEntries.length === 0 && removeEntries.length > 0;
    const headerText = onlyRemoves
      ? `Quitar del pedido: ${i.matched_client_name}`
      : addEntries.length && removeEntries.length
        ? `Modificar pedido: ${i.matched_client_name}`
        : `Sumar al pedido: ${i.matched_client_name}`;
    const subtitle = onlyRemoves
      ? 'Se quitan estos productos del pedido pendiente (sin tocar día ni frecuencia).'
      : addEntries.length && removeEntries.length
        ? 'Se ajustan los productos del pedido pendiente (sin tocar día ni frecuencia).'
        : 'Se agregan estos productos al pedido pendiente (sin tocar día ni frecuencia).';
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
            <Text style={[styles.fieldLabel, { color: colors.success }]}>Sumar</Text>
            <ProductsList products={i.add_products} styles={styles} />
          </View>
        )}
        {removeEntries.length > 0 && (
          <View style={{ marginTop: addEntries.length ? 8 : 0 }}>
            <Text style={[styles.fieldLabel, { color: colors.warning }]}>Quitar</Text>
            <ProductsList products={i.remove_products} styles={styles} />
          </View>
        )}
        {i.notes_mode === 'clear' ? (
          <Field label="Notas" value="(borrar)" styles={styles} />
        ) : i.notes && !looksLikeAutoDescription(i.notes) ? (
          <Field label="Notas" value={i.notes} styles={styles} />
        ) : null}
      </View>
    );
  }

  if (result.tool === 'update_client_data') {
    const i = result.input;
    return (
      <View style={[styles.resultBox, { borderColor: colors.primary }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="create" size={20} color={colors.primary} />
          <Text style={styles.resultTitle}>Actualizar: {i.matched_client_name}</Text>
        </View>
        {i.mapsLink ? <Field label="Maps" value={i.mapsLink} styles={styles} /> : null}
        {i.address ? <Field label="Dirección" value={i.address} styles={styles} /> : null}
        {i.phone ? <Field label="Teléfono" value={i.phone} styles={styles} /> : null}
        {i.notes_mode === 'clear' ? (
          <Field label="Notas" value="(borrar)" styles={styles} />
        ) : i.notes && !looksLikeAutoDescription(i.notes) ? (
          <Field label="Notas" value={i.notes} styles={styles} />
        ) : null}
      </View>
    );
  }

  if (result.tool === 'create_new_client') {
    const i = result.input;
    return (
      <View style={[styles.resultBox, { borderColor: colors.primary }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="person-add" size={20} color={colors.primary} />
          <Text style={styles.resultTitle}>Cliente nuevo: {i.name}</Text>
        </View>
        {i.address ? <Field label="Dirección" value={i.address} styles={styles} /> : null}
        {i.mapsLink ? <Field label="Maps" value={i.mapsLink} styles={styles} /> : null}
        {i.phone ? <Field label="Teléfono" value={i.phone} styles={styles} /> : null}
        <Field label="Frecuencia" value={FREQUENCY_LABELS[i.freq as Frequency] || i.freq} styles={styles} />
        {i.visitDay ? <Field label="Día" value={i.visitDay} styles={styles} /> : null}
        {i.specificDate ? <Field label="Fecha" value={i.specificDate} styles={styles} /> : null}
        <ProductsList products={i.products} styles={styles} />
        {i.notes && !looksLikeAutoDescription(i.notes) ? <Field label="Notas" value={i.notes} styles={styles} /> : null}
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
        {isExtra ? 'Agendar pedido EXTRA (no reemplaza el actual)' : 'Mover/actualizar el pedido existente'}
      </Text>
      {i.freq && i.freq !== 'keep' && (
        <Field label="Frecuencia" value={FREQUENCY_LABELS[i.freq as Frequency] || i.freq} styles={styles} />
      )}
      {i.visitDay ? <Field label="Día" value={i.visitDay} styles={styles} /> : null}
      {i.specificDate ? <Field label="Fecha" value={i.specificDate} styles={styles} /> : null}
      {hasAbsolute && <ProductsList products={i.products} styles={styles} />}
      {addEntries.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.fieldLabel, { color: colors.success }]}>Sumar</Text>
          <ProductsList products={i.add_products || {}} styles={styles} />
        </View>
      )}
      {removeEntries.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.fieldLabel, { color: colors.warning }]}>Quitar</Text>
          <ProductsList products={i.remove_products || {}} styles={styles} />
        </View>
      )}
      {showClearNotes && <Field label="Notas" value="(borrar)" styles={styles} />}
      {showIncomingNotes && <Field label="Notas" value={i.notes} styles={styles} />}
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
  const entries = Object.entries(products || {}).filter(([_, v]) => v > 0);
  if (entries.length === 0) return null;
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={styles.fieldLabel}>Productos</Text>
      {entries.map(([id, qty]) => {
        const p = PRODUCTS.find((x) => x.id === id);
        return (
          <View key={id} style={styles.productLine}>
            <Text style={styles.productLineText}>
              {p?.emoji || '•'} {p?.label || id}
            </Text>
            <Text style={styles.productQty}>× {qty}</Text>
          </View>
        );
      })}
    </View>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number) =>
  StyleSheet.create({
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
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderBottomLeftRadius: isTablet ? 20 : 0,
      borderBottomRightRadius: isTablet ? 20 : 0,
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
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeBtnText: {
      fontSize: 18,
      color: colors.textMuted,
    },
    body: {
      padding: 16,
    },
    usageBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.sectionBackground,
      borderRadius: 8,
      alignSelf: 'flex-start',
      marginBottom: 14,
    },
    usageText: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: '600',
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    inputBox: {
      backgroundColor: colors.inputBackground,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      padding: 12,
      minHeight: 110,
    },
    input: {
      fontSize: 16,
      color: colors.textPrimary,
      padding: 0,
      minHeight: 100,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 10,
      marginTop: 14,
    },
    primaryBtnDisabled: {
      opacity: 0.5,
    },
    primaryBtnText: {
      color: colors.textWhite,
      fontSize: 16,
      fontWeight: '700',
    },
    errorBox: {
      marginTop: 16,
      padding: 12,
      borderRadius: 10,
      backgroundColor: colors.warningLightBg || '#FEF3C7',
      borderWidth: 1,
      borderColor: colors.warning || '#F59E0B',
    },
    errorTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.warningOrangeText || '#92400E',
      marginBottom: 4,
    },
    errorMsg: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    errorHint: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 6,
      fontStyle: 'italic',
    },
    resultBox: {
      marginTop: 16,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.sectionBackground,
      borderWidth: 1.5,
    },
    resultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    resultTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      flex: 1,
    },
    resultText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    fieldRow: {
      flexDirection: 'row',
      paddingVertical: 4,
      gap: 8,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      width: 90,
    },
    fieldValue: {
      flex: 1,
      fontSize: 14,
      color: colors.textPrimary,
    },
    productLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
      paddingLeft: 4,
    },
    productLineText: {
      fontSize: 14,
      color: colors.textPrimary,
    },
    productQty: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary,
    },
    footer: {
      flexDirection: 'row',
      gap: 8,
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    secondaryBtn: {
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
    },
    secondaryBtnText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    confirmBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 10,
    },
    confirmBtnText: {
      color: colors.textWhite,
      fontSize: 16,
      fontWeight: '700',
    },
  });

export default SmartOrderModal;
