import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { Client, Debt } from '../types';
import { normalizePhone, normalizeText, fuzzyMatch } from '../utils/helpers';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from 'react-i18next';
import { ThemeColors } from '../theme/colors';

interface DebtsSheetProps {
  visible: boolean;
  debts: Debt[];
  clients: Client[];
  isAdmin: boolean;
  onMarkPaid: (debt: Debt) => Promise<void>;
  onMarkAllPaid: (clientId: string, debtIds: string[]) => Promise<void>;
  onEditDebt: (debtId: string, newAmount: number) => Promise<void>;
  onClose: () => void;
  onTransferPayment?: (clientId: string) => void;
  onAddDebt?: (client: Client, amount: number) => Promise<void>;
  reminderTemplate?: string;
}

type SortMode = 'date' | 'amount';

interface ClientDebtGroup {
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
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
  onAddDebt,
  reminderTemplate,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = getStyles(colors);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [addAmount, setAddAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingDebt, setEditingDebt] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

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
          clientAddress: client?.address || '',
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

  // Clients with existing debts (for "Debe" badge)
  const debtClientIds = useMemo(() => new Set(debts.map((d) => d.clientId)), [debts]);

  // Filtered clients for add panel
  const addPanelClients = useMemo(() => {
    const matcher = fuzzyMatch(addSearch);
    return clients.filter((c) => matcher(c.name || '', c.address || '', c.phone || ''));
  }, [clients, addSearch]);

  const handleAddDebt = async () => {
    if (!selectedClient || !onAddDebt || saving) return;
    const amount = parseFloat(addAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      await onAddDebt(selectedClient, amount);
      setAddAmount('');
      setSelectedClient(null);
      setShowAddPanel(false);
    } finally {
      setSaving(false);
    }
  };

  const closeAddPanel = () => {
    setShowAddPanel(false);
    setAddSearch('');
    setSelectedClient(null);
    setAddAmount('');
  };

