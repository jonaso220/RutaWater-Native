import React, { useEffect, useRef, useState, useMemo } from 'react';
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
import { Client, Transfer } from '../types';
import { getModalWidth, normalizePhone } from '../utils/helpers';
import {
  buildClientIdentityIndex,
  getRelatedRecordStableClientId,
  resolveClientForRelatedRecord,
  resolveClientForStableId,
} from '../utils/clientIdentity';
import { formatMoney, formatShortDateTime } from '../utils/format';
import { parseDate } from '../utils/helpers';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

interface TransfersSheetProps {
  visible: boolean;
  transfers: Transfer[];
  // Para encontrar el teléfono del cliente (la transferencia no lo guarda).
  clients: Client[];
  // Deuda actual del cliente: para transferencias viejas que no guardaron el monto.
  getDebtTotal: (clientId: string) => number;
  // Tocar la tarjeta abre la ficha del cliente.
  onOpenClient: (client: Client) => void;
  onReview: (transfer: Transfer) => Promise<void>;
  onClose: () => void;
}

const OLD_DAYS = 7;
const UNDO_MS = 5000;

/** «HOTEL CENTRAL» → «Hotel Central»; lo que ya está en minúsculas queda igual. */
const displayName = (name: string): string => {
  const letters = name.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s(\-/])([a-záéíóúñü])/g, (_m, sep, ch) => sep + ch.toUpperCase());
};

const daysSince = (value: unknown): number | null => {
  const date = parseDate(value as any);
  return date ? Math.floor((Date.now() - date.getTime()) / 86400000) : null;
};

