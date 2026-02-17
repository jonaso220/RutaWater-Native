import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import { Transfer } from '../types';
import { normalizePhone } from '../utils/helpers';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface TransfersSheetProps {
  visible: boolean;
  transfers: Transfer[];
  isAdmin: boolean;
  onReview: (transfer: Transfer) => void;
  onClose: () => void;
}

const TransfersSheet: React.FC<TransfersSheetProps> = ({
  visible,
  transfers,
  isAdmin,
  onReview,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);

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
      'Transferencia revisada?',
      `Confirmar que revisaste la transferencia de ${transfer.clientName}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Revisada',
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
            <Text>📍</Text>
          </TouchableOpacity>
        )}
        {isAdmin && (
          <TouchableOpacity
            onPress={() => handleReview(item)}
            style={styles.reviewBtn}
          >
            <Text style={styles.reviewBtnText}>Revisada</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Transferencias</Text>
              <Text style={styles.headerCount}>
                {transfers.length} pendiente
                {transfers.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={transfers}
            renderItem={renderTransfer}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🏦</Text>
                <Text style={styles.emptyText}>
                  No hay transferencias pendientes
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
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
