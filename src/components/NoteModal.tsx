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
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface NoteModalProps {
  visible: boolean;
  onSave: (notes: string, date: string) => void;
  onClose: () => void;
}

const NoteModal: React.FC<NoteModalProps> = ({ visible, onSave, onClose }) => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);

  const [notes, setNotes] = useState('');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    // On Android, dismiss the picker on any event (set or dismissed)
    if (Platform.OS === 'android') {
      setShowAndroidPicker(false);
    }
    if (event.type === 'dismissed') return;
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
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modal}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Nueva Nota</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scrollBody}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.label}>Nota</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Escribe tu nota aqui..."
                placeholderTextColor={colors.textHint}
                multiline
                numberOfLines={3}
                blurOnSubmit
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />

              <Text style={[styles.label, { marginTop: 16 }]}>
                Fecha de entrega
              </Text>
              {date ? (
                <TouchableOpacity
                  style={styles.selectedDateRow}
                  onPress={() => Platform.OS === 'android' && setShowAndroidPicker(true)}
                  activeOpacity={Platform.OS === 'android' ? 0.6 : 1}
                >
                  <Text style={styles.selectedDateText}>
                    📅 {formatDisplayDate(date)}
                  </Text>
                  {Platform.OS === 'android' && (
                    <Text style={[styles.selectedDateHint, { color: colors.textMuted }]}>
                      Toca para cambiar fecha
                    </Text>
                  )}
                </TouchableOpacity>
              ) : null}
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
                    style={styles.datePickerBtn}
                    onPress={() => setShowAndroidPicker(true)}
                  >
                    <Text style={styles.datePickerBtnText}>📅 Seleccionar fecha</Text>
                  </TouchableOpacity>
                  {showAndroidPicker && (
                    <DateTimePicker
                      value={pickerDate}
                      mode="date"
                      display="default"
                      onChange={onDateChange}
                      minimumDate={new Date()}
                    />
                  )}
                </>
              )}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveBtnText}>Agregar Nota</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
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
    maxHeight: '92%',
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
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 16, color: colors.textMuted },
  scrollBody: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  notesInput: {
    backgroundColor: colors.warningAmberBg,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.warningAmberBorder,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  selectedDateRow: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.primaryInactiveBorder,
  },
  selectedDateText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primaryDark,
    textAlign: 'center',
  },
  datePicker: {
    height: 340,
  },
  selectedDateHint: {
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  datePickerBtn: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryInactiveBorder,
  },
  datePickerBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  saveBtn: {
    backgroundColor: colors.warningAmber,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: colors.textWhite,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default NoteModal;