const TransfersSheet: React.FC<TransfersSheetProps> = ({
  visible,
  transfers,
  clients,
  getDebtTotal,
  onOpenClient,
  onReview,
  onClose,
}) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = useMemo(
    () => getStyles(colors, isTablet, modalWidth, fontScale),
    [colors, isTablet, modalWidth, fontScale],
  );
  // Revisadas que se están guardando: siguen ocultas hasta que Firestore las
  // borra. Son independientes entre sí, así que sin señal ninguna se pierde ni
  // bloquea el cierre de la ventana.
  const [committingIds, setCommittingIds] = useState<ReadonlySet<string>>(() => new Set());

  // «Revisada» se aplica a los 5 s: mientras tanto la tarjeta se oculta y abajo
  // aparece «Deshacer» (Jonathan, 24/10/2026; antes pedía confirmar cada una).
  const [pendingReview, setPendingReview] = useState<Transfer | null>(null);
  const pendingRef = useRef<{ transfer: Transfer; timer: ReturnType<typeof setTimeout> } | null>(null);

  const commitReview = async (transfer: Transfer) => {
    setCommittingIds((ids) => new Set(ids).add(transfer.id));
    try {
      await onReview(transfer);
    } catch {
      Alert.alert(t('error'), t('transfers.reviewError'));
    } finally {
      setCommittingIds((ids) => {
        const next = new Set(ids);
        next.delete(transfer.id);
        return next;
      });
    }
  };

  const flushPending = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    setPendingReview(null);
    commitReview(pending.transfer);
  };

  const handleReview = (transfer: Transfer) => {
    flushPending();
    const timer = setTimeout(flushPending, UNDO_MS);
    pendingRef.current = { transfer, timer };
    setPendingReview(transfer);
  };

  const undoReview = () => {
    if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    setPendingReview(null);
  };

  // Al cerrar (o desmontar) se aplica lo que estaba esperando el «Deshacer».
  useEffect(() => () => flushPending(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = () => {
    flushPending();
    onClose();
  };

  const identityIndex = useMemo(() => buildClientIdentityIndex(clients), [clients]);
  const clientFor = (transfer: Transfer): Client | null => (
    resolveClientForStableId(getRelatedRecordStableClientId(transfer, identityIndex), identityIndex)
      || resolveClientForRelatedRecord(transfer, identityIndex)
      || null
  );

  // Las más viejas primero: son las que quedaron colgadas.
  const visibleTransfers = useMemo(() => transfers
    .filter((transfer) => transfer.id !== pendingReview?.id && !committingIds.has(transfer.id))
    .sort((a, b) => (parseDate(a.createdAt as any)?.getTime() || 0) - (parseDate(b.createdAt as any)?.getTime() || 0)),
  [transfers, pendingReview, committingIds]);

  // Abre el chat del cliente, por ejemplo para responder al comprobante (Jonathan, 24/10/2026).
  const openWhatsAppChat = (phone: string) => {
    Linking.openURL(`whatsapp://send?phone=${normalizePhone(phone)}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorWhatsApp'));
    });
  };

  const renderTransfer = ({ item }: { item: Transfer }) => {
    const client = clientFor(item);
    const phone = client?.phone || '';
    const days = daysSince(item.createdAt);
    const isOld = days !== null && days > OLD_DAYS;
    const currentDebt = !item.amount && client ? getDebtTotal(client.id) : 0;
    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardContent}
          onPress={client ? () => { flushPending(); onOpenClient(client); } : undefined}
          disabled={!client}
          accessibilityRole="button"
        >
          <Text style={styles.clientName}>{displayName(item.clientName || '')}</Text>
          {item.amount ? (
            <Text style={styles.amount}>
              {formatMoney(item.amount)}{item.account ? ` · ${item.account}` : ''}
            </Text>
          ) : currentDebt > 0 ? (
            <Text style={styles.amountMuted}>{t('transfers.currentDebt', { amount: formatMoney(currentDebt) })}</Text>
          ) : null}
          {item.clientAddress ? (
            <Text style={styles.clientAddress}>{item.clientAddress}</Text>
          ) : null}
          <Text style={[styles.date, isOld && styles.dateOld]}>
            {formatShortDateTime(item.createdAt)}
            {days !== null ? ` · ${days === 0 ? t('transfers.today') : t('transfers.daysAgo', { count: days })}` : ''}
          </Text>
        </TouchableOpacity>
        <View style={styles.cardActions}>
          {phone ? (
            <TouchableOpacity
              onPress={() => openWhatsAppChat(phone)}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('debtsSheet.openChat')}
            >
              <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => handleReview(item)}
            style={styles.reviewBtn}
          >
            <Text style={styles.reviewBtnText}>{t('transfers.reviewed')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <ModalOverlay visible={visible} onClose={requestClose} animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>{t('transfers.title')}</Text>
              <Text style={styles.headerCount}>
                {t('transfers.pendingCount', { count: visibleTransfers.length })}
              </Text>
            </View>
            <TouchableOpacity onPress={requestClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={visibleTransfers}
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
          {pendingReview ? (
            <View style={styles.undoBar}>
              <Text style={styles.undoText} numberOfLines={1}>
                {t('transfers.markedReviewed', { name: displayName(pendingReview.clientName || '') })}
              </Text>
              <TouchableOpacity onPress={undoReview} accessibilityRole="button" style={styles.undoBtn}>
                <Text style={styles.undoBtnText}>{t('transfers.undo')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
  dateOld: {
    color: colors.dangerBright,
    fontWeight: '600',
  },
  amount: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.success,
    marginTop: s(2),
  },
  amountMuted: {
    fontSize: s(14),
    color: colors.textSecondary,
    marginTop: s(2),
  },
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: s(12),
    marginBottom: s(12),
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    borderRadius: s(10),
    backgroundColor: colors.sectionBackground,
  },
  undoText: { flex: 1, fontSize: s(14), color: colors.textPrimary, marginRight: s(12) },
  undoBtn: { paddingHorizontal: s(8), paddingVertical: s(4) },
  undoBtnText: { fontSize: s(15), fontWeight: '700', color: colors.primary },
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

export default React.memo(TransfersSheet);
