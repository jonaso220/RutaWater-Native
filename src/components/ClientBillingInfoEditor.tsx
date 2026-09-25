import React, { useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardTypeOptions } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { ClientBillingInfo } from '../utils/clientBillingInfo';

interface ClientBillingInfoEditorProps {
  value: ClientBillingInfo;
  onChange: (value: ClientBillingInfo) => void;
}

const ClientBillingInfoEditor: React.FC<ClientBillingInfoEditorProps> = ({ value, onChange }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { fontScale } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);

  const fields: {
    key: keyof ClientBillingInfo;
    icon: string;
    placeholder: string;
    keyboardType: KeyboardTypeOptions;
    autoCapitalize: 'none' | 'words' | 'characters';
  }[] = [
    { key: 'rut', icon: 'document-text-outline', placeholder: t('clientBilling.rutPlaceholder'), keyboardType: 'numbers-and-punctuation', autoCapitalize: 'characters' },
    { key: 'businessName', icon: 'business-outline', placeholder: t('clientBilling.businessNamePlaceholder'), keyboardType: 'default', autoCapitalize: 'words' },
    { key: 'email', icon: 'mail-outline', placeholder: t('clientBilling.emailPlaceholder'), keyboardType: 'email-address', autoCapitalize: 'none' },
  ];

  return (
    <View>
      {fields.map((field) => (
        <View key={field.key} style={styles.fieldInput}>
          <Ionicons name={field.icon} size={Math.round(18 * fontScale)} color={colors.textMuted} />
          <TextInput
            style={styles.input}
            value={value[field.key]}
            onChangeText={(text) => onChange({ ...value, [field.key]: text })}
            placeholder={field.placeholder}
            placeholderTextColor={colors.textHint}
            keyboardType={field.keyboardType}
            autoCapitalize={field.autoCapitalize}
            autoCorrect={false}
            textContentType={field.key === 'email' ? 'emailAddress' : field.key === 'businessName' ? 'organizationName' : 'none'}
          />
          {value[field.key].length > 0 && (
            <TouchableOpacity onPress={() => onChange({ ...value, [field.key]: '' })} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    fieldInput: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
      paddingHorizontal: s(12),
      paddingVertical: s(12),
      borderWidth: 1,
      borderColor: colors.inputBorder,
      marginBottom: s(10),
    },
    input: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      padding: 0,
    },
    clearBtn: {
      padding: s(6),
    },
    clearBtnText: {
      fontSize: s(16),
      color: colors.textHint,
    },
  });
};

export default ClientBillingInfoEditor;
