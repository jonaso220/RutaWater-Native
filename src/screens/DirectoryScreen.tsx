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
} from 'react-native';
import { Client } from '../types';
import { normalizePhone } from '../utils/helpers';
import { PRODUCTS } from '../constants/products';
import { useAuthContext } from '../context/AuthContext';
import { useClientsContext } from '../context/ClientsContext';
import { useDebtsContext } from '../context/DebtsContext';
import ScheduleModal from '../components/ScheduleModal';
import DebtModal from '../components/DebtModal';
import EditClientModal from '../components/EditClientModal';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

const DirectoryScreen = () => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const { isAdmin } = useAuthContext();
  const { getFilteredDirectory, directoryCounts, scheduleFromDirectory, updateClient, clients } = useClientsContext();
  const { debts, addDebt, markDebtPaid, editDebt, getClientDebtTotal } = useDebtsContext();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [scheduleClient, setScheduleClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);

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

  // Apply with_debt filter at screen level (needs debts context)
  const filteredClients = useMemo(() => {
    const base = getFilteredDirectory(search, activeFilter === 'with_debt' ? 'all' : activeFilter);
    if (activeFilter !== 'with_debt') return base;
    return base.filter((c) => debts.some((d) => d.clientId === c.id && d.amount > 0));
  }, [search, activeFilter, getFilteredDirectory, debts]);

  const FILTERS = [
    { key: 'all', label: 'Todos' },
    { key: 'weekly', label: 'Sem' },
    { key: 'biweekly', label: 'Quin' },
    { key: 'triweekly', label: 'C/3' },
    { key: 'monthly', label: 'Mens' },
    { key: 'once', label: '1 vez' },
    { key: 'on_demand', label: 'Dir' },
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

  const callClient = (client: Client) => {
    if (!client.phone) return;
    Linking.openURL(`tel:${client.phone}`).catch(() => {
      Alert.alert('Error', 'No se pudo realizar la llamada.');
    });
  };

  const AVATAR_COLORS = ['#3B82F6','#22C55E','#A855F7','#F97316','#EC4899','#14B8A6','#6366F1','#EF4444'];

  const getFreqStyle = (freq: string) => {
    switch (freq) {
      case 'weekly': return { bg: '#DBEAFE', text: '#1D4ED8' };
      case 'biweekly': return { bg: '#F3E8FF', text: '#7E22CE' };
      case 'triweekly': return { bg: '#F3E8FF', text: '#7E22CE' };
      case 'monthly': return { bg: '#E0E7FF', text: '#4338CA' };
      case 'once': return { bg: '#FFEDD5', text: '#C2410C' };
      case 'on_demand': return { bg: colors.sectionBackground, text: colors.textMuted };
      default: return { bg: colors.sectionBackground, text: colors.textMuted };
    }
  };

  const renderClient = ({ item }: { item: Client }) => {
    const debtTotal = getClientDebtTotal(item.id);
    const isOnDemand = item.freq === 'on_demand' || !item.visitDays?.length;
    const hasLocation = !!(item.lat && item.lng) || !!item.mapsLink;
    const avatarColor = AVATAR_COLORS[(item.name || '').charCodeAt(0) % AVATAR_COLORS.length];
    const initial = (item.name || '?').charAt(0).toUpperCase();
    const freqStyle = getFreqStyle(item.freq);

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
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre, direccion o telefono..."
          placeholderTextColor={colors.textHint}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
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
            return (
              <TouchableOpacity
                key={f.key}
                style={[
                  styles.filterChip,
                  isActive && styles.filterChipActive,
                  isActive && isWarning && styles.filterChipWarning,
                  isActive && isDanger && styles.filterChipDanger,
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
          showClientInfo
        />
      )}
    </View>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
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
    fontSize: 16,
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
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterChipCount: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textHint,
  },
  filterChipCountActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  countText: {
    textAlign: 'center',
    color: colors.textHint,
    fontSize: 14,
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
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
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
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  clientPhone: {
    fontSize: 11,
    color: colors.textHint,
    flexShrink: 0,
  },
  clientAddress: {
    fontSize: 12,
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
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  daysBadge: {
    fontSize: 10,
    color: colors.textHint,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  debtBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.danger,
    backgroundColor: colors.dangerLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
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
    fontSize: 11,
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
    fontSize: 18,
  },
  scheduleButton: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scheduleButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    fontSize: 17,
    color: colors.textHint,
  },
});

export default DirectoryScreen;
