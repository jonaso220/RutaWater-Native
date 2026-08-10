import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { Client } from '../types';
import {
  buildClientIdentityIndex,
  getRelatedRecordStableClientId,
  getStableClientId,
} from '../utils/clientIdentity';
import { buildEffectiveLastActivityDates } from '../utils/recency';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuthContext } from '../context/AuthContext';
import { useClientsStore } from '../stores/clientsStore';
import { useProfileStore } from '../stores/profileStore';
import { useDebtsStore } from '../stores/debtsStore';
import { useNavigation, useFocusEffect, useScrollToTop, useIsFocused } from '@react-navigation/native';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import ScheduleModal from '../components/ScheduleModal';
import DebtModal from '../components/DebtModal';
import EditClientModal from '../components/EditClientModal';
import AddClientModal from '../components/AddClientModal';
import RelationshipsModal from '../components/RelationshipsModal';
import SkeletonCard from '../components/SkeletonCard';
import DirectoryClientCard from '../components/DirectoryClientCard';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { FlashList } from '@shopify/flash-list';
import { useLayout } from '../hooks/useLayout';
import { WIDE_CONTENT_MAX_WIDTH } from '../constants/layout';

const DirectoryScreen = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { fontScale, isWide } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale, isWide), [colors, fontScale, isWide]);
  const navigation = useNavigation<any>();
  const { isAdmin } = useAuthContext();
  const activeProfile = useProfileStore((s) => s.activeProfile);
  // Quién puede editar/borrar clientes en el reparto activo: en Reparto 1 (primary)
  // manda el rol del grupo familiar; en un reparto nuevo, solo su dueño.
  const canManage = activeProfile && !activeProfile.isPrimary ? !!activeProfile.isOwner : isAdmin;
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
  // While the Directory tab is in the background, freeze its derived list so a
  // Firestore snapshot doesn't trigger a fuzzy-match + sort over all 600+
  // clients for a screen the user isn't looking at. It recomputes fresh as
  // soon as the tab regains focus (isFocused flips → the memo re-runs with the
  // current data), so the list is never stale on return.
  const isFocused = useIsFocused();
  const filteredClientsRef = useRef<Client[]>([]);
  // Two states: searchInput drives the TextInput (immediate), search drives
  // the actual filter (debounced). With 600+ clients fuzzyMatch on every
  // keystroke is noticeable; debouncing keeps the UI responsive.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [listFocusVersion, setListFocusVersion] = useState(0);
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
      // FlashList can keep an empty render stack when this tab regains focus
      // after its data changed in the background. A clean mount makes the
      // current rows paint immediately instead of waiting for the first swipe.
      setListFocusVersion((version) => version + 1);
      return () => {
        setSearchInput('');
        setSearch('');
      };
    }, []),
  );

  const clientIdentityIndex = useMemo(
    () => buildClientIdentityIndex(clients),
    [clients],
  );

  // Deudas actuales y legacy convergen solo por identidad explícita.
  const indebtedStableIds = useMemo(() => {
    const set = new Set<string>();
    debts.forEach((debt) => {
      if (!(debt.amount > 0)) return;
      set.add(getRelatedRecordStableClientId(debt, clientIdentityIndex));
    });
    return set;
  }, [clientIdentityIndex, debts]);

  const clientHasDebt = useCallback(
    (client: Client) => indebtedStableIds.has(getStableClientId(client)),
    [indebtedStableIds],
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

  // El índice se construye una sola vez al entrar en Recurrencia. Incluye
  // clientes periódicos y pedidos extra aunque no aparezcan en este filtro.
  const effectiveRecencyById = useMemo(
    () => isFocused && activeFilter === 'recurrencia'
      ? buildEffectiveLastActivityDates(clients)
      : new Map<string, Date | null>(),
    [activeFilter, clients, isFocused],
  );

  // Apply with_debt and recurrencia filters at screen level
  const filteredClients = useMemo(() => {
    // Background tab: keep the last list, skip the expensive recompute.
    if (!isFocused) return filteredClientsRef.current;

    const isSpecialFilter = activeFilter === 'with_debt' || activeFilter === 'recurrencia';
    const base = getFilteredDirectory(search, isSpecialFilter ? 'all' : activeFilter);

    let result: Client[];
    if (activeFilter === 'with_debt') {
      result = base.filter(clientHasDebt);
    } else if (activeFilter === 'recurrencia') {
      result = base
        .filter((c) => (c.freq === 'once' || c.freq === 'on_demand') && !c.isInactive)
        .sort((a, b) => {
          // "Visita del hogar": si visitaste a un familiar, el cliente cuenta como
          // visitado y baja en el orden de antigüedad.
          const dateA = effectiveRecencyById.get(a.id) || null;
          const dateB = effectiveRecencyById.get(b.id) || null;
          // No date = most stale, appears first
          if (!dateA && !dateB) return (a.name || '').localeCompare(b.name || '');
          if (!dateA) return -1;
          if (!dateB) return 1;
          // Oldest first (most stale at top)
          return dateA.getTime() - dateB.getTime();
        });
    } else {
      result = base;
    }

    filteredClientsRef.current = result;
    return result;
  }, [isFocused, search, activeFilter, getFilteredDirectory, debts, clients, effectiveRecencyById, clientHasDebt]);

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
    { key: 'inactive', label: t('directory.filterInactive') },
  ];

  const handleClone = (client: Client) => {
    // Clonar crea un doc nuevo: respeta el límite de clientes del plan free
    // igual que el botón "+" (antes era un bypass).
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
    Alert.alert(
      t('directory.cloneClient'),
      t('directory.cloneConfirm', { name: client.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('directory.clone'),
          onPress: async () => {
            try {
              await cloneClient(client);
              Alert.alert(t('done'), t('directory.cloneDone', { name: client.name }));
            } catch {
              Alert.alert(t('error'), t('directory.cloneError'));
            }
          },
        },
      ],
    );
  };

  const renderClient = useCallback(({ item }: { item: Client }) => (
    <DirectoryClientCard
      client={item}
      debtTotal={getClientDebtTotal(item.id)}
      showRecency={isRecurrenciaMode}
      effectiveLastActivityDate={effectiveRecencyById.get(item.id) || null}
      isAdmin={canManage}
      onSchedule={setScheduleClient}
      onDebt={setDebtClient}
      onRelationship={setRelationshipClient}
      onEdit={setEditClient}
    />
  ), [canManage, isRecurrenciaMode, effectiveRecencyById, getClientDebtTotal]);

  // FlashList v2 can stall on grow transitions (empty→populated), painting
  // nothing until the user scrolls. We remount on tab focus, filter change,
  // and first data arrival so the list always starts from a clean render.
  // We deliberately DON'T key on the search toggle anymore: typing only shrinks
  // and clearing only grows the already-mounted list, and remounting all 600
  // rows on every search in/out was the heavy daily cost (FlashList 2.3.0
  // handles in-place data grow/shrink fine). If the blank-list-until-scroll
  // bug ever returns when CLEARING the search, restore the `search.length > 0`
  // segment to this key.
  const listKey = `${listFocusVersion}|${activeFilter}|${clients.length > 0}`;

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
      {/* Search bar + Import */}
      <View style={styles.searchContainer}>
        <View style={styles.searchContainerInner}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              style={[styles.searchInput, { flex: 1, paddingRight: searchInput ? 36 : 12 }]}
              placeholder={t('directory.searchPlaceholder')}
              placeholderTextColor={colors.textHint}
              value={searchInput}
              onChangeText={setSearchInput}
              autoCorrect={false}
              accessibilityLabel={t('directory.searchPlaceholder')}
            />
            {searchInput.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchInput('');
                  setSearch('');
                }}
                style={{ position: 'absolute', right: 4, padding: 10 }}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={t('directory.clearSearch')}
              >
                <Ionicons name="close" size={16} color={colors.textHint} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.importBtn}
            accessibilityRole="button"
            accessibilityLabel={t('home.newClient')}
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
            const filterCount = f.key === 'all' ? counts.total || 0 : counts[f.key] || 0;
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
                accessibilityRole="button"
                accessibilityLabel={`${f.label}: ${filterCount}`}
                accessibilityState={{ selected: isActive }}
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
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </View>
      ) : (
        <FlashList
          key={listKey}
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
        allClients={clients}
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

      {/* Edit Client Modal (solo dueño/admin del reparto activo) */}
      {canManage && (
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

const getStyles = (colors: ThemeColors, scale: number = 1, isWide: boolean = false) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchContainer: {
    padding: s(12),
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  searchContainerInner: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  searchInput: {
    backgroundColor: colors.sectionBackground,
    borderRadius: s(12),
    paddingHorizontal: s(16),
    paddingVertical: s(12),
    fontSize: s(16),
    color: colors.textPrimary,
  },
  filterBar: {
    marginTop: s(10),
    flexGrow: 0,
  },
  filterBarContent: {
    gap: s(8),
    paddingHorizontal: s(2),
    justifyContent: 'center',
    flexGrow: 1,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingHorizontal: s(12),
    minHeight: s(44),
    paddingVertical: s(7),
    borderRadius: isWide ? s(19) : s(17),
    backgroundColor: colors.sectionBackground,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipWarning: {
    backgroundColor: colors.warningYellow,
  },
  filterChipDanger: {
    backgroundColor: colors.danger,
  },
  filterChipRecurrencia: {
    backgroundColor: colors.warning,
  },
  filterChipText: {
    fontSize: isWide ? s(14) : s(13),
    fontWeight: '700',
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: colors.textWhite,
  },
  filterChipCount: {
    fontSize: isWide ? s(11) : s(10),
    fontWeight: '700',
    color: colors.textMuted,
    backgroundColor: colors.cardBorder,
    minWidth: s(20),
    height: s(20),
    borderRadius: s(10),
    paddingHorizontal: s(6),
    textAlign: 'center',
    lineHeight: s(20),
    overflow: 'hidden',
  },
  filterChipCountActive: {
    color: colors.textWhite,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  countRow: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: s(12),
    marginTop: s(8),
  },
  countBadge: {
    fontSize: s(12),
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: s(12),
    overflow: 'hidden',
  },
  listContent: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH + 24,
    alignSelf: 'center',
    padding: s(12),
    paddingBottom: 100,
  },
  skeletonList: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  importBtn: {
    backgroundColor: colors.primary,
    minWidth: s(44),
    minHeight: s(44),
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderRadius: s(10),
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
