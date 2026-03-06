import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';
import { FREQUENCY_LABELS, Frequency } from '../constants/products';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface EditClientModalProps {
  visible: boolean;
  client: Client | null;
  onSave: (clientId: string, data: Partial<Client>) => void;
  onClose: () => void;
  showClientInfo?: boolean;
}

const EditClientModal: React.FC<EditClientModalProps> = ({
  visible,
  client,
  onSave,
  onClose,
  showClientInfo = false,
}) => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  const [products, setProducts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [freq, setFreq] = useState<Frequency>('weekly');
  const [startDate, setStartDate] = useState<string>('');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (client) {
      setName(client.name || '');
      setAddress(client.address || '');
      setPhone(client.phone || '');
      setMapsLink(client.mapsLink || '');
      // Initialize products from client data
      const prods: Record<string, number> = {};
      PRODUCTS.forEach((p) => {
        prods[p.id] = parseInt(String(client.products?.[p.id] || 0), 10);
      });
      setProducts(prods);
      setNotes(client.notes || '');
      setFreq(client.freq || 'weekly');
      setStartDate(client.specificDate || '');
      if (client.specificDate) {
        setPickerDate(new Date(client.specificDate + 'T12:00:00'));
      } else {
        setPickerDate(new Date());
      }
      setShowDatePicker(false);
    }
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!client) return null;

  const needsDate = freq === 'once' || freq === 'weekly' || freq === 'biweekly' || freq === 'triweekly' || freq === 'monthly';

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      if (selectedDate.getDay() === 0) {
        Alert.alert('Error', 'No se puede agendar en Domingo');
        return;
      }
      setPickerDate(selectedDate);
      const yyyy = selectedDate.getFullYear();
      const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(selectedDate.getDate()).padStart(2, '0');
      setStartDate(`${yyyy}-${mm}-${dd}`);
    }
  };

  const formatDisplayDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${dayNames[d.getDay()]} ${d.getDate()} de ${monthNames[d.getMonth()]}`;
  };

  const handleSave = async () => {
    const cleanProducts: Record<string, number> = {};
    Object.entries(products).forEach(([key, val]) => {
      if (val > 0) cleanProducts[key] = val;
    });
    const data: Partial<Client> = {
      products: cleanProducts,
      notes,
      freq,
    };
    // Reset lastVisited when frequency changes so getNextVisitDate recalculates correctly
    if (freq !== client.freq) {
      (data as any).lastVisited = null;
    }
    // Clear specificDate when changing FROM 'once' to a periodic frequency
    if (client.freq === 'once' && freq !== 'once') {
      data.specificDate = '';
    }
    if (needsDate && startDate) {
      data.specificDate = startDate;
      // For 'once' freq (notes), update visitDay/visitDays to match new date
      if (freq === 'once') {
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const d = new Date(startDate + 'T12:00:00');
        const newDay = dayNames[d.getDay()];
        data.visitDay = newDay;
        data.visitDays = [newDay];
      }
    } else if (!needsDate) {
      data.specificDate = '';
    }
    if (showClientInfo) {
      data.name = name.trim();
      data.address = address.trim();
      data.phone = phone.trim();
      data.mapsLink = mapsLink.trim();
    }
    try {
      await onSave(client.id, data);
      onClose();
    } catch (e) {
      Alert.alert('Error', 'No se pudo guardar los cambios.');
    }
  };

  const adjustQty = (productId: string, delta: number) => {
    setProducts((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {showClientInfo ? 'Editar Cliente' : (client.name || '').toUpperCase()}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {showClientInfo && (
              <>
                <Text style={styles.sectionTitle}>Datos del cliente</Text>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={name}
                    onChangeText={setName}
                    placeholder="Nombre"
                    placeholderTextColor={colors.textHint}
                  />
                  {name.length > 0 && (
                    <TouchableOpacity onPress={() => setName('')} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Direccion"
                    placeholderTextColor={colors.textHint}
                  />
                  {address.length > 0 && (
                    <TouchableOpacity onPress={() => setAddress('')} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="Telefono"
                    placeholderTextColor={colors.textHint}
                    keyboardType="phone-pad"
                  />
                  {phone.length > 0 && (
                    <TouchableOpacity onPress={() => setPhone('')} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={mapsLink}
                    onChangeText={setMapsLink}
                    placeholder="URL Google Maps"
                    placeholderTextColor={colors.textHint}
                    keyboardType="url"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {mapsLink.length > 0 && (
                    <TouchableOpacity onPress={() => setMapsLink('')} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            {/* Products */}
            <Text style={[styles.sectionTitle, showClientInfo && { marginTop: 20 }]}>Productos</Text>
            {PRODUCTS.map((p) => (
              <View key={p.id} style={styles.productRow}>
                <Text style={styles.productLabel}>
                  {p.icon} {p.label}
                </Text>
                <View style={styles.qtyControls}>
                  <TouchableOpacity
                    onPress={() => adjustQty(p.id, -1)}
                    style={styles.qtyBtn}
                  >
                    <Text style={styles.qtyBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyValue}>{products[p.id] || 0}</Text>
                  <TouchableOpacity
                    onPress={() => adjustQty(p.id, 1)}
                    style={[styles.qtyBtn, styles.qtyBtnPlus]}
                  >
                    <Text style={[styles.qtyBtnText, styles.qtyBtnPlusText]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* Notes */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Notas</Text>
            <View style={[styles.notesInput, { position: 'relative' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0, textAlignVertical: 'top', minHeight: 70 }}
                value={notes}
                onChangeText={setNotes}
                placeholder="Notas del cliente..."
                placeholderTextColor={colors.textHint}
                multiline
                numberOfLines={3}
              />
              {notes.length > 0 && (
                <TouchableOpacity
                  onPress={() => setNotes('')}
                  style={{ position: 'absolute', top: 8, right: 8, padding: 4 }}
                >
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Frequency */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              Frecuencia
            </Text>
            <View style={styles.freqGrid}>
              {(Object.entries(FREQUENCY_LABELS) as [Frequency, string][]).map(
                ([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setFreq(key)}
                    style={[
                      styles.freqChip,
                      freq === key && styles.freqChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.freqChipText,
                        freq === key && styles.freqChipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                ),
              )}
            </View>

            {/* Date picker */}
            {needsDate && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionTitle}>
                  {freq === 'once' ? 'Fecha' : 'Fecha de inicio'}
                </Text>
                {startDate ? (
                  <View style={styles.selectedDateRow}>
                    <Text style={styles.selectedDateText}>
                      {formatDisplayDate(startDate)}
                    </Text>
                    <TouchableOpacity onPress={() => { setStartDate(''); setShowDatePicker(false); }}>
                      <Text style={styles.clearDateText}>Quitar</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.dateHint}>
                    Selecciona desde cuando inicia la frecuencia
                  </Text>
                )}
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={pickerDate}
                    mode="date"
                    display="inline"
                    onChange={onDateChange}
                    minimumDate={new Date()}
                    locale="es-ES"
                    style={styles.datePicker}
                    themeVariant={isDark ? 'dark' : 'light'}
                  />
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.dateBtn}
                      onPress={() => setShowDatePicker(true)}
                    >
                      <Text style={styles.dateBtnText}>
                        {startDate ? formatDisplayDate(startDate) : 'Elegir fecha'}
                      </Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={pickerDate}
                        mode="date"
                        display="default"
                        onChange={onDateChange}
                        minimumDate={new Date()}
                        locale="es-ES"
                      />
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    maxWidth: 600,
    alignSelf: 'center' as const,
    width: '100%' as const,
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
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
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  fieldInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: 10,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.sectionBackground,
  },
  productLabel: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnPlus: {
    backgroundColor: colors.primary,
  },
  qtyBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  qtyBtnPlusText: {
    color: colors.textWhite,
  },
  qtyValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  freqGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  freqChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.sectionBackground,
  },
  freqChipSelected: {
    backgroundColor: colors.primary,
  },
  freqChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  freqChipTextSelected: {
    color: colors.textWhite,
  },
  selectedDateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  selectedDateText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  clearDateText: {
    fontSize: 15,
    color: colors.danger,
    fontWeight: '600',
  },
  dateHint: {
    fontSize: 15,
    color: colors.textMuted,
    marginBottom: 8,
  },
  datePicker: {
    marginTop: 4,
  },
  dateBtn: {
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  dateBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
  },
});

export default EditClientModal;
