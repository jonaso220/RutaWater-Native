import React from 'react';
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
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getModalWidth } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';
import {
  useWhatsAppTemplates,
  DEFAULT_EN_CAMINO,
  DEFAULT_DEUDA,
  DEFAULT_RECORDATORIO,
} from '../hooks/useWhatsAppTemplates';

interface WhatsAppTemplatesModalProps {
  visible: boolean;
  onClose: () => void;
  uid: string;
  groupId: string | undefined;
}

const WhatsAppTemplatesModal: React.FC<WhatsAppTemplatesModalProps> = ({
  visible,
  onClose,
  uid,
  groupId,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);

  const {
    waEnCamino,
    setWaEnCamino,
    waDeuda,
    setWaDeuda,
    waRecordatorio,
    setWaRecordatorio,
    handleSaveTemplates,
    handleResetTemplates,
  } = useWhatsAppTemplates(uid, groupId);

  const handleSave = () => {
    handleSaveTemplates();
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
            <Text style={styles.headerTitle}>{t('settings.whatsappMessages')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.subtitle}>{t('settings.whatsappSubtitle')}</Text>

            <Text style={styles.templateLabel}>{t('settings.enCaminoLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waEnCamino}
              onChangeText={setWaEnCamino}
              placeholder={DEFAULT_EN_CAMINO}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={3}
            />

            <View style={styles.templateDivider} />

            <Text style={styles.templateLabel}>{t('settings.debtLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waDeuda}
              onChangeText={setWaDeuda}
              placeholder={DEFAULT_DEUDA}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={2}
            />
            <Text style={styles.templateHint}>{t('settings.debtHint')}</Text>

            <View style={styles.templateDivider} />

            <Text style={styles.templateLabel}>{t('settings.reminderLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waRecordatorio}
              onChangeText={setWaRecordatorio}
              placeholder={DEFAULT_RECORDATORIO}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={4}
            />

            <View style={styles.templateActions}>
              <TouchableOpacity onPress={handleSave} style={styles.templateSaveBtn}>
                <Ionicons name="checkmark" size={Math.round(16 * fontScale)} color="#FFFFFF" />
                <Text style={styles.templateSaveBtnText}>{t('settings.saveTemplates')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleResetTemplates} style={styles.templateResetBtn}>
                <Ionicons name="refresh" size={Math.round(16 * fontScale)} color={colors.textMuted} />
                <Text style={styles.templateResetBtnText}>{t('settings.resetTemplates')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
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
      paddingHorizontal: isTablet ? s(24) : s(8),
      paddingVertical: isTablet ? s(24) : 0,
    },
    modal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: s(20),
      borderTopRightRadius: s(20),
      borderBottomLeftRadius: isTablet ? s(20) : 0,
      borderBottomRightRadius: isTablet ? s(20) : 0,
      maxHeight: Platform.OS === 'android' ? '100%' : '90%',
      maxWidth: isTablet ? undefined : 600,
      alignSelf: 'center',
      width: isTablet ? modalWidth : '100%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: s(16),
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: { fontSize: s(20), fontWeight: '700', color: colors.textPrimary },
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
    subtitle: { fontSize: s(14), color: colors.textMuted, marginBottom: s(14) },
    templateDivider: {
      height: 1,
      backgroundColor: colors.sectionBackground,
      marginVertical: s(14),
    },
    templateLabel: {
      fontSize: s(14),
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: s(6),
    },
    templateInput: {
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
      padding: s(12),
      fontSize: s(15),
      color: colors.textPrimary,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      textAlignVertical: 'top',
      minHeight: s(60),
    },
    templateHint: {
      fontSize: s(12),
      color: colors.textHint,
      marginTop: s(4),
    },
    templateActions: {
      flexDirection: 'row',
      gap: s(8),
      marginTop: s(14),
      marginBottom: s(8),
    },
    templateSaveBtn: {
      flex: 1,
      flexDirection: 'row',
      gap: s(6),
      backgroundColor: colors.primary,
      paddingVertical: s(12),
      borderRadius: s(10),
      alignItems: 'center',
      justifyContent: 'center',
    },
    templateSaveBtnText: {
      color: colors.textWhite,
      fontWeight: '700',
      fontSize: s(15),
    },
    templateResetBtn: {
      flex: 1,
      flexDirection: 'row',
      gap: s(6),
      backgroundColor: colors.sectionBackground,
      paddingVertical: s(12),
      borderRadius: s(10),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    templateResetBtnText: {
      color: colors.textMuted,
      fontWeight: '700',
      fontSize: s(15),
    },
  });
};

export default WhatsAppTemplatesModal;