  const handleSaveEdit = async (debtId: string) => {
    const amount = parseFloat(editAmount);
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
    if (saving) return;
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

  const handleMarkAllPaid = (group: ClientDebtGroup) => {
    if (saving) return;
    Alert.alert(
      t('debtsSheet.allPaidTitle'),
      t('debtsSheet.allPaidMsg', { name: group.clientName, count: group.debts.length, total: group.total.toLocaleString() }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('debtsSheet.allPaid'),
          onPress: async () => {
            setSaving(true);
            try {
              await onMarkAllPaid(group.clientId, group.debts.map((d) => d.id));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const openWhatsAppChat = (group: ClientDebtGroup) => {
    if (!group.clientPhone) return;
    const cleanPhone = normalizePhone(group.clientPhone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
  };

  const sendReminder = (group: ClientDebtGroup) => {
    if (!group.clientPhone) return;
    const cleanPhone = normalizePhone(group.clientPhone);
    const defaultMsg = 'Hola, buenas \nEste es un mensaje automatico para informarle que, segun nuestros registros, quedo pendiente un saldo por regularizar.\nCuando pueda, le agradecemos que nos indique en que fecha podriamos saldarlo. Si necesita nuevamente los datos de la cuenta, con gusto se los enviamos.\nMuchas gracias.';
    const msg = encodeURIComponent(reminderTemplate || defaultMsg);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${msg}`);
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
          {item.clientAddress ? (
            <Text style={styles.clientAddress}>{item.clientAddress}</Text>
          ) : null}
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
              <Ionicons name="chatbubble" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          {onTransferPayment && (
            <TouchableOpacity
              onPress={() => onTransferPayment(item.clientId)}
              style={styles.transferBtn}
            >
              <Text style={styles.transferBtnText}><MaterialCommunityIcons name="bank" size={14} /> {t('clientCard.transfer')}</Text>
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
                  onPress={() => { setEditingDebt(null); setEditAmount(''); }}
                  style={styles.cancelEditBtn}
                >
                  <Text style={styles.cancelEditText}>X</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
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
                <View style={styles.debtActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingDebt(debt.id);
                      setEditAmount(String(debt.amount || ''));
                    }}
                    style={styles.editBtn}
                  >
                    <Ionicons name="pencil" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleMarkPaid(debt)}
                    style={[styles.paidBtn, saving && { opacity: 0.5 }]}
                    disabled={saving}
                  >
                    <Text style={styles.paidBtnText}>{t('debtModal.paid')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        );
      })}
      {/* Pay all button - solo si hay más de 1 deuda */}
      {item.debts.length > 1 && (
        <TouchableOpacity
          onPress={() => handleMarkAllPaid(item)}
          style={[styles.payAllBtn, saving && { opacity: 0.5 }]}
          disabled={saving}
        >
          <Text style={styles.payAllBtnText}><Ionicons name="checkmark" size={14} /> {t('debtsSheet.payAll', { count: item.debts.length })}</Text>
        </TouchableOpacity>
      )}
      {/* Reminder button */}
      {item.clientPhone ? (
        <TouchableOpacity
          onPress={() => sendReminder(item)}
          style={styles.reminderBtn}
        >
          <Text style={styles.reminderBtnText}><Ionicons name="chatbubble" size={14} /> {t('debtModal.sendReminder')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <ModalOverlay visible={visible} onClose={() => { setSearchTerm(''); setEditingDebt(null); setEditAmount(''); closeAddPanel(); onClose(); }} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('debtsSheet.title')}</Text>
            <View style={styles.headerRight}>
              {onAddDebt && (
                <TouchableOpacity onPress={() => setShowAddPanel(true)} style={styles.addDebtBtn}>
                  <Ionicons name="add" size={18} color={colors.textWhite} />
                  <Text style={styles.addDebtBtnText}>{t('debtsSheet.addBtn')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => { setSearchTerm(''); setEditingDebt(null); setEditAmount(''); closeAddPanel(); onClose(); }} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Resumen general */}
          {debts.length > 0 && (
            <View style={styles.summaryRow}>
              <View style={[styles.summaryBox, styles.summaryBoxDanger]}>
                <Text style={styles.summaryValueDanger}>${grandTotal.toLocaleString()}</Text>
                <Text style={styles.summaryLabelDanger}>{t('total')}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryValue}>{uniqueClients}</Text>
                <Text style={styles.summaryLabel}>{t('debtsSheet.client', { count: uniqueClients })}</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryValue}>{debts.length}</Text>
                <Text style={styles.summaryLabel}>{t('debtsSheet.debt', { count: debts.length })}</Text>
              </View>
            </View>
          )}

          <View style={styles.searchSection}>
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={16} color={colors.textHint} style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                value={searchTerm}
                onChangeText={setSearchTerm}
                placeholder={t('debtsSheet.searchPlaceholder')}
                placeholderTextColor={colors.textHint}
                autoCorrect={false}
              />
              {searchTerm.length > 0 && (
                <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.clearBtn}>
                  <Ionicons name="close" size={16} color={colors.textHint} />
                </TouchableOpacity>
              )}
            </View>
            {searchTerm.trim().length > 0 && (
              <Text style={styles.searchResultCount}>
                {t('debtsSheet.resultCount', { count: filteredGroups.length })}
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
                  {t('debtsSheet.sortRecent')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSortMode('amount')}
                style={[styles.sortBtn, sortMode === 'amount' && styles.sortBtnActive]}
              >
                <Text style={[styles.sortBtnText, sortMode === 'amount' && styles.sortBtnTextActive]}>
                  {t('debtsSheet.sortAmount')}
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
                <Ionicons name="cash-outline" size={40} color={colors.textHint} style={{ marginBottom: 8 }} />
                <Text style={styles.emptyText}>
                  {t('debtsSheet.noDebts')}
                </Text>
              </View>
            }
          />
        </View>
      </KeyboardAvoidingView>

      {/* Add Debt Panel */}
      <ModalOverlay visible={showAddPanel} onClose={closeAddPanel} animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <View style={styles.modal}>
            <View style={styles.header}>
              <View style={styles.addPanelTitleRow}>
                <Ionicons name="cash" size={22} color={colors.danger} />
                <Text style={styles.headerTitle}>{t('debtsSheet.addDebtTitle')}</Text>
              </View>
              <TouchableOpacity onPress={closeAddPanel} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {selectedClient ? (
              /* Amount input for selected client */
              <View style={styles.addAmountSection}>
                <View style={styles.selectedClientRow}>
                  <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                    <Text style={styles.avatarText}>{(selectedClient.name || '?')[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientName}>{(selectedClient.name || '').toUpperCase()}</Text>
                    {selectedClient.address ? (
                      <Text style={styles.clientAddress}>{selectedClient.address}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSelectedClient(null); setAddAmount(''); }}>
                    <Ionicons name="arrow-back" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={styles.addAmountRow}>
                  <Text style={styles.currencySign}>$</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={addAmount}
                    onChangeText={setAddAmount}
                    keyboardType="numeric"
                    placeholder={t('amount')}
                    placeholderTextColor={colors.textHint}
                    autoFocus
                  />
                  <TouchableOpacity
                    onPress={handleAddDebt}
                    style={[styles.confirmAddBtn, (!addAmount || saving) && styles.confirmAddBtnDisabled]}
                    disabled={!addAmount || saving}
                  >
                    <Text style={styles.confirmAddBtnText}>{t('add')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* Client search list */
              <>
                <View style={styles.searchSection}>
                  <View style={styles.searchInputWrapper}>
                    <Ionicons name="search" size={16} color={colors.textHint} style={{ marginRight: 6 }} />
                    <TextInput
                      style={styles.searchInput}
                      value={addSearch}
                      onChangeText={setAddSearch}
                      placeholder={t('debtsSheet.searchPlaceholder')}
                      placeholderTextColor={colors.textHint}
                      autoCorrect={false}
                      autoFocus
                    />
                    {addSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setAddSearch('')} style={styles.clearBtn}>
                        <Ionicons name="close" size={16} color={colors.textHint} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <FlatList
                  data={addPanelClients}
                  keyboardShouldPersistTaps="handled"
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.addPanelList}
                  renderItem={({ item: client }) => (
                    <TouchableOpacity
                      style={styles.addPanelRow}
                      onPress={() => setSelectedClient(client)}
                    >
                      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                        <Text style={styles.avatarText}>{(client.name || '?')[0].toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.addPanelName}>{(client.name || '').toUpperCase()}</Text>
                        {client.address ? (
                          <Text style={styles.addPanelAddress} numberOfLines={1}>{client.address}</Text>
                        ) : null}
                      </View>
                      {debtClientIds.has(client.id) && (
                        <Text style={styles.debtBadge}>{t('debtsSheet.owes')}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <View style={styles.empty}>
                      <Text style={styles.emptyText}>{t('debtsSheet.noClientsFound')}</Text>
                    </View>
                  }
                />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </ModalOverlay>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Platform.OS === 'android' ? '100%' : '85%',
    maxWidth: 600,
    alignSelf: 'center' as const,
    width: '100%' as const,
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addDebtBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  addDebtBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 14,
  },
  addPanelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    padding: 10,
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
  clientAddress: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: 1,
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
  debtActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  editBtn: {
    padding: 8,
    borderRadius: 8,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
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
  reminderBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  reminderBtnText: {
    color: colors.textSecondary,
    fontWeight: '600',
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
  // Add debt panel
  addPanelList: {
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  addPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 16,
  },
  addPanelName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  addPanelAddress: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  debtBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // Selected client amount input
  addAmountSection: {
    padding: 16,
    gap: 16,
  },
  selectedClientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addAmountRow: {
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
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  confirmAddBtn: {
    backgroundColor: colors.danger,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  confirmAddBtnDisabled: {
    opacity: 0.5,
  },
  confirmAddBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 16,
  },
});

export default DebtsSheet;
