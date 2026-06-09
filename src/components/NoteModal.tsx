import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getModalWidth, toLocalDateString } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';

interface NoteModalProps {
  visible: boolean;
  onSave: (notes: string, date: string) => void;
  onClose: () => void;
}

const NoteModal: React.FC<NoteModalProps> = ({ visible, onSave, onClose }) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);

  const [notes, setNotes] = useState('');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [date, setDate] = useState(toLocalDateString(new Date()));
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  const handleClose = () => {
    setNotes('');
    setPickerDate(new Date());
    setDate(toLocalDateString(new Date()));
    onClose();
  };

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
    const dayNames = t('dayNames', { returnObjects: true }) as string[];
    const monthNames = t('monthNames', { returnObjects: true }) as string[];
    return `${dayNames[d.getDay()]} ${d.getDate()} de ${monthNames[d.getMonth()]}`;
  };

  const handleSave = () => {
    if (!notes.trim()) {
      Alert.alert(t('error'), t('noteModal.noteRequired'));
      return;
    }
    if (!date) {
      Alert.alert(t('error'), t('noteModal.dateRequired'));
      return;
    }
    onSave(notes.trim(), date);
    setNotes('');
    setPickerDate(new Date());
    setDate(toLocalDateString(new Date()));
    onClose();
  };

  return (
    <ModalOverlay visible={visible} onClose={handleClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modal}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{t('noteModal.title')}</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scrollBody}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.label}>{t('noteModal.noteLabel')}</Text>
              <View style={[styles.notesInput, { position: 'relative' }]}>
                <TextInput
                  style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0, textAlignVertical: 'top', minHeight: 70 }}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={t('noteModal.notePlaceholder')}
                  placeholderTextColor={colors.textHint}
                  multiline
                  numberOfLines={3}
                  blurOnSubmit
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                {notes.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setNotes('')}
                    style={{ position: 'absolute', top: 4, right: 4, padding: 10 }}
                  >
                    <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={[styles.label, { marginTop: 16 }]}>
                {t('noteModal.dateLabel')}
              </Text>
              {date ? (
                <TouchableOpacity
                  style={styles.selectedDateRow}
                  onPress={() => Platform.OS === 'android' && setShowAndroidPicker(true)}
                  activeOpacity={Platform.OS === 'android' ? 0.6 : 1}
                >
                  <Text style={styles.selectedDateText}>
                    <Ionicons name="calendar" size={17} /> {formatDisplayDate(date)}
                  </Text>
                  {Platform.OS === 'android' && (
                    <Text style={[styles.selectedDateHint, { color: colors.textMuted }]}>
                      {t('noteModal.tapToChange')}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : null}
              {Platform.OS === 'ios' ? (
                <View style={styles.datePickerWrapper}>
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
                </View>
              ) : (
                <>
                  {!date && (
                    <TouchableOpacity
                      style={styles.datePickerBtn}
                      onPress={() => setShowAndroidPicker(true)}
                    >
                      <Text style={styles.datePickerBtnText}><Ionicons name="calendar" size={17} /> {t('noteModal.selectDate')}</Text>
                    </TouchableOpacity>
                  )}
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
                <Text style={styles.saveBtnText}>{t('noteModal.addNote')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </ModalOverlay>
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
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '92%',
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
  closeBtnText: { fontSize: s(18), color: colors.textMuted },
  scrollBody: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: s(16),
    paddingBottom: s(8),
  },
  label: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: s(8),
  },
  notesInput: {
    backgroundColor: colors.warningAmberBg,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(16),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.warningAmberBorder,
    textAlignVertical: 'top',
    minHeight: s(80),
  },
  selectedDateRow: {
    backgroundColor: colors.primaryLighter,
    borderRadius: s(10),
    padding: s(10),
    marginBottom: s(8),
    borderWidth: 1,
    borderColor: colors.primaryInactiveBorder,
  },
  selectedDateText: {
    fontSize: s(17),
    fontWeight: '700',
    color: colors.primaryDark,
    textAlign: 'center',
  },
  datePicker: {
    height: 350,
  },
  datePickerWrapper: {
    alignSelf: 'center' as const,
    width: 330,
    overflow: 'hidden' as const,
  },
  selectedDateHint: {
    fontSize: s(13),
    marginTop: s(2),
    textAlign: 'center',
  },
  datePickerBtn: {
    backgroundColor: colors.primaryLighter,
    borderRadius: s(10),
    padding: s(14),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryInactiveBorder,
  },
  datePickerBtnText: {
    fontSize: s(17),
    fontWeight: '600',
    color: colors.primaryDark,
  },
  footer: {
    padding: s(16),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  saveBtn: {
    backgroundColor: colors.warningAmber,
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
  },
  saveBtnText: {
    color: colors.textWhite,
    fontSize: s(18),
    fontWeight: '700',
  },
  });
};

export default NoteModal;
