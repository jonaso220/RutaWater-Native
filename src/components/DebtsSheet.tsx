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
import { Client, Debt } from '../types';
import { normalizePhone } from '../utils/helpers';

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

  const grandTotal = clientGroups.reduce((sum, g) => sum + g.total, 0);

  const formatDate = (timestamp: any): string => {
    if (!timestamp) return '';
    const date = timestamp.seconds
      ? new Date(timestamp.seconds * 1000)
      : new Date(timestamp);
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
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
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

          <FlatList
            data={clientGroups}
            renderItem={renderGroup}
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
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#FFFFFF',
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
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  headerCount: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 16, color: '#6B7280' },
  list: { padding: 12 },
  card: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#DC2626',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  clientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#DC2626',
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: { padding: 6 },
  transferBtn: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  transferBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#FECACA',
  },
  debtAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#991B1B',
  },
  debtDate: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  paidBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  paidBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
});

export default DebtsSheet;
