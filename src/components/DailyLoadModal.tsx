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
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import { DailyLoad } from '../hooks/useDailyLoads';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

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
  const styles = getStyles(colors);
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

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  modal: {
    backgroundColor: colors.modalBackground,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Platform.OS === 'android' ? '100%' : '85%',
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
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 18, color: colors.textMuted },
  body: { padding: 16 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
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
    borderBottomColor: colors.sectionBackground,
  },
  fieldLabel: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  fieldInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    width: 80,
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

export default DailyLoadModal;
