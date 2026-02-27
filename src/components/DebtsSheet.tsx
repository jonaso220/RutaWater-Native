import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Client, Debt } from '../types';
import { normalizePhone, normalizeText } from '../utils/helpers';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface DebtsSheetProps {
  visible: boolean;
  debts: Debt[];
  clients: Client[];
  isAdmin: boolean;
  onMarkPaid: (debt: Debt) => void;
  onMarkAllPaid: (clientId: string, debtIds: string[]) => void;
  onEditDebt: (debtId: string, newAmount: number) => void;
  onClose: () => void;
  onTransferPayment?: (clientId: string) => void;
}

type SortMode = 'date' | 'amount';

interface ClientDebtGroup {
  clientId: string;
  clientName: string;
  clientPhone: string;
  total: number;
  debts: Debt[];
  maxAgeDays: number;
}

const DebtsSheet: React.FC<DebtsSheetProps> = ({
  visible,
  debts,
  clients,
  isAdmin,
  onMarkPaid,
  onMarkAllPaid,
  onEditDebt,
  onClose,
  onTransferPayment,
}) => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date');

  const now = Date.now();

  const getAgeDays = (timestamp: any): number => {
    if (!timestamp) return 0;
    const ts = timestamp.seconds ? timestamp.seconds * 1000 : timestamp;
    return Math.floor((now - ts) / 86400000);
  };

  // Group debts by client
  const clientGroups: ClientDebtGroup[] = useMemo(() => {
    const grouped: Record<string, ClientDebtGroup> = {};

    debts.forEach((debt) => {
      if (!grouped[debt.clientId]) {
        const client = clients.find((c) => c.id === debt.clientId);
        grouped[debt.clientId] = {
          clientId: debt.clientId,
          clientName: debt.clientName || client?.name || '',
          clientPhone: client?.phone || '',
          total: 0,
          debts: [],
          maxAgeDays: 0,
        };
      }
      grouped[debt.clientId].total += debt.amount || 0;
      grouped[debt.clientId].debts.push(debt);
      const age = getAgeDays(debt.createdAt);
      if (age > grouped[debt.clientId].maxAgeDays) {
        grouped[debt.clientId].maxAgeDays = age;
      }
    });

    const groups = Object.values(grouped);

    if (sortMode === 'amount') {
      groups.sort((a, b) => b.total - a.total);
    } else {
      // Sort by most recent debt
      groups.sort((a, b) => {
        const latestA = Math.max(...a.debts.map((d) => (d.createdAt as any)?.seconds || 0));
        const latestB = Math.max(...b.debts.map((d) => (d.createdAt as any)?.seconds || 0));
        return latestB - latestA;
      });
    }

    return groups;
  }, [debts, clients, sortMode]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return clientGroups;
    const term = normalizeText(searchTerm);
    return clientGroups.filter((g) =>
      normalizeText(g.clientName).includes(term),
    );
  }, [clientGroups, searchTerm]);

  const grandTotal = debts.reduce((sum, d) => sum + (d.amount || 0), 0);
  const uniqueClients = new Set(debts.map((d) => d.clientId)).size;

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '';
    const date = timestamp.seconds
      ? new Date(timestamp.seconds * 1000)
      : new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const handleMarkPaid = (debt: Debt) => {
    Alert.alert(
      'Confirmar pago',
      `${debt.clientName} pagó $${debt.amount?.toLocaleString()}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Pagada',
          onPress: () => onMarkPaid(debt),
        },
      ],
    );
  };

  const handleMarkAllPaid = (group: ClientDebtGroup) => {
    Alert.alert(
      '¿Todas pagadas?',
      `Confirmar que ${group.clientName} pagó todas sus deudas (${group.debts.length}) por un total de $${group.total.toLocaleString()}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Todas pagadas',
          onPress: () => onMarkAllPaid(group.clientId, group.debts.map((d) => d.id)),
        },
      ],
    );
  };

  const openWhatsAppChat = (group: ClientDebtGroup) => {
    if (!group.clientPhone) return;
    const cleanPhone = normalizePhone(group.clientPhone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
  };

  const getBorderColor = (maxAge: number) => {
    if (maxAge > 30) return colors.danger;
    if (maxAge > 15) return colors.warningAmber;
    return colors.dangerBright;
  };

  const renderGroup = ({ item }: { item: ClientDebtGroup }) => (
    <View style={[styles.card, { borderLeftColor: getBorderColor(item.maxAgeDays) }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.clientName}>
            {(item.clientName || '').toUpperCase()}
          </Text>
          <Text style={styles.totalAmount}>
            ${item.total.toLocaleString()}
          </Text>
        </View>
        <View style={styles.cardActions}>
          {item.clientPhone ? (
            <TouchableOpacity
              onPress={() => openWhatsAppChat(item)}
              style={styles.actionBtn}
            >
              <Text>💬</Text>
            </TouchableOpacity>
          ) : null}
          {onTransferPayment && (
            <TouchableOpacity
              onPress={() => onTransferPayment(item.clientId)}
              style={styles.transferBtn}
            >
              <Text style={styles.transferBtnText}>🏦 Transf</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {item.debts.map((debt, idx) => {
        const ageDays = getAgeDays(debt.createdAt);
        const showBadge = ageDays > 15;
        const badgeBg = ageDays > 30 ? colors.dangerLight : colors.warningAmberBg;
        const badgeText = ageDays > 30 ? colors.danger : colors.warningAmber;
        return (
          <View
            key={debt.id}
            style={[
              styles.debtRow,
              idx === 0 ? styles.debtRowFirst : styles.debtRowDashed,
            ]}
          >
            <View>
              <View style={styles.dateRow}>
                <Text style={styles.debtDate}>{formatDate(debt.createdAt)}</Text>
                {showBadge && (
                  <View style={[styles.ageBadge, { backgroundColor: badgeBg }]}>
                    <Text style={[styles.ageBadgeText, { color: badgeText }]}>
                      {ageDays}d
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.debtAmount}>
                ${debt.amount?.toLocaleString()}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleMarkPaid(debt)}
              style={styles.paidBtn}
            >
              <Text style={styles.paidBtnText}>Pagada</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {/* Pay all button - solo si hay más de 1 deuda */}
      {item.debts.length > 1 && (
        <TouchableOpacity
          onPress={() => handleMarkAllPaid(item)}
          style={styles.payAllBtn}
        >
          <Text style={styles.payAllBtnText}>✓ Pagar todas ({item.debts.length})</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { setSearchTerm(''); onClose(); }} onDismiss={() => setSearchTerm('')}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Deudas</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Resumen general */}
          {debts.length > 0 && (
            <View style={styles.summaryRow}>
              <View style={[styles.summaryBox, styles.summaryBoxDanger]}>
                <Text style={styles.summaryValueDanger}>${grandTotal.toLocaleString()}</Text>
                <Text style={styles.summaryLabelDanger}>Total</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryValue}>{uniqueClients}</Text>
                <Text style={styles.summaryLabel}>Cliente{uniqueClients !== 1 ? 's' : ''}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryValue}>{debts.length}</Text>
                <Text style={styles.summaryLabel}>Deuda{debts.length !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          )}

          <View style={styles.searchSection}>
            <View style={styles.searchInputWrapper}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                value={searchTerm}
                onChangeText={setSearchTerm}
                placeholder="Buscar cliente..."
                placeholderTextColor={colors.textHint}
                autoCorrect={false}
              />
              {searchTerm.length > 0 && (
                <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            {searchTerm.trim().length > 0 && (
              <Text style={styles.searchResultCount}>
                {filteredGroups.length} resultado{filteredGroups.length !== 1 ? 's' : ''}
              </Text>
            )}
          </View>

          {/* Sort toggle */}
          {debts.length > 0 && (
            <View style={styles.sortRow}>
              <TouchableOpacity
                onPress={() => setSortMode('date')}
                style={[styles.sortBtn, sortMode === 'date' && styles.sortBtnActive]}
              >
                <Text style={[styles.sortBtnText, sortMode === 'date' && styles.sortBtnTextActive]}>
                  Más reciente
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSortMode('amount')}
                style={[styles.sortBtn, sortMode === 'amount' && styles.sortBtnActive]}
              >
                <Text style={[styles.sortBtnText, sortMode === 'amount' && styles.sortBtnTextActive]}>
                  Mayor monto
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <FlatList
            data={filteredGroups}
            renderItem={renderGroup}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.clientId}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>💰</Text>
                <Text style={styles.emptyText}>
                  No hay deudas pendientes
                </Text>
              </View>
            }
          />
        </View>
      </KeyboardAvoidingView>
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
    maxHeight: '85%',
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
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 18, color: colors.textMuted },
  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  summaryBoxDanger: {
    backgroundColor: colors.dangerLight,
  },
  summaryValueDanger: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.danger,
  },
  summaryLabelDanger: {
    fontSize: 10,
    color: colors.danger,
    opacity: 0.7,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textHint,
    fontWeight: '600',
  },
  // Search
  searchSection: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    padding: 0,
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    fontSize: 16,
    color: colors.textHint,
  },
  searchResultCount: {
    fontSize: 13,
    color: colors.textHint,
    marginTop: 4,
  },
  // Sort
  sortRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  sortBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.sectionBackground,
    alignItems: 'center',
  },
  sortBtnActive: {
    backgroundColor: colors.danger,
  },
  sortBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textHint,
  },
  sortBtnTextActive: {
    color: colors.textWhite,
  },
  // List
  list: { padding: 12 },
  card: {
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  clientName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.danger,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: { padding: 6 },
  transferBtn: {
    backgroundColor: colors.successLighter,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.successLight,
  },
  transferBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.successDark,
  },
  // Debt rows
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  debtRowFirst: {
    borderTopWidth: 1,
    borderTopColor: colors.dangerBorder,
  },
  debtRowDashed: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.dangerBorder,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  debtAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.danger,
  },
  debtDate: {
    fontSize: 13,
    color: colors.textHint,
  },
  ageBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  ageBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  paidBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  paidBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 15,
  },
  // Pay all button
  payAllBtn: {
    backgroundColor: colors.success,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  payAllBtnText: {
    color: colors.textWhite,
    fontWeight: '800',
    fontSize: 14,
  },
  // Empty
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

export default DebtsSheet;
