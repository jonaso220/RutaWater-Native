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
import { Client } from '../types';
import { PRODUCTS, ALL_DAYS, FREQUENCY_LABELS, Frequency } from '../constants/products';

interface ScheduleModalProps {
  visible: boolean;
  client: Client | null;
  onSave: (
    client: Client,
    days: string[],
    freq: Frequency,
    date: string,
    notes: string,
    products: Record<string, number>,
  ) => void;
  onClose: () => void;
}

const ScheduleModal: React.FC<ScheduleModalProps> = ({
  visible,
  client,
  onSave,
  onClose,
}) => {
  const [localDays, setLocalDays] = useState<string[]>(['Lunes']);
  const [localFreq, setLocalFreq] = useState<Frequency>('once');
  const [localDate, setLocalDate] = useState('');
  const [localNotes, setLocalNotes] = useState('');
  const [localProducts, setLocalProducts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (client) {
      setLocalNotes(client.notes || '');
      setLocalFreq(
        client.freq === 'on_demand' ? 'once' : (client.freq || 'once'),
      );
      setLocalDate(client.specificDate || '');
      const prods: Record<string, number> = {};
      PRODUCTS.forEach((p) => {
        prods[p.id] = parseInt(String(client.products?.[p.id] || 0), 10);
      });
      setLocalProducts(prods);
      if (client.visitDays && client.visitDays.length > 0) {
        setLocalDays(client.visitDays);
      } else if (client.visitDay && client.visitDay !== 'Sin Asignar') {
        setLocalDays([client.visitDay]);
      } else {
        setLocalDays(['Lunes']);
      }
    }
  }, [client]);

  if (!client) return null;

  const toggleDay = (day: string) => {
    setLocalDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return [...prev, day];
    });
  };

  const adjustQty = (productId: string, delta: number) => {
    setLocalProducts((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }));
  };

  const handleSubmit = () => {
    if (localFreq === 'once' && !localDate) {
      Alert.alert('Error', 'Por favor, selecciona una fecha de entrega.');
      return;
    }
    if (localFreq !== 'once' && localDays.length === 0) {
      Alert.alert('Error', 'Por favor, selecciona al menos un dia.');
      return;
    }
    const cleanProducts: Record<string, number> = {};
    Object.entries(localProducts).forEach(([key, val]) => {
      if (val > 0) cleanProducts[key] = val;
    });
    onSave(client, localDays, localFreq, localDate, localNotes, cleanProducts);
    onClose();
  };

  const freqOptions: { key: Frequency; label: string }[] = [
    { key: 'once', label: 'Una Vez' },
    { key: 'weekly', label: 'Semanal' },
    { key: 'biweekly', label: 'Cada 2 Sem' },
    { key: 'triweekly', label: 'Cada 3 Sem' },
    { key: 'monthly', label: 'Mensual' },
  ];

  // Format today's date as YYYY-MM-DD for the default
  const today = new Date().toISOString().split('T')[0];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Agendar Visita</Text>
              <Text style={styles.headerSubtitle}>
                Programar a {client.name}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Frequency selector */}
            <Text style={styles.sectionTitle}>Tipo de Pedido</Text>
            <View style={styles.freqGrid}>
              {freqOptions.map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setLocalFreq(key)}
                  style={[
                    styles.freqChip,
                    localFreq === key && (key === 'once' ? styles.freqChipOnce : styles.freqChipSelected),
                  ]}
                >
                  <Text
                    style={[
                      styles.freqChipText,
                      localFreq === key && styles.freqChipTextSelected,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Date or Days selector */}
            {localFreq === 'once' ? (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionTitle}>Fecha de Entrega</Text>
                <TextInput
                  style={styles.dateInput}
                  value={localDate}
                  onChangeText={setLocalDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.hintText}>
                  Formato: 2025-01-15. Se agenda para el dia correspondiente.
                </Text>
              </View>
            ) : (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionTitle}>
                  Dias de Visita{' '}
                  <Text style={styles.hintInline}>(puede elegir varios)</Text>
                </Text>
                <View style={styles.daysGrid}>
                  {ALL_DAYS.map((day) => (
                    <TouchableOpacity
                      key={day}
                      onPress={() => toggleDay(day)}
                      style={[
                        styles.dayChip,
                        localDays.includes(day) && styles.dayChipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayChipText,
                          localDays.includes(day) && styles.dayChipTextSelected,
                        ]}
                      >
                        {day.slice(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {localDays.length > 1 && (
                  <Text style={styles.dayCountText}>
                    {localDays.length} dias seleccionados
                  </Text>
                )}
              </View>
            )}

            {/* Products */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              Productos
            </Text>
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
                  <Text style={styles.qtyValue}>
                    {localProducts[p.id] || 0}
                  </Text>
                  <TouchableOpacity
                    onPress={() => adjustQty(p.id, 1)}
                    style={[styles.qtyBtn, styles.qtyBtnPlus]}
                  >
                    <Text style={[styles.qtyBtnText, styles.qtyBtnPlusText]}>
                      +
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* Notes */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Notas</Text>
            <TextInput
              style={styles.notesInput}
              value={localNotes}
              onChangeText={setLocalNotes}
              placeholder="Notas del cliente..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
            />
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSubmit}>
              <Text style={styles.saveBtnText}>Agendar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: '#6B7280',
  },
  body: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  hintInline: {
    fontSize: 10,
    fontWeight: '400',
    color: '#9CA3AF',
    textTransform: 'none',
  },
  freqGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  freqChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  freqChipSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  freqChipOnce: {
    backgroundColor: '#FFF7ED',
    borderColor: '#F97316',
  },
  freqChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  freqChipTextSelected: {
    color: '#1D4ED8',
  },
  dateInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  hintText: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 6,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  dayChipSelected: {
    backgroundColor: '#2563EB',
  },
  dayChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  dayChipTextSelected: {
    color: '#FFFFFF',
  },
  dayCountText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
    marginTop: 8,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  productLabel: {
    fontSize: 14,
    color: '#374151',
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
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnPlus: {
    backgroundColor: '#2563EB',
  },
  qtyBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
  },
  qtyBtnPlusText: {
    color: '#FFFFFF',
  },
  qtyValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    minWidth: 24,
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    textAlignVertical: 'top',
    minHeight: 80,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  saveBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ScheduleModal;
