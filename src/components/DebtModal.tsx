import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { Client, Debt } from '../types';
import { normalizePhone, getClientMatchKey, getModalWidth, parseMoneyInput, parseDate } from '../utils/helpers';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

interface DebtModalProps {
  visible: boolean;
  client: Client | null;
  debts: Debt[];
  // Pasar la lista completa permite agrupar deudas de instancias duplicadas
  // del mismo cliente humano (nombre+teléfono iguales, IDs distintos).
  allClients?: Client[];
  debtTemplate?: string;
  reminderTemplate?: string;
  onClose: () => void;
  onAddDebt: (client: Client, amount: number) => Promise<void>;
  onMarkPaid: (debt: Debt) => Promise<void>;
  onMarkAllPaid: (clientId: string, debtIds: string[]) => Promise<void>;
  onEditDebt: (debtId: string, newAmount: number) => Promise<void>;
}

const DebtModal: React.FC<DebtModalProps> = ({
  visible,
  client,
  debts,
  allClients,
  debtTemplate,
  reminderTemplate,
  onClose,
  onAddDebt,
  onMarkPaid,
  onMarkAllPaid,
  onEditDebt,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);
  const [newAmount, setNewAmount] = useState('');
  const [editingDebt, setEditingDebt] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);

  // The modal stays mounted with client=null between opens; reset the form
  // whenever the target client changes so an amount typed for client A can't
  // be submitted against client B with one tap.
  useEffect(() => {
    setNewAmount('');
    setEditingDebt(null);
    setEditAmount('');
  }, [client?.id]);

  if (!client) return null;

  // Si tenemos la lista completa de clientes, expandimos el filtro a TODAS las
  // instancias duplicadas del mismo cliente humano (nombre+teléfono normalizados).
  // Sin allClients, comportamiento original: solo el clientId exacto.
  const matchingIds: Set<string> = (() => {
    if (!allClients || allClients.length === 0) return new Set([client.id]);
    const key = getClientMatchKey(client.name || '', client.phone || '', client.id);
    const ids = allClients
      .filter((c) => !c.isNote && getClientMatchKey(c.name || '', c.phone || '', c.id) === key)
      .map((c) => c.id);
    return new Set(ids.length > 0 ? ids : [client.id]);
  })();
  const clientDebts = debts.filter((d) => matchingIds.has(d.clientId));
  const total = clientDebts.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  const handleAdd = async () => {
    const amount = parseMoneyInput(newAmount);
    if (!amount || amount <= 0 || saving) return;
    setSaving(true);
    try {
      await onAddDebt(client, amount);
      setNewAmount('');
    } finally {
      setSaving(false);
    }
  };

  const handlePaid = (debt: Debt) => {
    Alert.alert(
      t('debtModal.confirmPayment'),
      t('debtModal.paidConfirm', { name: debt.clientName, amount: debt.amount?.toLocaleString() }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('debtModal.paid'),
          onPress: async () => {
            setSaving(true);
            try {
              await onMarkPaid(debt);
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleMarkAllPaid = () => {
    if (saving || clientDebts.length < 2) return;
    Alert.alert(
      t('debtsSheet.allPaidTitle'),
      t('debtsSheet.allPaidMsg', {
        name: client.name,
        count: clientDebts.length,
        total: total.toLocaleString(),
      }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('debtsSheet.allPaid'),
          onPress: async () => {
            setSaving(true);
            try {
              await onMarkAllPaid(client.id, clientDebts.map((d) => d.id));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleSaveEdit = async (debtId: string) => {
    const amount = parseMoneyInput(editAmount);
    if (!amount || amount <= 0 || saving) return;
    setSaving(true);
    try {
      await onEditDebt(debtId, amount);
      setEditingDebt(null);
      setEditAmount('');
    } finally {
      setSaving(false);
    }
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
    const defaultMsg = 'Hola, buenas \nEste es un mensaje automatico para informarle que, segun nuestros registros, quedo pendiente un saldo por regularizar.\nCuando pueda, le agradecemos que nos indique en que fecha podriamos saldarlo. Si necesita nuevamente los datos de la cuenta, con gusto se los enviamos.\nMuchas gracias.';
    const msg = encodeURIComponent(reminderTemplate || defaultMsg);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${msg}`);
  };

  const formatDate = (timestamp: any): string => {
    const date = parseDate(timestamp);
    if (!date) return '';
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="slide">
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
              <Ionicons name="close" size={18} color={colors.textMuted} />
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
                        placeholder={t('amount')}
                        placeholderTextColor={colors.textHint}
                        autoFocus
                      />
                      <TouchableOpacity
                        onPress={() => handleSaveEdit(debt.id)}
                        style={[styles.saveEditBtn, saving && { opacity: 0.6 }]}
                        disabled={saving}
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
                          <Ionicons name="pencil" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handlePaid(debt)}
                          style={[styles.debtActionBtn, styles.paidBtn, saving && { opacity: 0.6 }]}
                          disabled={saving}
                        >
                          <Text style={styles.paidBtnText}>{t('debtModal.paid')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="cash-outline" size={40} color={colors.textHint} style={{ marginBottom: 8 }} />
                <Text style={styles.emptyText}>{t('debtModal.noDebts')}</Text>
              </View>
            )}

            {/* Pay all button - solo si hay más de 1 deuda */}
            {clientDebts.length > 1 && (
              <TouchableOpacity
                onPress={handleMarkAllPaid}
                style={[styles.payAllBtn, saving && { opacity: 0.5 }]}
                disabled={saving}
              >
                <Text style={styles.payAllBtnText}>
                  <Ionicons name="checkmark" size={14} /> {t('debtsSheet.payAll', { count: clientDebts.length })}
                </Text>
              </TouchableOpacity>
            )}

            {/* WhatsApp buttons */}
            {total > 0 && client.phone && (
              <View style={styles.whatsappSection}>
                <TouchableOpacity
                  onPress={sendDebtTotal}
                  style={styles.whatsappBtn}
                >
                  <Text style={styles.whatsappBtnText}>
                    <Ionicons name="chatbubble" size={16} /> {t('debtModal.sendTotal', { amount: total.toLocaleString() })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={sendDebtReminder}
                  style={[styles.whatsappBtn, styles.whatsappBtnSecondary]}
                >
                  <Text style={styles.whatsappBtnSecondaryText}>
                    <Ionicons name="chatbubble" size={16} /> {t('debtModal.sendReminder')}
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
                placeholder={t('amount')}
                placeholderTextColor={colors.textHint}
              />
              <TouchableOpacity
                onPress={handleAdd}
                style={[
                  styles.addBtn,
                  (!newAmount || saving) && styles.addBtnDisabled,
                ]}
                disabled={!newAmount || saving}
              >
                <Text style={styles.addBtnText}>{t('add')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: isTablet ? 24 : 16,
    paddingVertical: isTablet ? 24 : 0,
  },
  modal: {
    backgroundColor: colors.modalBackground,
    borderRadius: s(20),
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '80%',
    maxWidth: isTablet ? undefined : 500,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
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
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  totalText: {
    fontSize: s(22),
    fontWeight: '800',
    color: colors.danger,
    marginTop: s(4),
  },
  closeBtn: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: s(18),
    color: colors.textMuted,
  },
  body: {
    padding: s(16),
  },
  debtCard: {
    backgroundColor: colors.dangerLight,
    borderRadius: s(12),
    padding: s(12),
    marginBottom: s(8),
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debtAmount: {
    fontSize: s(20),
    fontWeight: '800',
    color: colors.danger,
  },
  debtDate: {
    fontSize: s(13),
    color: colors.textHint,
    marginTop: s(2),
  },
  debtActions: {
    flexDirection: 'row',
    gap: s(8),
  },
  debtActionBtn: {
    padding: s(8),
    borderRadius: s(8),
  },
  paidBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: s(12),
  },
  paidBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(15),
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  editInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: s(8),
    padding: s(10),
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.textDisabled,
  },
  saveEditBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    borderRadius: s(8),
  },
  saveEditText: {
    color: colors.textWhite,
    fontWeight: '700',
  },
  cancelEditBtn: {
    paddingHorizontal: s(10),
    paddingVertical: s(10),
  },
  cancelEditText: {
    color: colors.textMuted,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: s(32),
  },
  emptyEmoji: {
    fontSize: s(40),
    marginBottom: s(8),
  },
  emptyText: {
    fontSize: s(16),
    color: colors.textHint,
  },
  payAllBtn: {
    backgroundColor: colors.success,
    paddingVertical: s(12),
    borderRadius: s(10),
    alignItems: 'center',
    marginTop: s(16),
  },
  payAllBtnText: {
    color: colors.textWhite,
    fontWeight: '800',
    fontSize: s(16),
  },
  whatsappSection: {
    marginTop: s(16),
    gap: s(8),
  },
  whatsappBtn: {
    backgroundColor: '#25D366',
    paddingVertical: s(12),
    borderRadius: s(10),
    alignItems: 'center',
  },
  whatsappBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  whatsappBtnSecondary: {
    backgroundColor: colors.sectionBackground,
  },
  whatsappBtnSecondaryText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: s(16),
  },
  footer: {
    padding: s(16),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  currencySign: {
    fontSize: s(22),
    fontWeight: '700',
    color: colors.textMuted,
  },
  amountInput: {
    flex: 1,
    backgroundColor: colors.inputBackground,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  addBtn: {
    backgroundColor: colors.danger,
    paddingHorizontal: s(20),
    paddingVertical: s(12),
    borderRadius: s(10),
  },
  addBtnDisabled: {
    opacity: 0.6,
  },
  addBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  });
};

export default DebtModal;
