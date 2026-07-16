import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Client } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { getModalWidth } from '../utils/helpers';
import ModalOverlay from './ModalOverlay';

interface ClientNotesModalProps {
  visible: boolean;
  client: Client | null;
  onSave: (clientId: string, data: Partial<Client>) => Promise<boolean>;
  onClose: () => void;
}

const ClientNotesModal: React.FC<ClientNotesModalProps> = ({
  visible,
  client,
  onSave,
  onClose,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const { fontScale } = useLayout();
  const styles = useMemo(
    () => getStyles(colors, getModalWidth(width), fontScale),
    [colors, fontScale, width],
  );
  const inputRef = useRef<TextInput>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !client) return;
    setNotes(client.notes || '');
    setSaving(false);
    const timer = setTimeout(() => inputRef.current?.focus(), 240);
    return () => clearTimeout(timer);
  }, [client?.id, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!client) return null;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const saved = await onSave(client.id, { notes });
    setSaving(false);
    if (!saved) {
      Alert.alert(t('error'), t('clientNotesModal.saveError'));
      return;
    }
    onClose();
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>{t('clientNotesModal.eyebrow')}</Text>
              <Text style={styles.title} numberOfLines={1}>{client.name}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.label}>{t('clientNotesModal.label')}</Text>
            <View style={styles.inputContainer}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={notes}
                onChangeText={setNotes}
                placeholder={t('clientNotesModal.placeholder')}
                placeholderTextColor={colors.textHint}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
              {notes.length > 0 && (
                <TouchableOpacity
                  onPress={() => setNotes('')}
                  style={styles.clearButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('clientNotesModal.clear')}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t('clientNotesModal.save')}
            >
              <Text style={styles.saveButtonText}>{t('clientNotesModal.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, modalWidth: number | undefined, scale: number) => {
  const s = (value: number) => Math.round(value * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.overlay,
      padding: s(16),
    },
    modal: {
      width: modalWidth || '100%',
      backgroundColor: colors.modalBackground,
      borderRadius: s(20),
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: s(16),
      paddingVertical: s(14),
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      color: colors.warningDark,
      fontSize: s(12),
      fontWeight: '800',
      textTransform: 'uppercase',
      marginBottom: s(2),
    },
    title: {
      color: colors.textPrimary,
      fontSize: s(18),
      fontWeight: '800',
    },
    closeButton: {
      width: s(34),
      height: s(34),
      borderRadius: s(17),
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.sectionBackground,
    },
    body: { padding: s(16) },
    label: {
      color: colors.textMuted,
      fontSize: s(13),
      fontWeight: '700',
      marginBottom: s(8),
    },
    inputContainer: {
      minHeight: s(150),
      borderRadius: s(14),
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      padding: s(12),
    },
    input: {
      minHeight: s(126),
      color: colors.textPrimary,
      fontSize: s(16),
      lineHeight: s(22),
      padding: 0,
      paddingRight: s(28),
    },
    clearButton: {
      position: 'absolute',
      top: s(8),
      right: s(8),
      padding: s(4),
    },
    footer: {
      padding: s(16),
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    saveButton: {
      minHeight: s(48),
      borderRadius: s(12),
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.primary,
    },
    saveButtonText: {
      color: colors.textWhite,
      fontSize: s(16),
      fontWeight: '800',
    },
    buttonDisabled: { opacity: 0.6 },
  });
};

export default ClientNotesModal;
