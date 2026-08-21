import React, { useState, useMemo, useRef } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { Client, Debt } from '../types';
import { normalizePhone, fuzzyMatch, matchScore, getModalWidth, parseMoneyInput, parseDate } from '../utils/helpers';
import {
  buildClientIdentityIndex,
  getRelatedRecordStableClientId,
  getStableClientId,
  resolveClientForRelatedRecord,
  resolveClientForStableId,
} from '../utils/clientIdentity';
import { formatMoney, formatShortDate } from '../utils/format';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from 'react-i18next';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

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
  stableClientId: string;
  clientId: string;
  isUnlinked: boolean;
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
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [addAmount, setAddAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [editingDebt, setEditingDebt] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  const now = Date.now();

  const getAgeDays = (timestamp: any): number => {
    const d = parseDate(timestamp);
    return d ? Math.floor((now - d.getTime()) / 86400000) : 0;
  };

  const identityIndex = useMemo(() => buildClientIdentityIndex(clients), [clients]);

  // Agrupa solo por identidad explícita: customerId en documentos actuales o
  // el clientId exacto resuelto a través del cliente vivo para documentos
  // legacy. Nunca intenta adivinar por nombre/teléfono.
  const clientGroups: ClientDebtGroup[] = useMemo(() => {
    const grouped = new Map<string, ClientDebtGroup>();

    debts.forEach((debt) => {
      const stableClientId = getRelatedRecordStableClientId(debt, identityIndex);
      const client = resolveClientForStableId(stableClientId, identityIndex)
        || resolveClientForRelatedRecord(debt, identityIndex);
      const name = client?.name || debt.clientName || '';
      const phone = client?.phone || '';
      const key = stableClientId || `__debt_${debt.id}`;

      const group = grouped.get(key);
      if (!group) {
        grouped.set(key, {
          stableClientId: key,
          clientId: client?.id || debt.clientId,
          isUnlinked: !client,
          clientName: name,
          clientPhone: phone,
          clientAddress: client?.address || debt.clientAddress || '',
          total: 0,
          debts: [],
          maxAgeDays: 0,
        });
      } else {
        if (client) group.isUnlinked = false;
        if (!group.clientPhone && phone) group.clientPhone = phone;
        if (!group.clientAddress) {
          group.clientAddress = client?.address || debt.clientAddress || '';
        }
        if (client && !clients.some((c) => c.id === group.clientId)) {
          group.clientId = client.id;
        }
      }
      const targetGroup = grouped.get(key)!;
      targetGroup.total += Number(debt.amount) || 0;
      targetGroup.debts.push(debt);
      const age = getAgeDays(debt.createdAt);
      if (age > targetGroup.maxAgeDays) {
        targetGroup.maxAgeDays = age;
      }
    });

    const groups = Array.from(grouped.values());

    if (sortMode === 'amount') {
      groups.sort((a, b) => b.total - a.total);
    } else {
      // Sort by most recent debt
      groups.sort((a, b) => {
        const latestA = Math.max(...a.debts.map((d) => parseDate(d.createdAt)?.getTime() || 0));
        const latestB = Math.max(...b.debts.map((d) => parseDate(d.createdAt)?.getTime() || 0));
        return latestB - latestA;
      });
    }

    return groups;
  }, [debts, clients, sortMode, identityIndex]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return clientGroups;
    const matcher = fuzzyMatch(searchTerm);
    return clientGroups.filter((g) =>
      matcher(g.clientName || '', g.clientAddress || '', g.clientPhone || ''),
    );
  }, [clientGroups, searchTerm]);

  const indebtedStableIds = useMemo(() => {
    const set = new Set<string>();
    debts.forEach((d) => {
      set.add(getRelatedRecordStableClientId(d, identityIndex));
    });
    return set;
  }, [debts, identityIndex]);

  // Filtered clients for add panel — rank by matchScore so the most
  // relevant matches (exact name, prefix) appear first instead of being
  // buried below generic fuzzy matches.
  const addPanelClients = useMemo(() => {
    const matcher = fuzzyMatch(addSearch);
    const filtered = clients.filter((c) => matcher(c.name || '', c.address || '', c.phone || ''));
    if (!addSearch.trim()) return filtered;
    return filtered
      .map((c) => ({ c, score: matchScore(addSearch, c.name || '', c.address || '', c.phone || '') }))
      .sort((a, b) => b.score - a.score || (a.c.name || '').localeCompare(b.c.name || ''))
      .map((entry) => entry.c);
  }, [clients, addSearch]);

  const handleAddDebt = async () => {
    if (!selectedClient || !onAddDebt || savingRef.current) return;
    const amount = parseMoneyInput(addAmount);
    if (!amount || amount <= 0) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onAddDebt(selectedClient, amount);
      setAddAmount('');
      setSelectedClient(null);
      setShowAddPanel(false);
    } catch {
      Alert.alert(t('error'), t('debtsSheet.operationError'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const closeAddPanel = () => {
    if (savingRef.current) return;
    setShowAddPanel(false);
    setAddSearch('');
    setSelectedClient(null);
    setAddAmount('');
  };

  const handleSaveEdit = async (debtId: string) => {
    const amount = parseMoneyInput(editAmount);
    if (!amount || amount <= 0 || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onEditDebt(debtId, amount);
      setEditingDebt(null);
      setEditAmount('');
    } catch {
      Alert.alert(t('error'), t('debtsSheet.operationError'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const grandTotal = debts.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  // Cuenta identidades estables, no coincidencias de datos de contacto.
  const uniqueClients = clientGroups.length;
  const unlinkedDebtCount = clientGroups.reduce(
    (count, group) => count + (group.isUnlinked ? group.debts.length : 0),
    0,
  );

  const handleMarkPaid = (debt: Debt) => {
    if (savingRef.current) return;
    Alert.alert(
      t('debtModal.confirmPayment'),
      t('debtModal.paidConfirm', { name: debt.clientName, amount: formatMoney(debt.amount) }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('debtModal.paid'),
          onPress: async () => {
            if (savingRef.current) return;
            savingRef.current = true;
            setSaving(true);
            try {
              await onMarkPaid(debt);
            } catch {
              Alert.alert(t('error'), t('debtsSheet.operationError'));
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleMarkAllPaid = (group: ClientDebtGroup) => {
    if (savingRef.current) return;
    Alert.alert(
      t('debtsSheet.allPaidTitle'),
      t('debtsSheet.allPaidMsg', { name: group.clientName, count: group.debts.length, total: formatMoney(group.total) }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('debtsSheet.allPaid'),
          onPress: async () => {
            if (savingRef.current) return;
            savingRef.current = true;
            setSaving(true);
            try {
              await onMarkAllPaid(group.clientId, group.debts.map((d) => d.id));
            } catch {
              Alert.alert(t('error'), t('debtsSheet.operationError'));
            } finally {
              savingRef.current = false;
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
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorWhatsApp'));
    });
  };

  const sendReminder = (group: ClientDebtGroup) => {
    if (!group.clientPhone) return;
    const cleanPhone = normalizePhone(group.clientPhone);
    const defaultMsg = 'Hola, buenas \nEste es un mensaje automatico para informarle que, segun nuestros registros, quedo pendiente un saldo por regularizar.\nCuando pueda, le agradecemos que nos indique en que fecha podriamos saldarlo. Si necesita nuevamente los datos de la cuenta, con gusto se los enviamos.\nMuchas gracias.';
    const msg = encodeURIComponent(reminderTemplate || defaultMsg);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${msg}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorWhatsApp'));
    });
  };

  const getBorderColor = (maxAge: number) => {
    if (maxAge > 30) return colors.danger;
    if (maxAge > 15) return colors.warningAmber;
    return colors.dangerBright;
  };

  const renderGroup = ({ item }: { item: ClientDebtGroup }) => (
    <View style={[styles.card, { borderLeftColor: getBorderColor(item.maxAgeDays) }]}>
      <View style={styles.cardHeader}>
        <View style={styles.clientInfo}>
          <Text style={styles.clientName}>
            {(item.clientName || '').toUpperCase()}
          </Text>
          {item.clientAddress ? (
            <Text style={styles.clientAddress}>{item.clientAddress}</Text>
          ) : null}
          {item.isUnlinked ? (
            <Text style={styles.unlinkedLabel}>{t('debtsSheet.unlinkedLabel')}</Text>
          ) : null}
        </View>
        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>{t('debtsSheet.owes')}</Text>
          <Text style={styles.totalAmount}>
            {formatMoney(item.total)}
          </Text>
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
                    <Text style={styles.debtDate}>{formatShortDate(debt.createdAt)}</Text>
                    {showBadge && (
                      <View style={[styles.ageBadge, { backgroundColor: badgeBg }]}>
                        <Text style={[styles.ageBadgeText, { color: badgeText }]}>
                          {ageDays}d
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.debtAmount}>
                    {formatMoney(debt.amount)}
                  </Text>
                </View>
                <View style={styles.debtActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingDebt(debt.id);
                      setEditAmount(String(debt.amount || ''));
                    }}
                    style={styles.editBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('debtsSheet.editDebt')}
                  >
                    <Ionicons name="pencil" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  {item.debts.length > 1 ? (
                    <TouchableOpacity
                      onPress={() => handleMarkPaid(debt)}
                      style={[styles.paidBtn, saving && { opacity: 0.5 }]}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel={t('debtsSheet.registerPayment')}
                    >
                      <Ionicons name="checkmark-circle-outline" size={16} color={colors.successText} />
                      <Text style={styles.paidBtnText}>{t('debtsSheet.registerShort')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            )}
          </View>
        );
      })}

      {(item.clientPhone || (onTransferPayment && !item.isUnlinked)) ? (
        <View style={styles.secondaryActions}>
          {item.clientPhone ? (
            <TouchableOpacity
              onPress={() => openWhatsAppChat(item)}
              style={styles.secondaryActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('debtsSheet.openChat')}
            >
              <Ionicons name="chatbubble-outline" size={17} color={colors.textSecondary} />
              <Text style={styles.secondaryActionText}>{t('debtsSheet.chat')}</Text>
            </TouchableOpacity>
          ) : null}
          {item.clientPhone ? (
            <TouchableOpacity
              onPress={() => sendReminder(item)}
              style={styles.secondaryActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('debtModal.sendReminder')}
            >
              <Ionicons name="notifications-outline" size={17} color={colors.textSecondary} />
              <Text style={styles.secondaryActionText}>{t('debtsSheet.remind')}</Text>
            </TouchableOpacity>
          ) : null}
          {onTransferPayment && !item.isUnlinked ? (
            <TouchableOpacity
              onPress={() => onTransferPayment(item.clientId)}
              style={styles.secondaryActionBtn}
              accessibilityRole="button"
              accessibilityLabel={t('clientCard.transfer')}
            >
              <MaterialCommunityIcons name="bank-outline" size={17} color={colors.textSecondary} />
              <Text style={styles.secondaryActionText}>{t('debtsSheet.transfer')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {item.debts.length > 1 ? (
        <TouchableOpacity
          onPress={() => handleMarkAllPaid(item)}
          style={[styles.primaryPaymentBtn, saving && { opacity: 0.5 }]}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={t('debtsSheet.payAll', { count: item.debts.length })}
        >
          <Ionicons name="checkmark-circle" size={18} color={colors.textWhite} />
          <Text style={styles.primaryPaymentText}>{t('debtsSheet.payAll', { count: item.debts.length })}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={() => handleMarkPaid(item.debts[0])}
          style={[styles.primaryPaymentBtn, saving && { opacity: 0.5 }]}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={t('debtsSheet.registerPayment')}
        >
          <Ionicons name="checkmark-circle" size={18} color={colors.textWhite} />
          <Text style={styles.primaryPaymentText}>{t('debtsSheet.registerPayment')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const requestClose = () => {
    if (savingRef.current) return;
    setSearchTerm('');
    setEditingDebt(null);
    setEditAmount('');
    closeAddPanel();
    onClose();
  };

  return (
    <ModalOverlay visible={visible} onClose={requestClose} animationType="slide">
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
              <TouchableOpacity onPress={requestClose} style={styles.closeBtn} disabled={saving}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Resumen general */}
          {debts.length > 0 && (
            <View style={styles.summaryRow}>
              <View style={[styles.summaryBox, styles.summaryBoxDanger]}>
                <Text style={styles.summaryValueDanger}>{formatMoney(grandTotal)}</Text>
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

          {unlinkedDebtCount > 0 ? (
            <View style={styles.unlinkedBanner} accessibilityRole="alert">
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.warningAmber} />
              <Text style={styles.unlinkedBannerText}>
                {t('debtsSheet.unlinkedCount', { count: unlinkedDebtCount })}
              </Text>
            </View>
          ) : null}

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
            keyExtractor={(item) => item.stableClientId}
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
                      {indebtedStableIds.has(getStableClientId(client)) && (
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
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '85%',
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  addDebtBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    backgroundColor: colors.danger,
    paddingHorizontal: s(12),
    paddingVertical: s(7),
    borderRadius: s(10),
  },
  addDebtBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(14),
  },
  addPanelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
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
  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: s(8),
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    paddingVertical: s(8),
    alignItems: 'center',
  },
  summaryBoxDanger: {
    backgroundColor: colors.dangerLight,
  },
  summaryValueDanger: {
    fontSize: s(18),
    fontWeight: '900',
    color: colors.danger,
  },
  summaryLabelDanger: {
    fontSize: s(10),
    color: colors.danger,
    opacity: 0.7,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: s(18),
    fontWeight: '900',
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: s(10),
    color: colors.textHint,
    fontWeight: '600',
  },
  unlinkedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginHorizontal: s(12),
    marginTop: s(8),
    paddingHorizontal: s(10),
    paddingVertical: s(9),
    borderRadius: s(10),
    backgroundColor: colors.warningAmberBg,
    borderWidth: 1,
    borderColor: colors.warningAmber,
  },
  unlinkedBannerText: {
    flex: 1,
    fontSize: s(12),
    lineHeight: s(16),
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // Search
  searchSection: {
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    paddingHorizontal: s(10),
    height: s(38),
  },
  searchIcon: {
    fontSize: s(16),
    marginRight: s(6),
  },
  searchInput: {
    flex: 1,
    fontSize: s(16),
    color: colors.textPrimary,
    padding: 0,
  },
  clearBtn: {
    padding: s(10),
  },
  clearBtnText: {
    fontSize: s(16),
    color: colors.textHint,
  },
  searchResultCount: {
    fontSize: s(13),
    color: colors.textHint,
    marginTop: s(4),
  },
  // Sort
  sortRow: {
    flexDirection: 'row',
    gap: s(8),
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  sortBtn: {
    flex: 1,
    paddingVertical: s(7),
    borderRadius: s(8),
    backgroundColor: colors.sectionBackground,
    alignItems: 'center',
  },
  sortBtnActive: {
    backgroundColor: colors.danger,
  },
  sortBtnText: {
    fontSize: s(13),
    fontWeight: '700',
    color: colors.textHint,
  },
  sortBtnTextActive: {
    color: colors.textWhite,
  },
  // List
  list: { padding: s(12) },
  card: {
    backgroundColor: colors.card,
    borderRadius: s(14),
    padding: s(14),
    marginBottom: s(10),
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: s(12),
    paddingBottom: s(12),
  },
  clientInfo: {
    flex: 1,
    minWidth: 0,
  },
  clientName: {
    fontSize: s(16),
    fontWeight: '800',
    color: colors.textPrimary,
  },
  clientAddress: {
    fontSize: s(13),
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: s(1),
  },
  unlinkedLabel: {
    alignSelf: 'flex-start',
    marginTop: s(5),
    paddingHorizontal: s(7),
    paddingVertical: s(3),
    borderRadius: s(8),
    overflow: 'hidden',
    backgroundColor: colors.warningAmberBg,
    color: colors.warningAmber,
    fontSize: s(11),
    fontWeight: '700',
  },
  totalBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  totalLabel: {
    fontSize: s(11),
    fontWeight: '700',
    color: colors.textHint,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  totalAmount: {
    fontSize: s(20),
    fontWeight: '900',
    color: colors.danger,
    marginTop: s(1),
  },
  // Debt rows
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(10),
  },
  debtRowFirst: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  debtRowDashed: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.cardBorder,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  debtAmount: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.danger,
  },
  debtDate: {
    fontSize: s(13),
    color: colors.textHint,
  },
  ageBadge: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: s(10),
  },
  ageBadgeText: {
    fontSize: s(10),
    fontWeight: '800',
  },
  debtActions: {
    flexDirection: 'row',
    gap: s(8),
    alignItems: 'center',
  },
  editBtn: {
    width: s(38),
    height: s(38),
    borderRadius: s(10),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    flex: 1,
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
  paidBtn: {
    minHeight: s(38),
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    backgroundColor: colors.successLighter,
    paddingHorizontal: s(10),
    borderRadius: s(10),
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  paidBtnText: {
    color: colors.successText,
    fontWeight: '700',
    fontSize: s(13),
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: s(6),
    paddingTop: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.cardBorder,
  },
  secondaryActionBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: s(44),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(5),
    paddingHorizontal: s(6),
    borderRadius: s(10),
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  secondaryActionText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: s(12),
    flexShrink: 1,
  },
  primaryPaymentBtn: {
    backgroundColor: colors.success,
    minHeight: s(46),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(7),
    paddingHorizontal: s(12),
    borderRadius: s(11),
    marginTop: s(8),
  },
  primaryPaymentText: {
    color: colors.textWhite,
    fontWeight: '800',
    fontSize: s(15),
  },
  // Empty
  empty: {
    alignItems: 'center',
    paddingVertical: s(40),
  },
  emptyEmoji: { fontSize: s(40), marginBottom: s(8) },
  emptyText: {
    fontSize: s(16),
    color: colors.textHint,
  },
  // Add debt panel
  addPanelList: {
    paddingHorizontal: s(12),
    paddingBottom: s(20),
  },
  addPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(4),
    gap: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  avatar: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  addPanelName: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  addPanelAddress: {
    fontSize: s(13),
    color: colors.textSecondary,
    marginTop: s(1),
  },
  debtBadge: {
    fontSize: s(13),
    fontWeight: '700',
    color: colors.danger,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
  },
  // Selected client amount input
  addAmountSection: {
    padding: s(16),
    gap: s(16),
  },
  selectedClientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  addAmountRow: {
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
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  confirmAddBtn: {
    backgroundColor: colors.danger,
    paddingHorizontal: s(20),
    paddingVertical: s(12),
    borderRadius: s(10),
  },
  confirmAddBtnDisabled: {
    opacity: 0.5,
  },
  confirmAddBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  });
};

export default DebtsSheet;
