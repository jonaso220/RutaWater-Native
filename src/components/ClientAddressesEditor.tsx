import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { ClientAddress, ClientAddressType } from '../types';
import { createClientAddress, getDefaultNewAddressType } from '../utils/clientAddresses';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

interface Props {
  addresses: ClientAddress[];
  onChange: (addresses: ClientAddress[]) => void;
}

const ADDRESS_TYPES: ClientAddressType[] = ['home', 'work', 'other'];

const ClientAddressesEditor: React.FC<Props> = ({ addresses, onChange }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { fontScale } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);

  const updateAddress = (index: number, updates: Partial<ClientAddress>) => {
    onChange(addresses.map((location, currentIndex) => {
      if (currentIndex !== index) return location;
      const locationChanged = updates.address !== undefined || updates.mapsLink !== undefined;
      return {
        ...location,
        ...updates,
        ...(locationChanged ? { lat: '', lng: '' } : null),
      };
    }));
  };

  const addAddress = () => {
    if (addresses.length >= 10) return;
    const id = `address-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onChange([
      ...addresses,
      createClientAddress(id, getDefaultNewAddressType(addresses)),
    ]);
  };

  return (
    <View>
      {addresses.map((location, index) => (
        <View key={location.id} style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <View style={styles.typeSelector}>
              {ADDRESS_TYPES.map((type) => {
                const selected = location.type === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => updateAddress(index, { type })}
                    style={[styles.typeChip, selected && styles.typeChipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(`clientAddresses.${type}`)}
                  >
                    <Ionicons
                      name={type === 'home' ? 'home-outline' : type === 'work' ? 'briefcase-outline' : 'location-outline'}
                      size={14}
                      color={selected ? colors.textWhite : colors.textMuted}
                    />
                    <Text style={[styles.typeChipText, selected && styles.typeChipTextSelected]}>
                      {t(`clientAddresses.${type}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {index > 0 && (
              <TouchableOpacity
                onPress={() => onChange(addresses.filter((_, currentIndex) => currentIndex !== index))}
                style={styles.removeButton}
                accessibilityRole="button"
                accessibilityLabel={t('clientAddresses.remove')}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.inputRow}>
            <Ionicons name="location-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              value={location.address}
              onChangeText={(address) => updateAddress(index, { address })}
              placeholder={t('clientAddresses.addressPlaceholder')}
              placeholderTextColor={colors.textHint}
            />
            {!!location.address && (
              <TouchableOpacity onPress={() => updateAddress(index, { address: '' })} style={styles.clearButton}>
                <Ionicons name="close" size={17} color={colors.textHint} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.inputRow}>
            <Ionicons name="link-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              value={location.mapsLink}
              onChangeText={(mapsLink) => updateAddress(index, { mapsLink })}
              placeholder={t('clientAddresses.mapsPlaceholder')}
              placeholderTextColor={colors.textHint}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!location.mapsLink && (
              <TouchableOpacity onPress={() => updateAddress(index, { mapsLink: '' })} style={styles.clearButton}>
                <Ionicons name="close" size={17} color={colors.textHint} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      <TouchableOpacity
        onPress={addAddress}
        disabled={addresses.length >= 10}
        style={[styles.addButton, addresses.length >= 10 && styles.addButtonDisabled]}
        accessibilityRole="button"
      >
        <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.addButtonText}>{t('clientAddresses.add')}</Text>
      </TouchableOpacity>
      <Text style={styles.helpText}>{t('clientAddresses.help')}</Text>
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number) => {
  const s = (value: number) => Math.round(value * scale);
  return StyleSheet.create({
    locationCard: {
      backgroundColor: colors.sectionBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: s(12),
      padding: s(10),
      marginBottom: s(10),
      gap: s(8),
    },
    locationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
    },
    typeSelector: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s(6),
    },
    typeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(4),
      minHeight: s(34),
      paddingHorizontal: s(10),
      borderRadius: s(17),
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    typeChipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    typeChipText: {
      fontSize: s(12),
      fontWeight: '700',
      color: colors.textMuted,
    },
    typeChipTextSelected: {
      color: colors.textWhite,
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
      minHeight: s(44),
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
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
    helpText: {
      fontSize: s(12),
      lineHeight: s(17),
      color: colors.textHint,
      marginTop: s(7),
    },
  });
};

export default ClientAddressesEditor;
