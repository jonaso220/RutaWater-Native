import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Client } from '../types';
import { normalizePhone, getClientMatchKey } from '../utils/helpers';
import { PRODUCTS } from '../constants/products';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuthContext } from '../context/AuthContext';
import { useClientsStore } from '../stores/clientsStore';
import { useDebtsStore } from '../stores/debtsStore';
import { useNavigation, useFocusEffect, useScrollToTop } from '@react-navigation/native';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import ScheduleModal from '../components/ScheduleModal';
import DebtModal from '../components/DebtModal';
import EditClientModal from '../components/EditClientModal';
import AddClientModal from '../components/AddClientModal';
import RelationshipsModal from '../components/RelationshipsModal';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { FlashList } from '@shopify/flash-list';
import { useLayout } from '../hooks/useLayout';

const DirectoryScreen = () => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { fontScale } = useLayout();
  const styles = getStyles(colors, fontScale);
  const navigation = useNavigation<any>();
  const { isAdmin } = useAuthContext();
  const getFilteredDirectory = useClientsStore((s) => s.getFilteredDirectory);
  const directoryCounts = useClientsStore((s) => s.directoryCounts);
  const scheduleFromDirectory = useClientsStore((s) => s.scheduleFromDirectory);
  const updateClient = useClientsStore((s) => s.updateClient);
  const deleteClient = useClientsStore((s) => s.deleteClient);
  const clients = useClientsStore((s) => s.clients);
  const clientsLoading = useClientsStore((s) => s.loading);
  const cloneClient = useClientsStore((s) => s.cloneClient);
  const addClient = useClientsStore((s) => s.addClient);
  const canAddClient = useClientsStore((s) => s.canAddClient);
  const addRelationship = useClientsStore((s) => s.addRelationship);
  const removeRelationship = useClientsStore((s) => s.removeRelationship);
  const debts = useDebtsStore((s) => s.debts);
  const addDebt = useDebtsStore((s) => s.addDebt);
  const markDebtPaid = useDebtsStore((s) => s.markDebtPaid);
  const markAllDebtsPaid = useDebtsStore((s) => s.markAllDebtsPaid);
  const editDebt = useDebtsStore((s) => s.editDebt);
  const getClientDebtTotal = useDebtsStore((s) => s.getClientDebtTotal);
  const scrollRef = useRef<any>(null);
  useScrollToTop(scrollRef);
  // Two states: searchInput drives the TextInput (immediate), search drives
  // the actual filter (debounced). With 600+ clients fuzzyMatch on every
  // keystroke is noticeable; debouncing keeps the UI responsive.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [scheduleClient, setScheduleClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [relationshipClient, setRelationshipClient] = useState<Client | null>(null);

  useEffect(() => {
    // Empty search applies instantly (clearing should feel snappy).
    if (!searchInput) {
      setSearch('');
      return;
    }
    const id = setTimeout(() => setSearch(searchInput), 180);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Clear search when leaving this tab
  useFocusEffect(
    useCallback(() => {
      return () => {
        setSearchInput('');
        setSearch('');
      };
    }, []),
  );

  // Conjunto de matchKeys de clientes con deuda. Un cliente humano puede tener varias
  // instancias (mismo nombre+teléfono, IDs distintos); si CUALQUIERA tiene deuda, todas
  // sus instancias cuentan y se muestran en el filtro "con deuda".
  const debtMatchKeys = useMemo(() => {
    const set = new Set<string>();
    debts.forEach((d) => {
      if (!(d.amount > 0)) return;
      const c = clients.find((cl) => cl.id === d.clientId);
      const name = d.clientName || c?.name || '';
      const phone = c?.phone || '';
      set.add(getClientMatchKey(name, phone, d.clientId));
    });
    return set;
  }, [clients, debts]);

  const clientHasDebt = useCallback(
    (c: Client) => debtMatchKeys.has(getClientMatchKey(c.name || '', c.phone || '', c.id)),
    [debtMatchKeys],
  );

  // Compute with_debt count (needs both clients and debts)
  const withDebtCount = useMemo(() => {
    return clients.filter((c) => {
      if (c.isNote) return false;
      return clientHasDebt(c);
    }).length;
  }, [clients, clientHasDebt]);

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
        label: t('directory.noHistory'),
        bgColor: isDark ? '#374151' : '#E5E7EB',
        textColor: colors.textMuted,
      };
    }

    if (days <= 7) {
      return {
        label: days === 0 ? t('directory.today') : t('directory.daysAgo', { count: days }),
        bgColor: isDark ? '#064E3B' : '#ECFDF5',
        textColor: isDark ? '#6EE7B7' : '#059669',
      };
    }

    if (days <= 21) {
      return {
        label: t('directory.daysAgo', { count: days }),
        bgColor: isDark ? '#451A03' : '#FFFBEB',
        textColor: isDark ? '#F59E0B' : '#D97706',
      };
    }

    if (days <= 45) {
      return {
        label: t('directory.daysAgo', { count: days }),
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
      return base.filter(clientHasDebt);
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
  }, [search, activeFilter, getFilteredDirectory, debts, clients, clientHasDebt]);

  // Reset scroll to top when the search term or filter changes — otherwise
  // FlashList keeps the previous offset and the user has to scroll up to
  // find the matched client (especially noticeable with hundreds of clients).
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    });
  }, [search, activeFilter]);

  const isRecurrenciaMode = activeFilter === 'recurrencia';

  const FILTERS = [
    { key: 'all', label: t('directory.filterAll') },
    { key: 'weekly', label: t('directory.filterWeekly') },
    { key: 'biweekly', label: t('directory.filterBiweekly') },
    { key: 'triweekly', label: t('directory.filterTriweekly') },
    { key: 'monthly', label: t('directory.filterMonthly') },
    { key: 'sin_frecuencia', label: t('directory.filterOrders') },
    { key: 'recurrencia', label: t('directory.filterRecurrence') },
    { key: 'no_location', label: t('directory.filterNoLocation') },
    { key: 'with_debt', label: t('directory.filterDebt') },
  ];

  const sendWhatsApp = (client: Client) => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorWhatsApp'));
    });
  };

  const openMaps = (client: Client) => {
    if (client.lat && client.lng) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`,
      ).catch(() => {
        Alert.alert(t('error'), t('directory.errorMaps'));
      });
    } else if (client.mapsLink) {
      Linking.openURL(client.mapsLink).catch(() => {
        Alert.alert(t('error'), t('directory.errorMapsLink'));
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
    return t('freq.' + freq, { defaultValue: freq || '' });
  };

  const handleClone = (client: Client) => {
    Alert.alert(
      t('directory.cloneClient'),
      t('directory.cloneConfirm', { name: client.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('directory.clone'),
          onPress: async () => {
            await cloneClient(client);
            Alert.alert(t('done'), t('directory.cloneDone', { name: client.name }));
          },
        },
      ],
    );
  };

  const callClient = (client: Client) => {
    if (!client.phone) return;
    Linking.openURL(`tel:${client.phone}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorCall'));
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
    const hasRelationships = !!(item.relationships && Object.keys(item.relationships).length > 0);
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
            return { qty: item.products[k], emoji: p ? p.emoji : '📦', label: p ? p.short : k };
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
                hasLocation ? (
                  <TouchableOpacity
                    onPress={() => openMaps(item)}
                    activeOpacity={0.6}
                    style={styles.addressLinkBox}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Ionicons name="location-sharp" size={14} color={colors.primary} />
                    <Text style={styles.addressLinkText} numberOfLines={1}>{item.address}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.clientAddress} numberOfLines={1}>
                    <Ionicons name="location-sharp" size={13} /> {item.address}
                  </Text>
                )
              ) : hasLocation ? (
                <TouchableOpacity
                  onPress={() => openMaps(item)}
                  activeOpacity={0.6}
                  style={styles.addressLinkBox}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Ionicons name="location-sharp" size={14} color={colors.primary} />
                  <Text style={styles.addressLinkText} numberOfLines={1}>{t('directory.viewLocation')}</Text>
                </TouchableOpacity>
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
                <Text style={styles.debtBadge}><Ionicons name="cash" size={12} /> ${debtTotal.toLocaleString()}</Text>
              </TouchableOpacity>
            )}
            {hasRelationships && (
              <TouchableOpacity onPress={() => setRelationshipClient(item)}>
                <Text style={styles.familyBadge}><Ionicons name="people" size={12} /> {t('relationships.badge')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* PRODUCT CHIPS */}
          {prodChips.length > 0 && (
            <View style={styles.prodChipsRow}>
              {prodChips.map((p, i) => (
                <Text key={i} style={styles.prodChip}>
                  {p.emoji} {p.qty}x {p.label}
                </Text>
              ))}
            </View>
          )}

          {/* ACTION BUTTONS */}
          <View style={styles.actionsRow}>
            <View style={styles.actionButtonsGroup}>
              {item.phone ? (
                <TouchableOpacity onPress={() => callClient(item)} style={styles.actionBtn}>
                  <Text style={styles.actionBtnEmoji}>📞</Text>
                </TouchableOpacity>
              ) : null}
              {item.phone ? (
                <TouchableOpacity onPress={() => sendWhatsApp(item)} style={styles.actionBtn}>
                  <Text style={styles.actionBtnEmoji}>💬</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => setDebtClient(item)} style={styles.actionBtn}>
                <Text style={styles.actionBtnEmoji}>{debtTotal > 0 ? '💰' : '💵'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRelationshipClient(item)} style={styles.actionBtn}>
                <Text style={styles.actionBtnEmoji}>{hasRelationships ? '👨‍👩‍👧' : '👥'}</Text>
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity onPress={() => setEditClient(item)} style={styles.actionBtn}>
                  <Text style={styles.actionBtnEmoji}>✏️</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.scheduleButton}
              onPress={() => setScheduleClient(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.scheduleButtonText}>
                {isOnDemand ? t('directory.schedule') : t('directory.addVisit')}
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
              style={[styles.searchInput, { flex: 1, paddingRight: searchInput ? 36 : 12 }]}
              placeholder={t('directory.searchPlaceholder')}
              placeholderTextColor={colors.textHint}
              value={searchInput}
              onChangeText={setSearchInput}
              autoCorrect={false}
            />
            {searchInput.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchInput('');
                  setSearch('');
                }}
                style={{ position: 'absolute', right: 4, padding: 10 }}
              >
                <Ionicons name="close" size={16} color={colors.textHint} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => {
              if (!canAddClient) {
                Alert.alert(
                  t('home.limitReached'),
                  t('home.limitMessage', { limit: FREE_CLIENT_LIMIT }),
                  [
                    { text: t('cancel'), style: 'cancel' },
                    { text: t('home.seePremium'), onPress: () => navigation.navigate('Paywall') },
                  ],
                );
                return;
              }
              setShowNewClient(true);
            }}
          >
            <Text style={styles.importBtnText}><Ionicons name="add" size={16} /></Text>
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

      <View style={styles.countRow}>
        <Text style={styles.countBadge}>
          {t('directory.clientCount', { count: filteredClients.length })} {activeFilter !== 'all' ? t('directory.ofTotal', { total: counts.total }) : t('directory.inDirectory')}
        </Text>
      </View>

      {/* Client list — avoid mounting FlashList with empty data while
          Firestore is still loading: FlashList v2's progressive-render
          pipeline gets stuck on []→populated transitions, causing the list
          to look empty until the user types. */}
      {clientsLoading && clients.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.tabActive} />
        </View>
      ) : (
        <FlashList
          ref={scrollRef}
          data={filteredClients}
          renderItem={renderClient}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={{ fontSize: 40, marginBottom: 8 }}>{search ? '🔍' : '📋'}</Text>
              <Text style={styles.emptyText}>
                {search ? t('home.noSearchResults') : t('directory.noClients')}
              </Text>
              {search && (
                <Text style={styles.emptySubtext}>{t('home.noSearchResultsSubtitle')}</Text>
              )}
            </View>
          }
        />
      )}
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
        allClients={clients}
        onClose={() => setDebtClient(null)}
        onAddDebt={addDebt}
        onMarkPaid={markDebtPaid}
        onMarkAllPaid={markAllDebtsPaid}
        onEditDebt={editDebt}
      />

      {/* Edit Client Modal (admin only) */}
      {isAdmin && (
        <EditClientModal
          visible={!!editClient}
          client={editClient}
          allClients={clients}
          onSave={updateClient}
          onClose={() => setEditClient(null)}
          onDelete={deleteClient}
          showClientInfo
        />
      )}

      {/* Relationships Modal */}
      <RelationshipsModal
        visible={!!relationshipClient}
        client={relationshipClient ? (clients.find((c) => c.id === relationshipClient.id) || relationshipClient) : null}
        allClients={clients}
        onClose={() => setRelationshipClient(null)}
        onAddRelationship={addRelationship}
        onRemoveRelationship={removeRelationship}
      />

      {/* New Client Modal */}
      <AddClientModal
        visible={showNewClient}
        onSave={async (name, address, phone, targetDay, products, notes, mapsLink) => {
          await addClient(name, address, phone, targetDay, products, notes, mapsLink);
        }}
        onClose={() => setShowNewClient(false)}
      />
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
    gap: 8,
    paddingHorizontal: 2,
    justifyContent: 'center',
    flexGrow: 1,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: s(34),
    borderRadius: s(17),
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
    fontSize: s(10),
    fontWeight: '700',
    color: colors.textMuted,
    backgroundColor: colors.cardBorder,
    minWidth: s(20),
    height: s(20),
    borderRadius: s(10),
    paddingHorizontal: 6,
    textAlign: 'center',
    lineHeight: s(20),
    overflow: 'hidden',
  },
  filterChipCountActive: {
    color: colors.textWhite,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    marginTop: 8,
  },
  countBadge: {
    fontSize: s(12),
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 12,
    overflow: 'hidden',
  },
  listContent: {
    padding: 12,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  cardDebt: {
    borderLeftWidth: 5,
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
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
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
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    letterSpacing: 0.2,
  },
  clientPhone: {
    fontSize: s(11),
    color: colors.textMuted,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  clientAddress: {
    fontSize: s(12),
    color: colors.textMuted,
    marginTop: 3,
    opacity: 0.85,
  },
  clientAddressLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  addressLinkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  addressLinkText: {
    fontSize: s(13),
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
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
    fontSize: s(11),
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
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
  familyBadge: {
    fontSize: s(10),
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
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
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.sectionBackground,
  },
  actionButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  actionBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  actionBtnEmoji: {
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
    color: colors.primaryText,
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
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    fontSize: s(17),
    color: colors.textHint,
  },
  emptySubtext: {
    fontSize: s(14),
    color: colors.textHint,
    marginTop: 6,
    opacity: 0.7,
  },
});
};

export default DirectoryScreen;
