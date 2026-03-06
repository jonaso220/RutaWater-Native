import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Client } from '../types';
import { normalizePhone, parseContactString, isSafeUrl } from '../utils/helpers';
import { getWeekNumber } from '../utils/helpers';
import { db } from '../config/firebase';
import { PRODUCTS } from '../constants/products';
import { useAuthContext } from '../context/AuthContext';
import { useClientsContext } from '../context/ClientsContext';
import { useDebtsContext } from '../context/DebtsContext';
import ScheduleModal from '../components/ScheduleModal';
import DebtModal from '../components/DebtModal';
import EditClientModal from '../components/EditClientModal';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

const DirectoryScreen = () => {
  const { colors, isDark } = useTheme();
  const { fontScale } = useLayout();
  const styles = getStyles(colors, fontScale);
  const { isAdmin, user, groupData } = useAuthContext();
  const { getFilteredDirectory, directoryCounts, scheduleFromDirectory, updateClient, deleteClient, clients, cloneClient } = useClientsContext();
  const { debts, addDebt, markDebtPaid, editDebt, getClientDebtTotal } = useDebtsContext();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [scheduleClient, setScheduleClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Compute with_debt count (needs both clients and debts)
  const withDebtCount = useMemo(() => {
    return clients.filter((c) => {
      if (c.isNote) return false;
      return debts.some((d) => d.clientId === c.id && d.amount > 0);
    }).length;
  }, [clients, debts]);

  const counts: Record<string, number> = useMemo(() => ({
    ...directoryCounts,
    with_debt: withDebtCount,
  }), [directoryCounts, withDebtCount]);

  // Helper: get last activity date from a client (returns Date or null)
  const getLastActivityDate = (client: Client): Date | null => {
    const toDate = (val: any): Date | null => {
      if (!val) return null;
      if (typeof val.toDate === 'function') return val.toDate();
      if (val instanceof Date) return val;
      return null;
    };
    return toDate(client.completedAt) || toDate(client.lastVisited) || toDate(client.updatedAt);
  };

  // Helper: calculate days since a date (returns number or null if no date)
  const getDaysSince = (date: Date | null): number | null => {
    if (!date) return null;
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Helper: get recency badge info (label, colors)
  const getRecencyBadge = (client: Client): { label: string; bgColor: string; textColor: string } => {
    const lastDate = getLastActivityDate(client);
    const days = getDaysSince(lastDate);

    if (days === null) {
      return {
        label: 'Sin historial',
        bgColor: isDark ? '#374151' : '#E5E7EB',
        textColor: colors.textMuted,
      };
    }

    if (days <= 7) {
      return {
        label: days === 0 ? 'Hoy' : days === 1 ? 'Hace 1 dia' : `Hace ${days} dias`,
        bgColor: isDark ? '#064E3B' : '#ECFDF5',
        textColor: isDark ? '#6EE7B7' : '#059669',
      };
    }

    if (days <= 21) {
      return {
        label: `Hace ${days} dias`,
        bgColor: isDark ? '#451A03' : '#FFFBEB',
        textColor: isDark ? '#F59E0B' : '#D97706',
      };
    }

    if (days <= 45) {
      return {
        label: `Hace ${days} dias`,
        bgColor: isDark ? '#431407' : '#FFF7ED',
        textColor: isDark ? '#FB923C' : '#EA580C',
      };
    }

    return {
      label: `Hace ${days} dias`,
      bgColor: isDark ? '#450A0A' : '#FEF2F2',
      textColor: isDark ? '#F87171' : '#DC2626',
    };
  };

  // Apply with_debt and recurrencia filters at screen level
  const filteredClients = useMemo(() => {
    const isSpecialFilter = activeFilter === 'with_debt' || activeFilter === 'recurrencia';
    const base = getFilteredDirectory(search, isSpecialFilter ? 'all' : activeFilter);

    if (activeFilter === 'with_debt') {
      return base.filter((c) => debts.some((d) => d.clientId === c.id && d.amount > 0));
    }

    if (activeFilter === 'recurrencia') {
      return base
        .filter((c) => c.freq === 'once' || c.freq === 'on_demand')
        .sort((a, b) => {
          const dateA = getLastActivityDate(a);
          const dateB = getLastActivityDate(b);
          // No date = most stale, appears first
          if (!dateA && !dateB) return (a.name || '').localeCompare(b.name || '');
          if (!dateA) return -1;
          if (!dateB) return 1;
          // Oldest first (most stale at top)
          return dateA.getTime() - dateB.getTime();
        });
    }

    return base;
  }, [search, activeFilter, getFilteredDirectory, debts, clients]);

  const isRecurrenciaMode = activeFilter === 'recurrencia';

  const FILTERS = [
    { key: 'all', label: 'Todos' },
    { key: 'weekly', label: 'Sem' },
    { key: 'biweekly', label: 'Quin' },
    { key: 'triweekly', label: 'C/3' },
    { key: 'monthly', label: 'Mens' },
    { key: 'sin_frecuencia', label: 'Pedidos' },
    { key: 'recurrencia', label: 'Recurrencia' },
    { key: 'no_location', label: 'Sin ubic.' },
    { key: 'with_debt', label: 'Deuda' },
  ];

  const sendWhatsApp = (client: Client) => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`).catch(() => {
      Alert.alert('Error', 'No se pudo abrir WhatsApp.');
    });
  };

  const openMaps = (client: Client) => {
    if (client.lat && client.lng) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`,
      ).catch(() => {
        Alert.alert('Error', 'No se pudo abrir Google Maps.');
      });
    } else if (client.mapsLink) {
      Linking.openURL(client.mapsLink).catch(() => {
        Alert.alert('Error', 'No se pudo abrir el enlace de mapa.');
      });
    }
  };

  const getProductSummary = (client: Client): string => {
    if (!client.products) return '';
    return Object.keys(client.products)
      .filter((k) => parseInt(String(client.products[k] || 0), 10) > 0)
      .map((k) => {
        const p = PRODUCTS.find((prod) => prod.id === k);
        return `${client.products[k]}x ${p ? p.short : k}`;
      })
      .join(', ');
  };

  const getFreqLabel = (freq: string): string => {
    switch (freq) {
      case 'weekly': return 'Semanal';
      case 'biweekly': return 'Quincenal';
      case 'triweekly': return 'Cada 3 sem';
      case 'monthly': return 'Mensual';
      case 'once': return 'Una vez';
      case 'on_demand': return 'Solo Directorio';
      default: return freq || '';
    }
  };

  // Magic Paste: parse text and import to directory
  const handleMagicPaste = async () => {
    if (!pasteText.trim()) return;
    const parsed = parseContactString(pasteText);
    if (!parsed.name && !parsed.link) {
      Alert.alert('Error', 'No se pudo detectar el formato.');
      return;
    }
    try {
      const currentWeek = getWeekNumber(new Date());
      const scope = groupData?.groupId ? { groupId: groupData.groupId, userId: user?.uid } : { userId: user?.uid };
      const cleanProducts: Record<string, number> = {};
      Object.entries(parsed.products).filter(([, v]) => v !== '').forEach(([k, v]) => {
        cleanProducts[k] = parseInt(v) || 0;
      });
      const safeMapsLink = (parsed.link && isSafeUrl(parsed.link)) ? parsed.link : '';
      await db.collection('clients').add({
        ...scope,
        userId: user?.uid,
        name: parsed.name || '',
        phone: parsed.phone || '',
        address: parsed.address || '',
        lat: parsed.lat || '',
        lng: parsed.lng || '',
        mapsLink: safeMapsLink,
        notes: parsed.notes || '',
        freq: 'on_demand',
        visitDay: 'Sin Asignar',
        visitDays: [],
        specificDate: '',
        products: cleanProducts,
        listOrder: 0,
        listOrders: {},
        isCompleted: false,
        isStarred: false,
        isPinned: false,
        isNote: false,
        alarm: '',
        startWeek: currentWeek,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setShowPasteModal(false);
      setPasteText('');
      Alert.alert('✅', `"${parsed.name}" importado al Directorio.`);
    } catch (e) {
      Alert.alert('Error', 'No se pudo importar el cliente.');
    }
  };

  const handleClone = (client: Client) => {
    Alert.alert(
      'Clonar Cliente',
      `¿Duplicar "${client.name}" al directorio?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Clonar',
          onPress: async () => {
            await cloneClient(client);
            Alert.alert('✅', `"${client.name}" clonado al directorio.`);
          },
        },
      ],
    );
  };

  const callClient = (client: Client) => {
    if (!client.phone) return;
    Linking.openURL(`tel:${client.phone}`).catch(() => {
      Alert.alert('Error', 'No se pudo realizar la llamada.');
    });
  };

  const AVATAR_COLORS = ['#3B82F6','#22C55E','#A855F7','#F97316','#EC4899','#14B8A6','#6366F1','#EF4444'];

  const getFreqStyle = (freq: string, themeColors: ThemeColors) => {
    switch (freq) {
      case 'weekly': return { bg: themeColors.primaryLight, text: themeColors.primaryDark };
      case 'biweekly': return { bg: themeColors.successLighter, text: themeColors.successDark };
      case 'triweekly': return { bg: themeColors.warningAmberBg, text: themeColors.warningDarker };
      case 'monthly': return { bg: themeColors.dangerLight, text: themeColors.danger };
      case 'once': return { bg: themeColors.warningLightBg, text: themeColors.warningOrangeText };
      case 'on_demand': return { bg: themeColors.sectionBackground, text: themeColors.textMuted };
      default: return { bg: themeColors.sectionBackground, text: themeColors.textMuted };
    }
  };

  const renderClient = ({ item }: { item: Client }) => {
    const debtTotal = getClientDebtTotal(item.id);
    const isOnDemand = item.freq === 'on_demand' || !item.visitDays?.length;
    const hasLocation = !!(item.lat && item.lng) || !!item.mapsLink;
    const avatarColor = AVATAR_COLORS[(item.name || '').charCodeAt(0) % AVATAR_COLORS.length];
    const initial = (item.name || '?').charAt(0).toUpperCase();
    const freqStyle = getFreqStyle(item.freq, colors);
    const recencyBadge = isRecurrenciaMode ? getRecencyBadge(item) : null;

    // Build product chips
    const prodChips = item.products
      ? Object.keys(item.products)
          .filter((k) => parseInt(String(item.products[k] || 0), 10) > 0)
          .map((k) => {
            const p = PRODUCTS.find((prod) => prod.id === k);
            return { qty: item.products[k], icon: p ? p.icon : '📦', label: p ? p.short : k };
          })
      : [];

    return (
      <View style={[styles.card, debtTotal > 0 && styles.cardDebt]}>
        <View style={styles.cardContent}>
          {/* HEADER: Avatar + Name + Phone */}
          <View style={styles.headerRow}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={styles.headerInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.clientName} numberOfLines={1}>
                  {(item.name || '').toUpperCase()}
                </Text>
                {item.phone ? (
                  <Text style={styles.clientPhone}>{item.phone}</Text>
                ) : null}
              </View>
              {item.address ? (
                <Text style={styles.clientAddress} numberOfLines={1}>📍 {item.address}</Text>
              ) : null}
            </View>
          </View>

          {/* RECENCY BADGE (only in Recurrencia mode) */}
          {recencyBadge && (
            <View style={styles.recencyRow}>
              <Text style={[
                styles.recencyBadge,
                { backgroundColor: recencyBadge.bgColor, color: recencyBadge.textColor },
              ]}>
                {recencyBadge.label}
              </Text>
            </View>
          )}

          {/* BADGES: Freq + Days + Debt */}
          <View style={styles.badgesRow}>
            <Text style={[styles.freqBadge, { backgroundColor: freqStyle.bg, color: freqStyle.text }]}>
              {getFreqLabel(item.freq)}
            </Text>
            {item.visitDays && item.visitDays.length > 0 && (
              <Text style={styles.daysBadge}>
                {item.visitDays.map((d) => d.slice(0, 3)).join(', ')}
              </Text>
            )}
            {debtTotal > 0 && (
              <TouchableOpacity onPress={() => setDebtClient(item)}>
                <Text style={styles.debtBadge}>💰 ${debtTotal.toLocaleString()}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* PRODUCT CHIPS */}
          {prodChips.length > 0 && (
            <View style={styles.prodChipsRow}>
              {prodChips.map((p, i) => (
                <Text key={i} style={styles.prodChip}>
                  {p.icon} {p.qty}x {p.label}
                </Text>
              ))}
            </View>
          )}

          {/* ACTION BUTTONS */}
          <View style={styles.actionsRow}>
            {item.phone ? (
              <TouchableOpacity onPress={() => callClient(item)} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>📞</Text>
              </TouchableOpacity>
            ) : null}
            {item.phone ? (
              <TouchableOpacity onPress={() => sendWhatsApp(item)} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>💬</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => hasLocation ? openMaps(item) : undefined}
              style={[styles.actionBtn, !hasLocation && { opacity: 0.3 }]}
              activeOpacity={hasLocation ? 0.6 : 1}
            >
              <Text style={styles.actionBtnText}>📍</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDebtClient(item)} style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>{debtTotal > 0 ? '🔴' : '💰'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleClone(item)} style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>📋</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity onPress={() => setEditClient(item)} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>✏️</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.scheduleButton}
              onPress={() => setScheduleClient(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.scheduleButtonText}>
                {isOnDemand ? 'Agendar' : '+ Visita'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
      {/* Search bar + Import */}
      <View style={styles.searchContainer}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              style={[styles.searchInput, { flex: 1, paddingRight: search ? 36 : 12 }]}
              placeholder="Buscar por nombre, direccion o telefono..."
              placeholderTextColor={colors.textHint}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearch('')}
                style={{ position: 'absolute', right: 8, padding: 4 }}
              >
                <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => setShowPasteModal(true)}
          >
            <Text style={styles.importBtnText}>📋+</Text>
          </TouchableOpacity>
        </View>
        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}
        >
          {FILTERS.filter((f) => f.key === 'all' || (counts[f.key] || 0) > 0).map((f) => {
            const isActive = activeFilter === f.key;
            const isWarning = f.key === 'no_location';
            const isDanger = f.key === 'with_debt';
            const isRecurrencia = f.key === 'recurrencia';
            return (
              <TouchableOpacity
                key={f.key}
                style={[
                  styles.filterChip,
                  isActive && styles.filterChipActive,
                  isActive && isWarning && styles.filterChipWarning,
                  isActive && isDanger && styles.filterChipDanger,
                  isActive && isRecurrencia && styles.filterChipRecurrencia,
                ]}
                onPress={() => setActiveFilter(activeFilter === f.key ? 'all' : f.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {f.label}
                </Text>
                {(counts[f.key] || 0) > 0 && (
                  <Text
                    style={[
                      styles.filterChipCount,
                      isActive && styles.filterChipCountActive,
                    ]}
                  >
                    {counts[f.key]}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <Text style={styles.countText}>
        {filteredClients.length} cliente{filteredClients.length !== 1 ? 's' : ''}
        {activeFilter !== 'all' ? ` de ${counts.total}` : ' en el directorio'}
      </Text>

      {/* Client list */}
      <FlatList
        data={filteredClients}
        renderItem={renderClient}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No se encontraron clientes</Text>
          </View>
        }
      />
      </View>

      {/* Schedule Modal */}
      <ScheduleModal
        visible={!!scheduleClient}
        client={scheduleClient}
        onSave={scheduleFromDirectory}
        onClose={() => setScheduleClient(null)}
      />

      {/* Debt Modal */}
      <DebtModal
        visible={!!debtClient}
        client={debtClient}
        debts={debts}
        onClose={() => setDebtClient(null)}
        onAddDebt={addDebt}
        onMarkPaid={markDebtPaid}
        onEditDebt={editDebt}
      />

      {/* Edit Client Modal (admin only) */}
      {isAdmin && (
        <EditClientModal
          visible={!!editClient}
          client={editClient}
          onSave={updateClient}
          onClose={() => setEditClient(null)}
          onDelete={deleteClient}
          showClientInfo
        />
      )}

      {/* Magic Paste Import Modal */}
      <Modal visible={showPasteModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.pasteOverlay}
        >
          <View style={styles.pasteDialog}>
            <Text style={styles.pasteTitle}>📋 Importar Cliente</Text>
            <Text style={styles.pasteSubtitle}>
              Pegá el texto del cliente (nombre, dirección, teléfono, productos, link de Maps...)
            </Text>
            <TextInput
              style={styles.pasteInput}
              placeholder="Pegar texto aquí..."
              placeholderTextColor={colors.textHint}
              value={pasteText}
              onChangeText={setPasteText}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.pasteButtons}>
              <TouchableOpacity
                style={styles.pasteCancelBtn}
                onPress={() => { setShowPasteModal(false); setPasteText(''); }}
              >
                <Text style={styles.pasteCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pasteImportBtn, !pasteText.trim() && { opacity: 0.4 }]}
                onPress={handleMagicPaste}
                disabled={!pasteText.trim()}
              >
                <Text style={styles.pasteImportText}>Importar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchContainer: {
    padding: 12,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  searchInput: {
    backgroundColor: colors.sectionBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: s(16),
    color: colors.textPrimary,
  },
  filterBar: {
    marginTop: 10,
    flexGrow: 0,
  },
  filterBarContent: {
    gap: 6,
    paddingHorizontal: 2,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: colors.sectionBackground,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipWarning: {
    backgroundColor: '#EAB308',
  },
  filterChipDanger: {
    backgroundColor: colors.danger,
  },
  filterChipRecurrencia: {
    backgroundColor: colors.warning,
  },
  filterChipText: {
    fontSize: s(13),
    fontWeight: '700',
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: colors.textWhite,
  },
  filterChipCount: {
    fontSize: s(11),
    fontWeight: '600',
    color: colors.textHint,
  },
  filterChipCountActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  countText: {
    textAlign: 'center',
    color: colors.textHint,
    fontSize: s(14),
    fontWeight: '500',
    marginTop: 8,
  },
  listContent: {
    padding: 12,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  cardDebt: {
    borderLeftColor: colors.danger,
  },
  cardContent: {
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  clientName: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  clientPhone: {
    fontSize: s(11),
    color: colors.textHint,
    flexShrink: 0,
  },
  clientAddress: {
    fontSize: s(12),
    color: colors.textMuted,
    marginTop: 2,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  freqBadge: {
    fontSize: s(10),
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  daysBadge: {
    fontSize: s(10),
    color: colors.textHint,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  debtBadge: {
    fontSize: s(10),
    fontWeight: '700',
    color: colors.danger,
    backgroundColor: colors.dangerLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  recencyRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  recencyBadge: {
    fontSize: s(11),
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  prodChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  prodChip: {
    fontSize: s(11),
    fontWeight: '500',
    color: colors.textSecondary,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.sectionBackground,
  },
  actionBtn: {
    padding: 6,
    borderRadius: 6,
  },
  actionBtnText: {
    fontSize: s(18),
  },
  scheduleButton: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scheduleButtonText: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.primaryDark,
  },
  importBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: 'center',
  },
  importBtnText: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textWhite,
  },
  pasteOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  pasteDialog: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    maxWidth: 500,
    alignSelf: 'center' as const,
    width: '100%' as const,
  },
  pasteTitle: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  pasteSubtitle: {
    fontSize: s(13),
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 14,
  },
  pasteInput: {
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: s(14),
    color: colors.textPrimary,
    minHeight: 150,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pasteButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  pasteCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.sectionBackground,
    alignItems: 'center',
  },
  pasteCancelText: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.textMuted,
  },
  pasteImportBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  pasteImportText: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.textWhite,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    fontSize: s(17),
    color: colors.textHint,
  },
});
};

export default DirectoryScreen;
