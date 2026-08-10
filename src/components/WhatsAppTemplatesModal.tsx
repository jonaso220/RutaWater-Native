import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
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
  DEFAULT_DEUDA,
  DEFAULT_RECORDATORIO,
} from '../hooks/useWhatsAppTemplates';
import { DEFAULT_EN_CAMINO, DEFAULT_TOMORROW_VISIT } from '../utils/whatsAppTemplates';

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
    waTomorrowVisit,
    setWaTomorrowVisit,
    waDeuda,
    setWaDeuda,
    waRecordatorio,
    setWaRecordatorio,
    waLoaded,
    waLoadError,
    reloadTemplates,
    discardDraft,
    handleSaveTemplates,
    handleResetTemplates,
  } = useWhatsAppTemplates(uid, groupId);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const runTemplateAction = async (
    action: () => Promise<boolean | void>,
    closeAfterSuccess: boolean,
  ) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const shouldClose = await action();
      if (closeAfterSuccess && shouldClose !== false) onClose();
    } catch {
      // The hook reports the persistence error. Keep the user's draft open so
      // the same action can be retried without retyping it.
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (!savingRef.current) {
      discardDraft();
      onClose();
    }
  };

  const handleSave = () => {
    void runTemplateAction(handleSaveTemplates, true);
  };

  const handleReset = () => {
    void runTemplateAction(handleResetTemplates, false);
  };

  return (
    <ModalOverlay visible={visible} onClose={requestClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('settings.whatsappMessages')}</Text>
            <TouchableOpacity onPress={requestClose} style={styles.closeBtn} disabled={saving}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {!waLoaded ? (
            <View style={styles.loadingBox}>
              {waLoadError ? (
                <>
                  <Text style={styles.loadingText}>{t('settings.templatesLoadError')}</Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={reloadTemplates}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.retryLoad')}
                  >
                    <Text style={styles.retryBtnText}>{t('settings.retryLoad')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.loadingText}>{t('settings.templatesLoadingMsg')}</Text>
                </>
              )}
            </View>
          ) : <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
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
              editable={!saving}
            />

            <View style={styles.templateDivider} />

            <Text style={styles.templateLabel}>{t('settings.tomorrowVisitLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waTomorrowVisit}
              onChangeText={setWaTomorrowVisit}
              placeholder={DEFAULT_TOMORROW_VISIT}
              placeholderTextColor={colors.textDisabled}
              accessibilityLabel={t('settings.tomorrowVisitLabel')}
              multiline
              numberOfLines={5}
              editable={!saving}
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
              editable={!saving}
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
              editable={!saving}
            />

            <View style={styles.templateActions}>
              <TouchableOpacity
                onPress={handleSave}
                style={styles.templateSaveBtn}
                disabled={saving}
              >
                <Ionicons name="checkmark" size={Math.round(16 * fontScale)} color="#FFFFFF" />
                <Text style={styles.templateSaveBtnText}>{t('settings.saveTemplates')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleReset}
                style={styles.templateResetBtn}
                disabled={saving}
              >
                <Ionicons name="refresh" size={Math.round(16 * fontScale)} color={colors.textMuted} />
                <Text style={styles.templateResetBtnText}>{t('settings.resetTemplates')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>}
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
    loadingBox: {
      minHeight: s(220),
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(12),
      paddingHorizontal: s(24),
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: s(13),
      textAlign: 'center',
    },
    retryBtn: {
      minHeight: s(44),
      paddingHorizontal: s(18),
      borderRadius: s(10),
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryBtnText: {
      color: colors.textWhite,
      fontSize: s(14),
      fontWeight: '700',
    },
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
