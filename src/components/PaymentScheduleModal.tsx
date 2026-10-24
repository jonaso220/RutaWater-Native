import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Platform,
  useWindowDimensions,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import ModalOverlay from './ModalOverlay';
import { PaymentSchedule } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { getModalWidth } from '../utils/helpers';
import { parseDateKey, toDateKey } from '../utils/paymentSchedule';
import { formatPaymentDate, formatPaymentRange } from '../utils/paymentScheduleLabel';

interface PaymentScheduleModalProps {
  visible: boolean;
  clientName: string;
  schedule: PaymentSchedule | null | undefined;
  onSave: (schedule: PaymentSchedule | null) => Promise<void>;
  onClose: () => void;
}

type Kind = PaymentSchedule['kind'];
type DateField = 'from' | 'to';

const PRESETS: Array<[number, number]> = [[1, 5], [1, 10], [10, 15], [15, 20], [25, 31]];

const wrapDay = (day: number) => (day < 1 ? 31 : day > 31 ? 1 : day);

const PaymentScheduleModal: React.FC<PaymentScheduleModalProps> = ({
  visible,
  clientName,
  schedule,
  onSave,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const styles = useMemo(
    () => getStyles(colors, isTablet, getModalWidth(windowWidth), fontScale),
    [colors, isTablet, windowWidth, fontScale],
  );

  const [kind, setKind] = useState<Kind>('monthly');
  const [fromDay, setFromDay] = useState(1);
  const [toDay, setToDay] = useState(10);
  const [fromDate, setFromDate] = useState(toDateKey(new Date()));
  const [toDate, setToDate] = useState<string | undefined>(undefined);
  const [activeField, setActiveField] = useState<DateField>('from');
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const [remind, setRemind] = useState(true);
  const [saving, setSaving] = useState(false);

  // Each opening starts from what the client has saved.
  useEffect(() => {
    if (!visible) return;
    setKind(schedule?.kind || 'monthly');
    setFromDay(schedule?.kind === 'monthly' ? schedule.fromDay : 1);
    setToDay(schedule?.kind === 'monthly' ? schedule.toDay : 10);
    setFromDate(schedule?.kind === 'date' ? schedule.from : toDateKey(new Date()));
    setToDate(schedule?.kind === 'date' ? schedule.to : undefined);
    setActiveField('from');
    setShowAndroidPicker(false);
    setRemind(schedule ? schedule.remind : true);
    setSaving(false);
  }, [visible, schedule]);

  const monthNames = t('monthNames', { returnObjects: true }) as string[];
  const dayNames = t('dayNames', { returnObjects: true }) as string[];
  const longDate = (key: string) => {
    const date = parseDateKey(key);
    return date ? `${dayNames[date.getDay()].toLowerCase()} ${date.getDate()} de ${monthNames[date.getMonth()].toLowerCase()}` : key;
  };

  const draft: PaymentSchedule = kind === 'monthly'
    ? { kind, fromDay, toDay, remind }
    : { kind, from: fromDate, ...(toDate && toDate !== fromDate ? { to: toDate } : {}), remind };

  const summary = kind === 'monthly'
    ? fromDay === toDay
      ? t('paymentSchedule.summaryMonthlySame', { day: fromDay })
      : t('paymentSchedule.summaryMonthly', { from: fromDay, to: toDay })
    : draft.kind === 'date' && draft.to
      ? t('paymentSchedule.summaryRange', formatPaymentRange(t, draft.from, draft.to))
      : t('paymentSchedule.summaryDate', { date: longDate(fromDate) });

  const pickerValue = parseDateKey(activeField === 'to' ? toDate || fromDate : fromDate) || new Date();

  const onDateChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (!selected) return;
    const key = toDateKey(selected);
    if (activeField === 'from') {
      setFromDate(key);
      // «Hasta» never ends before «Desde».
      if (toDate && toDate < key) setToDate(key);
    } else {
      setToDate(key < fromDate ? fromDate : key);
    }
  };

  const chooseField = (field: DateField) => {
    setActiveField(field);
    if (field === 'to' && !toDate) setToDate(fromDate);
    if (Platform.OS === 'android') setShowAndroidPicker(true);
  };

  const save = async (value: PaymentSchedule | null) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  const renderStepper = (label: string, value: number, onChange: (day: number) => void) => (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={styles.stepperBtn}
          onPress={() => onChange(wrapDay(value - 1))}
          accessibilityRole="button"
          accessibilityLabel={`${label} −`}
        >
          <Ionicons name="remove" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity
          style={styles.stepperBtn}
          onPress={() => onChange(wrapDay(value + 1))}
          accessibilityRole="button"
          accessibilityLabel={`${label} +`}
        >
          <Ionicons name="add" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>{t('paymentSchedule.title')}</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>{clientName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={t('close')}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.segmented}>
              {(['monthly', 'date'] as Kind[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  onPress={() => setKind(option)}
                  style={[styles.segment, kind === option && styles.segmentActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: kind === option }}
                >
                  <Ionicons
                    name={option === 'monthly' ? 'repeat' : 'calendar-outline'}
                    size={16}
                    color={kind === option ? colors.primary : colors.textMuted}
                  />
                  <Text style={[styles.segmentText, kind === option && styles.segmentTextActive]}>
                    {t(option === 'monthly' ? 'paymentSchedule.monthly' : 'paymentSchedule.once')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.summaryBox}>
              <Ionicons name="cash-outline" size={18} color={colors.primary} />
              <Text style={styles.summaryText}>{summary}</Text>
            </View>

            {kind === 'monthly' ? (
              <>
                <View style={styles.steppers}>
                  {renderStepper(t('paymentSchedule.fromDay'), fromDay, setFromDay)}
                  {renderStepper(t('paymentSchedule.toDay'), toDay, setToDay)}
                </View>
                <Text style={styles.sectionTitle}>{t('paymentSchedule.presets')}</Text>
                <View style={styles.presets}>
                  {PRESETS.map(([from, to]) => {
                    const selected = from === fromDay && to === toDay;
                    return (
                      <TouchableOpacity
                        key={`${from}-${to}`}
                        onPress={() => { setFromDay(from); setToDay(to); }}
                        style={[styles.preset, selected && styles.presetActive]}
                      >
                        <Text style={[styles.presetText, selected && styles.presetTextActive]}>
                          {to === 31 ? t('paymentSchedule.endOfMonth') : t('paymentSchedule.rangePreset', { from, to })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {toDay < fromDay ? (
                  <Text style={styles.hint}>{t('paymentSchedule.wrapsHint', { to: toDay })}</Text>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.dateFields}>
                  <TouchableOpacity
                    style={[styles.dateField, activeField === 'from' && styles.dateFieldActive]}
                    onPress={() => chooseField('from')}
                  >
                    <Text style={styles.dateFieldLabel}>{t('paymentSchedule.from')}</Text>
                    <Text style={styles.dateFieldValue}>{formatPaymentDate(t, fromDate)}</Text>
                  </TouchableOpacity>
                  {toDate ? (
                    <TouchableOpacity
                      style={[styles.dateField, activeField === 'to' && styles.dateFieldActive]}
                      onPress={() => chooseField('to')}
                    >
                      <View style={styles.dateFieldTop}>
                        <Text style={styles.dateFieldLabel}>{t('paymentSchedule.to')}</Text>
                        <TouchableOpacity
                          onPress={() => { setToDate(undefined); setActiveField('from'); }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          accessibilityRole="button"
                          accessibilityLabel={t('paymentSchedule.removeTo')}
                        >
                          <Ionicons name="close-circle" size={16} color={colors.textHint} />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.dateFieldValue}>{formatPaymentDate(t, toDate)}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[styles.dateField, styles.dateFieldAdd]} onPress={() => chooseField('to')}>
                      <Ionicons name="add" size={18} color={colors.primary} />
                      <Text style={styles.dateFieldAddText}>{t('paymentSchedule.addTo')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {Platform.OS === 'ios' ? (
                  <View style={styles.datePickerWrapper}>
                    <DateTimePicker
                      value={pickerValue}
                      mode="date"
                      display="inline"
                      onChange={onDateChange}
                      locale="es-ES"
                      style={styles.datePicker}
                      themeVariant={isDark ? 'dark' : 'light'}
                    />
                  </View>
                ) : showAndroidPicker ? (
                  <DateTimePicker value={pickerValue} mode="date" display="default" onChange={onDateChange} />
                ) : null}
              </>
            )}

            <View style={styles.remindRow}>
              <View style={styles.remindIcon}>
                <Ionicons name="notifications-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.remindText}>
                <Text style={styles.remindTitle}>{t('paymentSchedule.remind')}</Text>
                <Text style={styles.remindHint}>{t('paymentSchedule.remindHint')}</Text>
              </View>
              <Switch
                value={remind}
                onValueChange={setRemind}
                trackColor={{ false: colors.cardBorder, true: colors.primary }}
                thumbColor={Platform.OS === 'android' ? colors.textWhite : undefined}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            {schedule ? (
              <TouchableOpacity
                style={[styles.removeBtn, saving && styles.disabled]}
                onPress={() => save(null)}
                disabled={saving}
              >
                <Text style={styles.removeBtnText}>{t('paymentSchedule.remove')}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.disabled]}
              onPress={() => save(draft)}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>{t('paymentSchedule.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '88%',
    maxWidth: isTablet ? undefined : 600,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
    overflow: 'hidden' as const,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: s(16),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: s(18), fontWeight: '700', color: colors.textPrimary },
  headerSubtitle: { fontSize: s(13), color: colors.textSecondary, marginTop: s(2) },
  closeBtn: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: { padding: s(16), gap: s(14) },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.sectionBackground,
    borderRadius: s(12),
    padding: s(3),
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    paddingVertical: s(9),
    borderRadius: s(10),
  },
  segmentActive: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentText: { fontSize: s(14), fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: colors.textPrimary },
  summaryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    backgroundColor: colors.primaryLighter,
    borderRadius: s(12),
    paddingHorizontal: s(12),
    paddingVertical: s(11),
  },
  summaryText: { flex: 1, fontSize: s(15), fontWeight: '700', color: colors.primary },
  steppers: { flexDirection: 'row', gap: s(10) },
  stepper: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: s(12),
    padding: s(10),
    alignItems: 'center',
  },
  stepperLabel: { fontSize: s(12), fontWeight: '600', color: colors.textMuted, marginBottom: s(6) },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: s(10) },
  stepperBtn: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    backgroundColor: colors.sectionBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: s(36),
    textAlign: 'center',
    fontSize: s(24),
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  sectionTitle: {
    fontSize: s(12),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: -s(6),
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8) },
  preset: {
    paddingHorizontal: s(12),
    paddingVertical: s(7),
    borderRadius: s(16),
    backgroundColor: colors.sectionBackground,
  },
  presetActive: { backgroundColor: colors.primary },
  presetText: { fontSize: s(14), fontWeight: '600', color: colors.textSecondary },
  presetTextActive: { color: colors.textWhite },
  hint: { fontSize: s(13), color: colors.textMuted },
  dateFields: { flexDirection: 'row', gap: s(10) },
  dateField: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: s(12),
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    minHeight: s(58),
    justifyContent: 'center',
  },
  dateFieldActive: { borderColor: colors.primary, borderWidth: 2, paddingHorizontal: s(11), paddingVertical: s(9) },
  dateFieldTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateFieldLabel: { fontSize: s(12), fontWeight: '600', color: colors.textMuted },
  dateFieldValue: { fontSize: s(16), fontWeight: '700', color: colors.textPrimary, marginTop: s(2) },
  dateFieldAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(4),
    borderStyle: 'dashed',
  },
  dateFieldAddText: { fontSize: s(14), fontWeight: '600', color: colors.primary },
  datePicker: { height: 330 },
  datePickerWrapper: { alignSelf: 'center' as const, width: 330, overflow: 'hidden' as const },
  remindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: s(12),
    padding: s(12),
  },
  remindIcon: {
    width: s(34),
    height: s(34),
    borderRadius: s(17),
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remindText: { flex: 1 },
  remindTitle: { fontSize: s(15), fontWeight: '700', color: colors.textPrimary },
  remindHint: { fontSize: s(12), color: colors.textMuted, marginTop: s(2) },
  footer: {
    flexDirection: 'row',
    gap: s(10),
    padding: s(16),
    paddingBottom: Platform.OS === 'android' ? s(32) : s(24),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  removeBtn: {
    paddingHorizontal: s(16),
    paddingVertical: s(14),
    borderRadius: s(12),
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  removeBtnText: { fontSize: s(16), fontWeight: '700', color: colors.danger },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
  },
  saveBtnText: { color: colors.textWhite, fontSize: s(17), fontWeight: '700' },
  disabled: { opacity: 0.6 },
  });
};

export default PaymentScheduleModal;
