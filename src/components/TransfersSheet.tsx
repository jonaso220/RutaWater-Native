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
import { normalizePhone, getModalWidth } from '../utils/helpers';
import { formatShortDateTime } from '../utils/format';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

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
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);

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
        <Text style={styles.date}>{formatShortDateTime(item.createdAt)}</Text>
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

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
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
    borderTopLeftRadius: s(20),
    borderTopRightRadius: s(20),
    borderBottomLeftRadius: isTablet ? s(20) : 0,
    borderBottomRightRadius: isTablet ? s(20) : 0,
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
    padding: s(16),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: s(20),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerCount: {
    fontSize: s(14),
    color: colors.textMuted,
    marginTop: s(2),
  },
  closeBtn: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: s(18), color: colors.textMuted },
  list: { padding: s(12) },
  card: {
    backgroundColor: colors.successBg,
    borderRadius: s(12),
    padding: s(14),
    marginBottom: s(8),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  cardContent: { flex: 1, marginRight: s(12) },
  clientName: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  clientAddress: {
    fontSize: s(14),
    color: colors.textMuted,
    marginTop: s(2),
  },
  date: {
    fontSize: s(13),
    color: colors.textHint,
    marginTop: s(4),
  },
  cardActions: {
    flexDirection: 'row',
    gap: s(8),
    alignItems: 'center',
  },
  actionBtn: { padding: s(6) },
  reviewBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: s(8),
  },
  reviewBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(15),
  },
  empty: {
    alignItems: 'center',
    paddingVertical: s(40),
  },
  emptyEmoji: { fontSize: s(40), marginBottom: s(8) },
  emptyText: {
    fontSize: s(16),
    color: colors.textHint,
  },
  });
};

export default TransfersSheet;
