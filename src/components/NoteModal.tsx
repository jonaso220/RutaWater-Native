import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface NoteModalProps {
  visible: boolean;
  onSave: (notes: string, date: string) => void;
  onClose: () => void;
}

const NoteModal: React.FC<NoteModalProps> = ({ visible, onSave, onClose }) => {
  const [notes, setNotes] = useState('');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (selectedDate) {
      setPickerDate(selectedDate);
      const yyyy = selectedDate.getFullYear();
      const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(selectedDate.getDate()).padStart(2, '0');
      setDate(`${yyyy}-${mm}-${dd}`);
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

  const handleSave = () => {
    if (!notes.trim()) {
      Alert.alert('Error', 'Escribe una nota.');
      return;
    }
    if (!date) {
      Alert.alert('Error', 'Selecciona una fecha.');
      return;
    }
    onSave(notes.trim(), date);
    setNotes('');
    setPickerDate(new Date());
    setDate(new Date().toISOString().split('T')[0]);
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
            <Text style={styles.headerTitle}>Nueva Nota</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.label}>Nota</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Escribe tu nota aqui..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              autoFocus
            />

            <Text style={[styles.label, { marginTop: 16 }]}>
              Fecha de entrega
            </Text>
            {date ? (
              <View style={styles.selectedDateRow}>
                <Text style={styles.selectedDateText}>
                  {formatDisplayDate(date)}
                </Text>
              </View>
            ) : null}
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display="inline"
              onChange={onDateChange}
              minimumDate={new Date()}
              locale="es-ES"
              style={styles.datePicker}
              themeVariant="light"
            />
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Agregar Nota</Text>
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
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
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
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  notesInput: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#FDE68A',
    textAlignVertical: 'top',
    minHeight: 80,
  },
  selectedDateRow: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  selectedDateText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D4ED8',
    textAlign: 'center',
  },
  datePicker: {
    height: 340,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  saveBtn: {
    backgroundColor: '#F59E0B',
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

export default NoteModal;
