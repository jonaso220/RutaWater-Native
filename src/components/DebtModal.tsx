import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Client, Debt } from '../types';
import { normalizePhone } from '../utils/helpers';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface DebtModalProps {
  visible: boolean;
  client: Client | null;
  debts: Debt[];
  debtTemplate?: string;
  onClose: () => void;
  onAddDebt: (client: Client, amount: number) => void;
  onMarkPaid: (debt: Debt) => void;
  onEditDebt: (debtId: string, newAmount: number) => void;
}

const DebtModal: React.FC<DebtModalProps> = ({
  visible,
  client,
  debts,
  debtTemplate,
  onClose,
  onAddDebt,
  onMarkPaid,
  onEditDebt,
}) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [newAmount, setNewAmount] = useState('');
  const [editingDebt, setEditingDebt] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  if (!client) return null;

  const clientDebts = debts.filter((d) => d.clientId === client.id);
  const total = clientDebts.reduce((sum, d) => sum + (d.amount || 0), 0);

  const handleAdd = () => {
    const amount = parseFloat(newAmount);
    if (!amount || amount <= 0) return;
    onAddDebt(client, amount);
    setNewAmount('');
  };

  const handlePaid = (debt: Debt) => {
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

  const handleSaveEdit = (debtId: string) => {
    const amount = parseFloat(editAmount);
    if (!amount || amount <= 0) return;
    onEditDebt(debtId, amount);
    setEditingDebt(null);
    setEditAmount('');
  };

  const sendDebtTotal = () => {
    if (!client.phone || total <= 0) return;
    const cleanPhone = normalizePhone(client.phone);
    const defaultTemplate = 'La deuda es de ${total}. Saludos';
    const template = debtTemplate || defaultTemplate;
    const text = template.replace('${total}', `$${total.toLocaleString()}`);
    const msg = encodeURIComponent(text);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${msg}`);
  };

  const sendDebtReminder = () => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    const msg = encodeURIComponent(
      'Hola, buenas \nEste es un mensaje automatico para informarle que, segun nuestros registros, quedo pendiente un saldo por regularizar.\nCuando pueda, le agradecemos que nos indique en que fecha podriamos saldarlo. Si necesita nuevamente los datos de la cuenta, con gusto se los enviamos.\nMuchas gracias.',
    );
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${msg}`);
  };

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

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>
                {(client.name || '').toUpperCase()}
              </Text>
              {total > 0 && (
                <Text style={styles.totalText}>
                  Total: ${total.toLocaleString()}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Existing debts */}
            {clientDebts.length > 0 ? (
              clientDebts.map((debt) => (
                <View key={debt.id} style={styles.debtCard}>
                  {editingDebt === debt.id ? (
                    <View style={styles.editRow}>
                      <TextInput
                        style={styles.editInput}
                        value={editAmount}
                        onChangeText={setEditAmount}
                        keyboardType="numeric"
                        placeholder="Monto"
                        placeholderTextColor={colors.textHint}
                        autoFocus
                      />
                      <TouchableOpacity
                        onPress={() => handleSaveEdit(debt.id)}
                        style={styles.saveEditBtn}
                      >
                        <Text style={styles.saveEditText}>OK</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setEditingDebt(null);
                          setEditAmount('');
                        }}
                        style={styles.cancelEditBtn}
                      >
                        <Text style={styles.cancelEditText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.debtRow}>
                      <View>
                        <Text style={styles.debtAmount}>
                          ${debt.amount?.toLocaleString()}
                        </Text>
                        <Text style={styles.debtDate}>
                          {formatDate(debt.createdAt)}
                        </Text>
                      </View>
                      <View style={styles.debtActions}>
                        <TouchableOpacity
                          onPress={() => {
                            setEditingDebt(debt.id);
                            setEditAmount(String(debt.amount || ''));
                          }}
                          style={styles.debtActionBtn}
                        >
                          <Text>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handlePaid(debt)}
                          style={[styles.debtActionBtn, styles.paidBtn]}
                        >
                          <Text style={styles.paidBtnText}>Pagada</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>💰</Text>
                <Text style={styles.emptyText}>Sin deudas registradas</Text>
              </View>
            )}

            {/* WhatsApp buttons */}
            {total > 0 && client.phone && (
              <View style={styles.whatsappSection}>
                <TouchableOpacity
                  onPress={sendDebtTotal}
                  style={styles.whatsappBtn}
                >
                  <Text style={styles.whatsappBtnText}>
                    💬 Enviar total (${total.toLocaleString()})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={sendDebtReminder}
                  style={[styles.whatsappBtn, styles.whatsappBtnSecondary]}
                >
                  <Text style={styles.whatsappBtnSecondaryText}>
                    💬 Enviar recordatorio
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Add new debt */}
          <View style={styles.footer}>
            <View style={styles.addRow}>
              <Text style={styles.currencySign}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={newAmount}
                onChangeText={setNewAmount}
                keyboardType="numeric"
                placeholder="Monto"
                placeholderTextColor={colors.textHint}
              />
              <TouchableOpacity
                onPress={handleAdd}
                style={[
                  styles.addBtn,
                  !newAmount && styles.addBtnDisabled,
                ]}
                disabled={!newAmount}
              >
                <Text style={styles.addBtnText}>Agregar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modal: {
    backgroundColor: colors.modalBackground,
    borderRadius: 20,
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  totalText: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.danger,
    marginTop: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: colors.textMuted,
  },
  body: {
    padding: 16,
  },
  debtCard: {
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debtAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.danger,
  },
  debtDate: {
    fontSize: 13,
    color: colors.textHint,
    marginTop: 2,
  },
  debtActions: {
    flexDirection: 'row',
    gap: 8,
  },
  debtActionBtn: {
    padding: 8,
    borderRadius: 8,
  },
  paidBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: 12,
  },
  paidBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 15,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 10,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.textDisabled,
  },
  saveEditBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveEditText: {
    color: colors.textWhite,
    fontWeight: '700',
  },
  cancelEditBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  cancelEditText: {
    color: colors.textMuted,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textHint,
  },
  whatsappSection: {
    marginTop: 16,
    gap: 8,
  },
  whatsappBtn: {
    backgroundColor: '#25D366',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  whatsappBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 16,
  },
  whatsappBtnSecondary: {
    backgroundColor: colors.sectionBackground,
  },
  whatsappBtnSecondaryText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 16,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currencySign: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textMuted,
  },
  amountInput: {
    flex: 1,
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  addBtn: {
    backgroundColor: colors.danger,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 16,
  },
});

export default DebtModal;
