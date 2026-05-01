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
import { useAiParse, ParseResult } from '../hooks/useAiParse';
import { useAiUsageStore } from '../stores/aiUsageStore';
import { useClientsStore } from '../stores/clientsStore';

interface SmartOrderModalProps {
  visible: boolean;
  onClose: () => void;
}

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
  const clients = useClientsStore((s) => s.clients);

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
        // Sumar productos nuevos a los existentes
        const merged: Record<string, number> = {};
        const current = (client.products || {}) as Record<string, string | number>;
        Object.entries(current).forEach(([k, v]) => {
          const n = typeof v === 'number' ? v : parseInt(String(v), 10);
          if (n > 0) merged[k] = n;
        });
        Object.entries(i.add_products || {}).forEach(([k, v]) => {
          if (v > 0) merged[k] = (merged[k] || 0) + v;
        });
        const updates: any = { products: merged, updatedAt: new Date() };
        if (i.notes) updates.notes = i.notes;
        console.log('[merge] clientId:', client.id, 'name:', client.name, 'freq:', client.freq, 'visitDay:', client.visitDay);
        console.log('[merge] current products:', client.products);
        console.log('[merge] add products:', i.add_products);
        console.log('[merge] merged result:', merged);
        await updateClient(client.id, updates);
        Alert.alert('Listo', `Productos agregados al pedido de ${i.matched_client_name}.`);
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
        if (i.notes) updates.notes = i.notes;
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
        const days = i.visitDay ? [i.visitDay] : (client.visitDays && client.visitDays.length ? client.visitDays : (client.visitDay ? [client.visitDay] : []));
        const freq: Frequency = i.freq === 'keep' ? (client.freq as Frequency) : (i.freq as Frequency);
        await scheduleFromDirectory(
          client,
          days,
          freq,
          i.specificDate || '',
          i.notes || client.notes || '',
          i.products || (client.products as Record<string, number>) || {},
        );
        Alert.alert('Listo', `Pedido agendado para ${i.matched_client_name}.`);
        handleClose();
        return;
      }

      // report_not_found nunca llega acá (no hay botón de confirmar)
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar el pedido.');
    } finally {
      setSaving(false);
    }
  }, [result, aiCreateClient, scheduleFromDirectory, updateClient, clients, handleClose]);

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

  if (result.tool === 'merge_products_into_order') {
    const i = result.input;
    return (
      <View style={[styles.resultBox, { borderColor: colors.primary }]}>
        <View style={styles.resultHeader}>
          <Ionicons name="add-circle" size={20} color={colors.primary} />
          <Text style={styles.resultTitle}>Sumar al pedido: {i.matched_client_name}</Text>
        </View>
        <Text style={[styles.resultText, { color: colors.textMuted, marginBottom: 8 }]}>
          Se agregan estos productos al pedido pendiente (sin tocar día ni frecuencia).
        </Text>
        <ProductsList products={i.add_products} styles={styles} />
        {i.notes ? <Field label="Notas" value={i.notes} styles={styles} /> : null}
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
        {i.notes ? <Field label="Notas" value={i.notes} styles={styles} /> : null}
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
        {i.notes ? <Field label="Notas" value={i.notes} styles={styles} /> : null}
      </View>
    );
  }

  // schedule_existing_client
  const i = result.input;
  return (
    <View style={[styles.resultBox, { borderColor: colors.primary }]}>
      <View style={styles.resultHeader}>
        <Ionicons name="calendar" size={20} color={colors.primary} />
        <Text style={styles.resultTitle}>{i.matched_client_name}</Text>
      </View>
      <Text style={[styles.resultText, { color: colors.textMuted, marginBottom: 8 }]}>
        Cliente del directorio
      </Text>
      {i.freq && i.freq !== 'keep' && (
        <Field label="Frecuencia" value={FREQUENCY_LABELS[i.freq as Frequency] || i.freq} styles={styles} />
      )}
      {i.visitDay ? <Field label="Día" value={i.visitDay} styles={styles} /> : null}
      {i.specificDate ? <Field label="Fecha" value={i.specificDate} styles={styles} /> : null}
      <ProductsList products={i.products} styles={styles} />
      {i.notes ? <Field label="Notas" value={i.notes} styles={styles} /> : null}
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
