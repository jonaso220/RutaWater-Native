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
} from 'react-native';
import { DailyLoad } from '../hooks/useDailyLoads';

interface DailyLoadModalProps {
  visible: boolean;
  day: string;
  initialData: DailyLoad;
  onSave: (day: string, data: DailyLoad) => void;
  onClose: () => void;
}

const LOAD_FIELDS = [
  { key: 'b20', label: '20L', icon: '💧' },
  { key: 'b12', label: '12L', icon: '💧' },
  { key: 'b6', label: '6L', icon: '💧' },
  { key: 'soda', label: 'Soda', icon: '🍾' },
];

const DailyLoadModal: React.FC<DailyLoadModalProps> = ({
  visible,
  day,
  initialData,
  onSave,
  onClose,
}) => {
  const [data, setData] = useState<DailyLoad>(initialData);

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  const updateField = (key: string, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(day, data);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Carga - {day}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body}>
            {/* Main loads */}
            <Text style={styles.sectionTitle}>Carga Principal</Text>
            <View style={styles.grid}>
              {LOAD_FIELDS.map((f) => (
                <View key={f.key} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>
                    {f.icon} {f.label}
                  </Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={data[f.key as keyof DailyLoad]}
                    onChangeText={(v) => updateField(f.key, v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#D1D5DB"
                  />
                </View>
              ))}
            </View>

            {/* Extra loads */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              Extras
            </Text>
            <View style={styles.grid}>
              {LOAD_FIELDS.map((f) => (
                <View key={`${f.key}_extra`} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>
                    {f.icon} {f.label} Extra
                  </Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={data[`${f.key}_extra` as keyof DailyLoad]}
                    onChangeText={(v) => updateField(`${f.key}_extra`, v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#D1D5DB"
                  />
                </View>
              ))}
            </View>

            {/* Notes */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              Notas del dia
            </Text>
            <TextInput
              style={styles.notesInput}
              value={data.pedidos_note}
              onChangeText={(v) => updateField('pedidos_note', v)}
              placeholder="Notas sobre pedidos..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
            />
          </ScrollView>

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
    maxHeight: '85%',
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
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 16, color: '#6B7280' },
  body: { padding: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  grid: { gap: 8 },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  fieldLabel: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  fieldInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    width: 80,
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

export default DailyLoadModal;
