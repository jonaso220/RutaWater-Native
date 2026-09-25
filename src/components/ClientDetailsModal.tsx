import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Pressable, Share, Alert, ScrollView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import ModalOverlay from './ModalOverlay';
import { Client } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getClientPhones } from '../utils/clientPhones';
import { normalizeGoogleMapsLink } from '../utils/googleMapsLink';
import { buildClientShareMessage, sanitizeClientBillingInfo } from '../utils/clientBillingInfo';

interface ClientDetailsModalProps {
  visible: boolean;
  client: Client;
  onClose: () => void;
  // Abre la edición del cliente para completar RUT / razón social / email.
  onEdit?: () => void;
  fontScale?: number;
}

const ClientDetailsModal: React.FC<ClientDetailsModalProps> = ({
  visible,
  client,
  onClose,
  onEdit,
  fontScale = 1,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const s = (v: number) => Math.round(v * fontScale);
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);

  const billing = sanitizeClientBillingInfo(client);
  const mapsLink = normalizeGoogleMapsLink(client.mapsLink);
  const phones = getClientPhones(client).map((phone) => phone.number).join(' / ') || client.phone || '';

  const rows: { icon: string; label: string; value: string }[] = [
    { icon: 'location-outline', label: t('clientBilling.address'), value: client.address || '' },
    { icon: 'map-outline', label: t('clientBilling.location'), value: mapsLink },
    { icon: 'mail-outline', label: t('clientBilling.email'), value: billing.email },
    { icon: 'call-outline', label: t('clientBilling.phone'), value: phones },
  ].filter((row) => !!row.value);

  const handleShare = async () => {
    const message = buildClientShareMessage(client, {
      title: t('clientBilling.shareTitle'),
      name: t('clientBilling.name'),
      address: t('clientBilling.address'),
      location: t('clientBilling.location'),
      rut: t('clientBilling.rut'),
      businessName: t('clientBilling.businessName'),
      email: t('clientBilling.email'),
      phone: t('clientBilling.phone'),
    });
    try {
      await Share.share({ message });
    } catch (e) {
      Alert.alert(t('error'), t('clientBilling.shareError'));
    }
  };

  const handleEdit = () => {
    onClose();
    onEdit?.();
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="fade">
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('close')}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={2}>{(client.name || '').trim()}</Text>
              <Text style={styles.subtitle}>{t('clientBilling.detailsTitle')}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
            >
              <Ionicons name="close" size={s(20)} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} bounces={false}>
            {/* RUT destacado: es el dato que más se copia para facturar */}
            <View style={[styles.rutCard, !billing.rut && styles.rutCardEmpty]}>
              <Text style={styles.rutLabel}>{t('clientBilling.rut')}</Text>
              {billing.rut ? (
                <Text style={styles.rutValue} selectable>{billing.rut}</Text>
              ) : (
                <Text style={styles.rutMissing}>{t('clientBilling.noRut')}</Text>
              )}
              {!!billing.businessName && (
                <Text style={styles.businessName} selectable>{billing.businessName}</Text>
              )}
            </View>

            {rows.map((row) => (
              <View key={row.label} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name={row.icon} size={s(18)} color={colors.textSecondary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue} selectable numberOfLines={3}>{row.value}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={t('clientBilling.share')}
          >
            <Ionicons name="share-outline" size={s(20)} color={colors.textWhite} />
            <Text style={styles.shareButtonText}>{t('clientBilling.share')}</Text>
          </TouchableOpacity>
          {onEdit && (
            <TouchableOpacity
              style={styles.editButton}
              onPress={handleEdit}
              accessibilityRole="button"
              accessibilityLabel={t('clientBilling.editData')}
            >
              <Ionicons name="create-outline" size={s(18)} color={colors.primary} />
              <Text style={styles.editButtonText}>
                {billing.rut ? t('clientBilling.editData') : t('clientBilling.addRut')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, scale: number) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
      padding: s(16),
      paddingBottom: s(24),
    },
    sheet: {
      width: '100%',
      maxWidth: s(440),
      maxHeight: '85%',
      alignSelf: 'center',
      backgroundColor: colors.modalBackground,
      borderRadius: s(20),
      padding: s(14),
      borderWidth: 1,
      borderColor: colors.cardBorder,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: 0.16,
      shadowRadius: 14,
      elevation: 12,
    },
    handle: {
      width: s(38),
      height: s(4),
      borderRadius: s(2),
      backgroundColor: colors.cardBorder,
      alignSelf: 'center',
      marginBottom: s(10),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: s(12),
      paddingHorizontal: s(2),
    },
    headerText: {
      flex: 1,
    },
    title: {
      color: colors.textPrimary,
      fontSize: s(17),
      fontWeight: '800',
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: s(12),
      marginTop: s(2),
    },
    closeButton: {
      width: s(34),
      height: s(34),
      borderRadius: s(17),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    body: {
      flexGrow: 0,
    },
    rutCard: {
      backgroundColor: colors.primaryLighter,
      borderRadius: s(14),
      borderWidth: 1,
      borderColor: colors.primaryInactiveBorder,
      paddingVertical: s(14),
      paddingHorizontal: s(16),
      marginBottom: s(10),
    },
    rutCardEmpty: {
      backgroundColor: colors.sectionBackground,
      borderColor: colors.cardBorder,
    },
    rutLabel: {
      color: colors.textMuted,
      fontSize: s(12),
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    rutValue: {
      color: colors.primaryText,
      fontSize: s(24),
      fontWeight: '800',
      letterSpacing: 0.5,
      marginTop: s(4),
      fontVariant: ['tabular-nums'],
    },
    rutMissing: {
      color: colors.textMuted,
      fontSize: s(15),
      fontWeight: '600',
      marginTop: s(4),
    },
    businessName: {
      color: colors.textSecondary,
      fontSize: s(15),
      fontWeight: '600',
      marginTop: s(4),
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(12),
      paddingVertical: s(9),
      paddingHorizontal: s(4),
    },
    rowIcon: {
      width: s(34),
      height: s(34),
      borderRadius: s(10),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowText: {
      flex: 1,
    },
    rowLabel: {
      color: colors.textMuted,
      fontSize: s(12),
      fontWeight: '600',
    },
    rowValue: {
      color: colors.textPrimary,
      fontSize: s(15),
      marginTop: s(1),
    },
    shareButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(8),
      backgroundColor: colors.primary,
      borderRadius: s(12),
      paddingVertical: s(14),
      marginTop: s(12),
    },
    shareButtonText: {
      color: colors.textWhite,
      fontSize: s(16),
      fontWeight: '700',
    },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(8),
      borderRadius: s(12),
      paddingVertical: s(12),
      marginTop: s(6),
    },
    editButtonText: {
      color: colors.primary,
      fontSize: s(15),
      fontWeight: '600',
    },
  });
};

export default ClientDetailsModal;
