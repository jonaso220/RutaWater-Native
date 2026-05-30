import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  KeyboardTypeOptions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

interface PromptModalProps {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  keyboardType?: KeyboardTypeOptions;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const PromptModal: React.FC<PromptModalProps> = ({
  visible,
  title,
  message,
  placeholder,
  defaultValue = '',
  keyboardType,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const styles = getStyles(colors, fontScale);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
    }
  }, [visible, defaultValue]);

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  return (
    <ModalOverlay visible={visible} onClose={onCancel} animationType="fade">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textHint}
            keyboardType={keyboardType}
            autoFocus
            onSubmitEditing={handleSubmit}
          />
          <View style={styles.buttons}>
            <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              style={[styles.submitBtn, !value.trim() && styles.submitBtnDisabled]}
              disabled={!value.trim()}
            >
              <Text style={styles.submitText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(32),
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: s(16),
    padding: s(20),
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: s(19),
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    fontSize: s(15),
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: s(6),
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: s(10),
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    fontSize: s(17),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginTop: s(16),
  },
  buttons: {
    flexDirection: 'row',
    marginTop: s(16),
    gap: s(10),
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: s(12),
    borderRadius: s(10),
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
  },
  cancelText: {
    fontSize: s(17),
    fontWeight: '600',
    color: colors.textMuted,
  },
  submitBtn: {
    flex: 1,
    paddingVertical: s(12),
    borderRadius: s(10),
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: s(17),
    fontWeight: '700',
    color: colors.textWhite,
  },
  });
};

export default PromptModal;
