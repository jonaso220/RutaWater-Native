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
import { PRODUCTS, ALL_DAYS, FREQUENCY_LABELS, Frequency } from '../constants/products';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useTranslation } from 'react-i18next';

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
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = getStyles(colors);

  const [localDays, setLocalDays] = useState<string[]>(['Lunes']);
  const [localFreq, setLocalFreq] = useState<Frequency>('once');
  const [localDate, setLocalDate] = useState('');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [localNotes, setLocalNotes] = useState('');
  const [localProducts, setLocalProducts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setSaving(false);
      // Reset notes and products so each new scheduling starts clean
      setLocalNotes('');
      setLocalFreq(
        client.freq === 'on_demand' ? 'once' : (client.freq || 'once'),
      );
      setLocalDate('');
      setShowPicker(false);
      setPickerDate(new Date());
      const prods: Record<string, number> = {};
      PRODUCTS.forEach((p) => {
        prods[p.id] = 0;
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
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (selectedDate) {
      setPickerDate(selectedDate);
      const yyyy = selectedDate.getFullYear();
      const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(selectedDate.getDate()).padStart(2, '0');
      setLocalDate(`${yyyy}-${mm}-${dd}`);
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

  const handleSubmit = async () => {
    if (saving) return;
    if (localFreq === 'once' && !localDate) {
      Alert.alert(t('error'), t('scheduleModal.errorDate'));
      return;
    }
    if (localFreq !== 'once' && localDays.length === 0) {
      Alert.alert(t('error'), t('scheduleModal.errorDays'));
      return;
    }
    setSaving(true);
    const cleanProducts: Record<string, number> = {};
    Object.entries(localProducts).forEach(([key, val]) => {
      if (val > 0) cleanProducts[key] = val;
    });
    try {
      await onSave(client, localDays, localFreq, localDate, localNotes, cleanProducts);
      onClose();
    } catch (e) {
      Alert.alert(t('error'), t('scheduleModal.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const freqOptions: { key: Frequency; label: string }[] = [
    { key: 'once', label: t('scheduleModal.freqOnce') },
    { key: 'weekly', label: t('scheduleModal.freqWeekly') },
    { key: 'biweekly', label: t('scheduleModal.freqBiweekly') },
    { key: 'triweekly', label: t('scheduleModal.freqTriweekly') },
    { key: 'monthly', label: t('scheduleModal.freqMonthly') },
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
              <Text style={styles.headerTitle}>{t('scheduleModal.title')}</Text>
              <Text style={styles.headerSubtitle}>
                {t('scheduleModal.scheduleFor', { name: client.name })}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Frequency selector */}
            <Text style={styles.sectionTitle}>{t('scheduleModal.orderType')}</Text>
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
                <Text style={styles.sectionTitle}>{t('scheduleModal.deliveryDate')}</Text>
                {localDate ? (
                  <View style={styles.selectedDateRow}>
                    <Text style={styles.selectedDateText}>
                      {formatDisplayDate(localDate)}
                    </Text>
                  </View>
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
                    <TouchableOpacity
                      style={styles.selectedDateRow}
                      onPress={() => setShowPicker(true)}
                    >
                      <Text style={styles.selectedDateText}>
                        {localDate ? formatDisplayDate(localDate) : t('scheduleModal.chooseDate')}
                      </Text>
                    </TouchableOpacity>
                    {showPicker && (
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
            ) : (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionTitle}>
                  {t('scheduleModal.visitDays')}{' '}
                  <Text style={styles.hintInline}>{t('scheduleModal.canSelectMultiple')}</Text>
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
                    {t('scheduleModal.daysSelected', { count: localDays.length })}
                  </Text>
                )}
              </View>
            )}

            {/* Products */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              {t('scheduleModal.products')}
            </Text>
            {PRODUCTS.map((p) => (
              <View key={p.id} style={styles.productRow}>
                <Text style={styles.productLabel}>
                  {p.emoji} {p.label}
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
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('scheduleModal.notes')}</Text>
            <View style={[styles.notesInput, { position: 'relative' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0, textAlignVertical: 'top', minHeight: 70 }}
                value={localNotes}
                onChangeText={setLocalNotes}
                placeholder={t('scheduleModal.notesPlaceholder')}
                placeholderTextColor={colors.textHint}
                multiline
                numberOfLines={3}
              />
              {localNotes.length > 0 && (
                <TouchableOpacity
                  onPress={() => setLocalNotes('')}
                  style={{ position: 'absolute', top: 8, right: 8, padding: 4 }}
                >
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSubmit} disabled={saving}>
              <Text style={styles.saveBtnText}>{t('scheduleModal.scheduleBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
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
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 2,
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
    marginBottom: 10,
  },
  hintInline: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textHint,
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
    borderRadius: 20,
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  freqChipSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  freqChipOnce: {
    backgroundColor: colors.warningLightBg,
    borderColor: colors.warning,
  },
  freqChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  freqChipTextSelected: {
    color: colors.primaryDark,
  },
  selectedDateRow: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.primaryInactiveBorder,
  },
  selectedDateText: {
    fontSize: 17,
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
  hintText: {
    fontSize: 13,
    color: colors.textHint,
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
    borderRadius: 20,
    backgroundColor: colors.sectionBackground,
  },
  dayChipSelected: {
    backgroundColor: colors.primary,
  },
  dayChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayChipTextSelected: {
    color: colors.textWhite,
  },
  dayCountText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 8,
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

export default ScheduleModal;
