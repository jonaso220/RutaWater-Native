import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { ClientPhone } from '../types';
import { createClientPhone, normalizeEditableClientPhones } from '../utils/clientPhones';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

interface Props {
  phones: ClientPhone[];
  onChange: (phones: ClientPhone[]) => void;
}

const MAX_PHONES = 5;

const ClientPhonesEditor: React.FC<Props> = ({ phones, onChange }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { fontScale } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);
  const normalizedPhones = useMemo(() => normalizeEditableClientPhones(phones), [phones]);
  const nonEmptyCount = normalizedPhones.filter((phone) => phone.number.trim()).length;

  const updatePhone = (index: number, updates: Partial<ClientPhone>) => {
    onChange(normalizeEditableClientPhones(normalizedPhones.map((phone, currentIndex) =>
      currentIndex === index ? { ...phone, ...updates } : phone,
    )));
  };

  const setPrimary = (index: number) => {
    if (!normalizedPhones[index]?.number.trim()) return;
    onChange(normalizedPhones.map((phone, currentIndex) => ({
      ...phone,
      isPrimary: currentIndex === index,
    })));
  };

  const removePhone = (index: number) => {
    if (normalizedPhones.length <= 1) return;
    const remaining = normalizedPhones.filter((_, currentIndex) => currentIndex !== index);
    onChange(normalizeEditableClientPhones(remaining));
  };

  const addPhone = () => {
    if (normalizedPhones.length >= MAX_PHONES) return;
    const id = `phone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onChange(normalizeEditableClientPhones([
      ...normalizedPhones,
      createClientPhone(id),
    ]));
  };

  return (
    <View>
      {normalizedPhones.map((phone, index) => {
        const isOnlyNumber = !!phone.number.trim() && nonEmptyCount === 1;
        const isPrimary = phone.isPrimary;
        return (
          <View
            key={phone.id}
            style={[styles.phoneCard, isPrimary && styles.phoneCardPrimary]}
          >
            <View style={styles.phoneHeader}>
              <TouchableOpacity
                onPress={() => setPrimary(index)}
                disabled={!phone.number.trim() || isOnlyNumber}
                style={[styles.primaryButton, isPrimary && styles.primaryButtonSelected]}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: isPrimary,
                  disabled: !phone.number.trim() || isOnlyNumber,
                }}
                accessibilityLabel={isPrimary
                  ? t('clientPhones.primary')
                  : t('clientPhones.makePrimary')}
              >
                <Ionicons
                  name={isPrimary ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={isPrimary ? colors.primary : colors.textHint}
                />
                <Text style={[styles.primaryText, isPrimary && styles.primaryTextSelected]}>
                  {isPrimary ? t('clientPhones.primary') : t('clientPhones.makePrimary')}
                </Text>
              </TouchableOpacity>
              {normalizedPhones.length > 1 && (
                <TouchableOpacity
                  onPress={() => removePhone(index)}
                  style={styles.removeButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('clientPhones.remove')}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.inputRow}>
              <Ionicons name="call-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                value={phone.number}
                onChangeText={(number) => updatePhone(index, { number })}
                placeholder={t('editModal.phonePlaceholder')}
                placeholderTextColor={colors.textHint}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
              />
              {!!phone.number && (
                <TouchableOpacity
                  onPress={() => updatePhone(index, { number: '' })}
                  style={styles.clearButton}
                  accessibilityLabel={t('clientPhones.clear')}
                >
                  <Ionicons name="close" size={17} color={colors.textHint} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}

      <TouchableOpacity
        onPress={addPhone}
        disabled={normalizedPhones.length >= MAX_PHONES}
        style={[styles.addButton, normalizedPhones.length >= MAX_PHONES && styles.addButtonDisabled]}
        accessibilityRole="button"
      >
        <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.addButtonText}>{t('clientPhones.add')}</Text>
      </TouchableOpacity>
      <View style={styles.helpRow}>
        <Ionicons name="information-circle-outline" size={15} color={colors.textHint} />
        <Text style={styles.helpText}>{t('clientPhones.help')}</Text>
      </View>
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number) => {
  const s = (value: number) => Math.round(value * scale);
  return StyleSheet.create({
    phoneCard: {
      backgroundColor: colors.sectionBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: s(12),
      padding: s(10),
      marginBottom: s(10),
      gap: s(8),
    },
    phoneCardPrimary: {
      backgroundColor: colors.primaryLighter,
      borderColor: colors.primaryBorder,
    },
    phoneHeader: {
      minHeight: s(34),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: s(8),
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(6),
      minHeight: s(34),
      paddingHorizontal: s(9),
      borderRadius: s(17),
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    primaryButtonSelected: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primaryBorder,
    },
    primaryText: {
      fontSize: s(12),
      fontWeight: '700',
      color: colors.textMuted,
    },
    primaryTextSelected: {
      color: colors.primaryText,
    },
    removeButton: {
      width: s(38),
      height: s(38),
      borderRadius: s(19),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dangerLight,
    },
    inputRow: {
      minHeight: s(46),
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    input: {
      flex: 1,
      paddingVertical: s(10),
      fontSize: s(15),
      color: colors.textPrimary,
    },
    clearButton: {
      padding: s(8),
      marginRight: -s(6),
    },
    addButton: {
      minHeight: s(46),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(8),
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      borderRadius: s(12),
      backgroundColor: colors.primaryLight,
    },
    addButtonDisabled: {
      opacity: 0.45,
    },
    addButtonText: {
      fontSize: s(15),
      fontWeight: '700',
      color: colors.primaryText,
    },
    helpRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: s(5),
      marginTop: s(7),
    },
    helpText: {
      flex: 1,
      fontSize: s(12),
      lineHeight: s(17),
      color: colors.textHint,
    },
  });
};

export default ClientPhonesEditor;
