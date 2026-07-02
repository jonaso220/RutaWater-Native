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
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { Client, Debt } from '../types';
import { normalizePhone, fuzzyMatch, matchScore, getClientMatchKey, getModalWidth, parseMoneyInput } from '../utils/helpers';
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
  // Clave única del grupo (matchKey): el clientId puede repetirse entre grupos
  // cuando una deuda huérfana se "promueve" al mismo cliente activo.
  matchKey: string;
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
  const [editingDebt, setEditingDebt] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  const now = Date.now();

  const getAgeDays = (timestamp: any): number => {
    if (!timestamp) return 0;
    const ts = timestamp.seconds ? timestamp.seconds * 1000 : timestamp;
    return Math.floor((now - ts) / 86400000);
  };

  // Agrupa deudas por "cliente humano" (nombre+teléfono normalizados),
  // no por clientId. Así si un cliente del directorio fue agregado varias veces
  // a la ruta (p.ej. semanal + una vez para otra ubicación), las deudas de
  // ambas instancias se muestran en una sola tarjeta.
  // Si la deuda apunta a un clientId huérfano (cliente eliminado o re-agendado
  // con otro ID), busca cualquier instancia activa con el mismo nombre para
  // recuperar teléfono/dirección y un clientId válido.
  const clientsByName: Record<string, Client[]> = useMemo(() => {
    const map: Record<string, Client[]> = {};
    clients.forEach((c) => {
      if (!c || c.isNote) return;
      const normName = (c.name || '').toLowerCase().trim();
      if (!normName) return;
      if (!map[normName]) map[normName] = [];
      map[normName].push(c);
    });
    return map;
  }, [clients]);

  const clientGroups: ClientDebtGroup[] = useMemo(() => {
    const grouped: Record<string, ClientDebtGroup> = {};

    debts.forEach((debt) => {
      let client = clients.find((c) => c.id === debt.clientId);
      // Fallback: si el clientId está huérfano, intenta resolver por nombre.
      if (!client && debt.clientName) {
        const candidates = clientsByName[debt.clientName.toLowerCase().trim()] || [];
        // Preferir una instancia con teléfono (mejor matching para getMatchingIds)
        client = candidates.find((c) => c.phone) || candidates[0];
      }
      const name = debt.clientName || client?.name || '';
      const phone = client?.phone || '';
      const key = getClientMatchKey(name, phone, debt.clientId);

      if (!grouped[key]) {
        grouped[key] = {
          matchKey: key,
          // Usar el id del cliente activo cuando exista, así operaciones como
          // markAllDebtsPaid pueden actualizar hasDebt en el cliente correcto.
          clientId: client?.id || debt.clientId,
          clientName: name,
          clientPhone: phone,
          clientAddress: client?.address || '',
          total: 0,
          debts: [],
          maxAgeDays: 0,
        };
      } else {
        // Completa con datos del cliente más "vivo" si la primera deuda no tenía
        if (!grouped[key].clientPhone && phone) grouped[key].clientPhone = phone;
        if (!grouped[key].clientAddress && client?.address) grouped[key].clientAddress = client.address;
        // Promover el clientId a uno activo si el grupo arrancó con uno huérfano
        if (client && !clients.some((c) => c.id === grouped[key].clientId)) {
          grouped[key].clientId = client.id;
        }
      }
      grouped[key].total += Number(debt.amount) || 0;
      grouped[key].debts.push(debt);
      const age = getAgeDays(debt.createdAt);
      if (age > grouped[key].maxAgeDays) {
        grouped[key].maxAgeDays = age;
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
  }, [debts, clients, sortMode, clientsByName]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return clientGroups;
    const matcher = fuzzyMatch(searchTerm);
    return clientGroups.filter((g) =>
      matcher(g.clientName || '', g.clientAddress || '', g.clientPhone || ''),
    );
  }, [clientGroups, searchTerm]);

  // Clientes con deuda (por matchKey) — el badge "Debe" aparece en cualquier
  // instancia duplicada del mismo cliente humano, no solo en el clientId exacto del debt.
  const debtMatchKeys = useMemo(() => {
    const set = new Set<string>();
    debts.forEach((d) => {
      const c = clients.find((cl) => cl.id === d.clientId);
      const name = d.clientName || c?.name || '';
      const phone = c?.phone || '';
      set.add(getClientMatchKey(name, phone, d.clientId));
    });
    return set;
  }, [debts, clients]);

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
    if (!selectedClient || !onAddDebt || saving) return;
    const amount = parseMoneyInput(addAmount);
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

  const grandTotal = debts.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  // Cuenta clientes únicos por matchKey para no contar el mismo cliente dos veces cuando tiene instancias duplicadas
  const uniqueClients = clientGroups.length;

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
            keyExtractor={(item) => item.matchKey}
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
                      {debtMatchKeys.has(getClientMatchKey(client.name || '', client.phone || '', client.id)) && (
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
    backgroundColor: colors.dangerLight,
    borderRadius: s(12),
    padding: s(14),
    marginBottom: s(8),
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(8),
  },
  clientName: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  clientAddress: {
    fontSize: s(13),
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: s(1),
  },
  totalAmount: {
    fontSize: s(20),
    fontWeight: '800',
    color: colors.danger,
    marginTop: s(2),
  },
  cardActions: {
    flexDirection: 'row',
    gap: s(8),
    alignItems: 'center',
  },
  actionBtn: { padding: s(6) },
  transferBtn: {
    backgroundColor: colors.successLighter,
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: s(8),
    borderWidth: 1,
    borderColor: colors.successLight,
  },
  transferBtnText: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.successDark,
  },
  // Debt rows
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: s(8),
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
    padding: s(8),
    borderRadius: s(8),
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
    backgroundColor: colors.success,
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderRadius: s(8),
  },
  paidBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(15),
  },
  // Pay all button
  payAllBtn: {
    backgroundColor: colors.success,
    paddingVertical: s(10),
    borderRadius: s(8),
    alignItems: 'center',
    marginTop: s(10),
  },
  payAllBtnText: {
    color: colors.textWhite,
    fontWeight: '800',
    fontSize: s(14),
  },
  reminderBtn: {
    paddingVertical: s(10),
    borderRadius: s(8),
    alignItems: 'center',
    marginTop: s(6),
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  reminderBtnText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: s(14),
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
