import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { FREQUENCY_LABELS, Frequency } from '../constants/products';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useTranslation } from 'react-i18next';

interface FrequencyEditModalProps {
  visible: boolean;
  onClose: () => void;
  freq: Frequency;
  setFreq: (f: Frequency) => void;
  startDate: string;
  setStartDate: (s: string) => void;
  pickerDate: Date;
  setPickerDate: (d: Date) => void;
}

const FrequencyEditModal: React.FC<FrequencyEditModalProps> = ({
  visible,
  onClose,
  freq,
  setFreq,
  startDate,
  setStartDate,
  pickerDate,
  setPickerDate,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const modalWidth = isTablet ? Math.min(windowWidth - 48, 720) : undefined;
  const styles = getStyles(colors, isTablet, modalWidth);

  const [showAndroidPicker, setShowAndroidPicker] = React.useState(false);

  const needsDate = freq === 'once' || freq === 'weekly' || freq === 'biweekly' || freq === 'triweekly' || freq === 'monthly';

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowAndroidPicker(false);
    }
    if (selectedDate) {
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
    const dayNames = t('dayNames', { returnObjects: true }) as string[];
    const monthNames = t('monthNames', { returnObjects: true }) as string[];
    return `${dayNames[d.getDay()]} ${d.getDate()} de ${monthNames[d.getMonth()]}`;
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('editModal.frequency')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
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

            {needsDate && (
              <View style={{ marginTop: 20 }}>
                <Text style={styles.sectionTitle}>
                  {freq === 'once' ? t('editModal.date') : t('editModal.startDate')}
                </Text>
                {startDate ? (
                  <View style={styles.selectedDateRow}>
                    <Text style={styles.selectedDateText}>
                      {formatDisplayDate(startDate)}
                    </Text>
                    <TouchableOpacity onPress={() => { setStartDate(''); setShowAndroidPicker(false); }}>
                      <Text style={styles.clearDateText}>{t('editModal.clearDate')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.dateHint}>
                    {t('editModal.dateHint')}
                  </Text>
                )}
                {Platform.OS === 'ios' ? (
                  <View style={styles.datePickerWrapper}>
                    <DateTimePicker
                      value={pickerDate}
                      mode="date"
                      display="inline"
                      onChange={onDateChange}
                      locale="es-ES"
                      style={styles.datePicker}
                      themeVariant={isDark ? 'dark' : 'light'}
                    />
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.dateBtn}
                      onPress={() => setShowAndroidPicker(true)}
                    >
                      <Text style={styles.dateBtnText}>
                        {startDate ? formatDisplayDate(startDate) : t('editModal.chooseDate')}
                      </Text>
                    </TouchableOpacity>
                    {showAndroidPicker && (
                      <DateTimePicker
                        value={pickerDate}
                        mode="date"
                        display="default"
                        onChange={onDateChange}
                        locale="es-ES"
                      />
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number) => StyleSheet.create({
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
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '85%',
    maxWidth: isTablet ? undefined : 600,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
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
    height: 350,
  },
  datePickerWrapper: {
    alignSelf: 'center' as const,
    width: 330,
    overflow: 'hidden' as const,
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
    paddingBottom: Platform.OS === 'android' ? 32 : 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  doneBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnText: {
    color: colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
  },
});

export default FrequencyEditModal;
