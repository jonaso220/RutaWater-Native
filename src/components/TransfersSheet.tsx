import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Linking,
  Platform,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { Transfer } from '../types';
import { normalizePhone } from '../utils/helpers';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface TransfersSheetProps {
  visible: boolean;
  transfers: Transfer[];
  onReview: (transfer: Transfer) => void;
  onClose: () => void;
}

const TransfersSheet: React.FC<TransfersSheetProps> = ({
  visible,
  transfers,
  onReview,
  onClose,
}) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const modalWidth = isTablet ? Math.min(windowWidth - 48, 720) : undefined;
  const styles = getStyles(colors, isTablet, modalWidth);

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '';
    const date = timestamp.seconds
      ? new Date(timestamp.seconds * 1000)
      : new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleReview = (transfer: Transfer) => {
    Alert.alert(
      t('transfers.reviewTitle'),
      t('transfers.reviewMsg', { name: transfer.clientName }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('transfers.reviewed'),
          onPress: () => onReview(transfer),
        },
      ],
    );
  };

  const openMaps = (transfer: Transfer) => {
    if (transfer.clientLat && transfer.clientLng) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${transfer.clientLat},${transfer.clientLng}`,
      );
    } else if (transfer.clientMapsLink) {
      Linking.openURL(transfer.clientMapsLink);
    }
  };

  const renderTransfer = ({ item }: { item: Transfer }) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <Text style={styles.clientName}>
          {(item.clientName || '').toUpperCase()}
        </Text>
        {item.clientAddress ? (
          <Text style={styles.clientAddress}>{item.clientAddress}</Text>
        ) : null}
        <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
      </View>
      <View style={styles.cardActions}>
        {((item.clientLat && item.clientLng) || item.clientMapsLink) && (
          <TouchableOpacity
            onPress={() => openMaps(item)}
            style={styles.actionBtn}
          >
            <Ionicons name="location-sharp" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => handleReview(item)}
          style={styles.reviewBtn}
        >
          <Text style={styles.reviewBtnText}>{t('transfers.reviewed')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>{t('transfers.title')}</Text>
              <Text style={styles.headerCount}>
                {t('transfers.pendingCount', { count: transfers.length })}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={transfers}
            renderItem={renderTransfer}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <MaterialCommunityIcons name="bank-outline" size={40} color={colors.textHint} style={{ marginBottom: 8 }} />
                <Text style={styles.emptyText}>
                  {t('transfers.noTransfers')}
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: isTablet ? 'center' : 'flex-end',
    alignItems: 'center',
    paddingHorizontal: isTablet ? 24 : 8,
    paddingVertical: isTablet ? 24 : 0,
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: isTablet ? 20 : 0,
    borderBottomRightRadius: isTablet ? 20 : 0,
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '85%' : '80%',
    maxWidth: isTablet ? undefined : 600,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
    overflow: 'hidden' as const,
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
  headerCount: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
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
  list: { padding: 12 },
  card: {
    backgroundColor: colors.successBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  cardContent: { flex: 1, marginRight: 12 },
  clientName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  clientAddress: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  date: {
    fontSize: 13,
    color: colors.textHint,
    marginTop: 4,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: { padding: 6 },
  reviewBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  reviewBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 15,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyText: {
    fontSize: 16,
    color: colors.textHint,
  },
});

export default TransfersSheet;
