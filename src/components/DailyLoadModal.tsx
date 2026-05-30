import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import { DailyLoad } from '../hooks/useDailyLoads';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getModalWidth } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';

interface DailyLoadModalProps {
  visible: boolean;
  day: string;
  initialData: DailyLoad;
  onSave: (day: string, data: DailyLoad) => void;
  onClose: () => void;
}

const LOAD_FIELDS = [
  { key: 'b20', label: '20L', icon: 'water' },
  { key: 'b12', label: '12L', icon: 'water' },
  { key: 'b6', label: '6L', icon: 'water' },
  { key: 'soda', label: 'Soda', icon: 'wine' },
];

const DailyLoadModal: React.FC<DailyLoadModalProps> = ({
  visible,
  day,
  initialData,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);
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
    <ModalOverlay visible={visible} onClose={onClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('dailyLoad.title', { day })}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body}>
            {/* Main loads */}
            <Text style={styles.sectionTitle}>{t('dailyLoad.mainLoad')}</Text>
            <View style={styles.grid}>
              {LOAD_FIELDS.map((f) => (
                <View key={f.key} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>
                    <Ionicons name={f.icon} size={16} /> {f.label}
                  </Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={data[f.key as keyof DailyLoad]}
                    onChangeText={(v) => updateField(f.key, v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.textDisabled}
                  />
                </View>
              ))}
            </View>

            {/* Extra loads */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              {t('dailyLoad.extras')}
            </Text>
            <View style={styles.grid}>
              {LOAD_FIELDS.map((f) => (
                <View key={`${f.key}_extra`} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>
                    <Ionicons name={f.icon} size={16} /> {f.label} {t('dailyLoad.extra')}
                  </Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={data[`${f.key}_extra` as keyof DailyLoad]}
                    onChangeText={(v) => updateField(`${f.key}_extra`, v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.textDisabled}
                  />
                </View>
              ))}
            </View>

            {/* Notes */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              {t('dailyLoad.dayNotes')}
            </Text>
            <TextInput
              style={styles.notesInput}
              value={data.pedidos_note}
              onChangeText={(v) => updateField('pedidos_note', v)}
              placeholder={t('dailyLoad.notesPlaceholder')}
              placeholderTextColor={colors.textHint}
              multiline
              numberOfLines={3}
            />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>{t('save')}</Text>
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
    backgroundColor: colors.modalBackground,
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
  body: { padding: s(16) },
  sectionTitle: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: s(10),
  },
  grid: { gap: s(8) },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(6),
    borderBottomWidth: 1,
    borderBottomColor: colors.sectionBackground,
  },
  fieldLabel: {
    fontSize: s(16),
    color: colors.textSecondary,
    fontWeight: '500',
  },
  fieldInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: s(8),
    paddingHorizontal: s(16),
    paddingVertical: s(8),
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    width: s(80),
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(16),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    textAlignVertical: 'top',
    minHeight: s(80),
  },
  footer: {
    padding: s(16),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  saveBtn: {
    backgroundColor: colors.primary,
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

export default DailyLoadModal;
