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
import { FREQUENCIES, Frequency, getFreqLabel } from '../constants/products';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { getModalWidth } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';

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
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);

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
              {FREQUENCIES.map((key) => (
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
                    {getFreqLabel(key)}
                  </Text>
                </TouchableOpacity>
              ))}
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
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '85%',
    maxWidth: isTablet ? undefined : 600,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
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
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
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
  sectionTitle: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: s(12),
  },
  freqGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  freqChip: {
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: s(20),
    backgroundColor: colors.sectionBackground,
  },
  freqChipSelected: {
    backgroundColor: colors.primary,
  },
  freqChipText: {
    fontSize: s(15),
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
    borderRadius: s(10),
    padding: s(12),
    marginBottom: s(8),
  },
  selectedDateText: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.textPrimary,
  },
  clearDateText: {
    fontSize: s(15),
    color: colors.danger,
    fontWeight: '600',
  },
  dateHint: {
    fontSize: s(15),
    color: colors.textMuted,
    marginBottom: s(8),
  },
  datePicker: {
    height: 350,
  },
  datePickerWrapper: {
    alignSelf: 'center' as const,
    width: 330,
    overflow: 'hidden' as const,
    marginTop: s(4),
  },
  dateBtn: {
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    padding: s(14),
    alignItems: 'center',
  },
  dateBtnText: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.primary,
  },
  footer: {
    padding: s(16),
    paddingBottom: Platform.OS === 'android' ? s(32) : s(16),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  doneBtn: {
    backgroundColor: colors.primary,
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
  },
  doneBtnText: {
    color: colors.textWhite,
    fontSize: s(18),
    fontWeight: '700',
  },
  });
};

export default FrequencyEditModal;
