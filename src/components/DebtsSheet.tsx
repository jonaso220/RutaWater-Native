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
  onEditDebt: (debtId: string, newAmount: number) => void;
  onClose: () => void;
  onTransferPayment?: (clientId: string) => void;
}

interface ClientDebtGroup {
  clientId: string;
  clientName: string;
  clientPhone: string;
  total: number;
  debts: Debt[];
}

const DebtsSheet: React.FC<DebtsSheetProps> = ({
  visible,
  debts,
  clients,
  isAdmin,
  onMarkPaid,
  onEditDebt,
  onClose,
  onTransferPayment,
}) => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [searchTerm, setSearchTerm] = useState('');

  // Group debts by client
  const clientGroups: ClientDebtGroup[] = React.useMemo(() => {
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
        };
      }
      grouped[debt.clientId].total += debt.amount || 0;
      grouped[debt.clientId].debts.push(debt);
    });

    return Object.values(grouped).sort((a, b) => b.total - a.total);
  }, [debts, clients]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return clientGroups;
    const term = normalizeText(searchTerm);
    return clientGroups.filter((g) =>
      normalizeText(g.clientName).includes(term),
    );
  }, [clientGroups, searchTerm]);

  const grandTotal = clientGroups.reduce((sum, g) => sum + g.total, 0);

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '';
    const date = timestamp.seconds
      ? new Date(timestamp.seconds * 1000)
      : new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });
  };

  const handleMarkPaid = (debt: Debt) => {
    Alert.alert(
      'Confirmar pago',
      `${debt.clientName} pago $${debt.amount?.toLocaleString()}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Pagada',
          onPress: () => onMarkPaid(debt),
        },
      ],
    );
  };

  const openWhatsAppChat = (group: ClientDebtGroup) => {
    if (!group.clientPhone) return;
    const cleanPhone = normalizePhone(group.clientPhone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
  };

  const renderGroup = ({ item }: { item: ClientDebtGroup }) => (
    <View style={styles.card}>
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
      {item.debts.map((debt) => (
        <View key={debt.id} style={styles.debtRow}>
          <View>
            <Text style={styles.debtAmount}>
              ${debt.amount?.toLocaleString()}
            </Text>
            <Text style={styles.debtDate}>{formatDate(debt.createdAt)}</Text>
          </View>
          <TouchableOpacity
            onPress={() => handleMarkPaid(debt)}
            style={styles.paidBtn}
          >
            <Text style={styles.paidBtnText}>Pagada</Text>
          </TouchableOpacity>
        </View>
      ))}
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
              <Text style={styles.headerCount}>
                {clientGroups.length} cliente{clientGroups.length !== 1 ? 's' : ''} — Total: ${grandTotal.toLocaleString()}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

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
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.dangerBorder,
  },
  debtAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.danger,
  },
  debtDate: {
    fontSize: 13,
    color: colors.textHint,
    marginTop: 2,
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
