import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Client } from '../types';
import { ALL_DAYS, PRODUCTS } from '../constants/products';
import { getTodayDayName, normalizeText, getNextVisitDate } from '../utils/helpers';
import { useAuthContext } from '../context/AuthContext';
import { useClientsContext } from '../context/ClientsContext';
import { useDebtsContext } from '../context/DebtsContext';
import { useTransfersContext } from '../context/TransfersContext';
import { useDailyLoadsContext } from '../context/DailyLoadsContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import ClientCard from '../components/ClientCard';
import EditClientModal from '../components/EditClientModal';
import DebtModal from '../components/DebtModal';
import ProductCounter from '../components/ProductCounter';
import NoteModal from '../components/NoteModal';
import DailyLoadModal from '../components/DailyLoadModal';
import TransfersSheet from '../components/TransfersSheet';
import DebtsSheet from '../components/DebtsSheet';
import AddClientModal from '../components/AddClientModal';
import PromptModal from '../components/PromptModal';

const HomeScreen = () => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);

  const { isAdmin } = useAuthContext();
  const {
    clients,
    loading,
    getAllDayClients,
    getVisibleClients,
    getCompletedClients,
    markAsDone,
    undoComplete,
    deleteAllCompleted,
    deleteFromDay,
    updateClient,
    toggleStar,
    saveAlarm,
    addNote,
    addClient,
    changePosition,
    dayCounts,
  } = useClientsContext();
  const { debts, addDebt, markDebtPaid, editDebt, getClientDebtTotal } = useDebtsContext();
  const { transfers, hasPendingTransfer, addTransfer, markTransferReviewed } = useTransfersContext();
  const { dailyLoad, loadForDay, saveDailyLoad } = useDailyLoadsContext();

  const sectionListRef = useRef<SectionList>(null);
  const [selectedDay, setSelectedDay] = useState(getTodayDayName());
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showDailyLoadModal, setShowDailyLoadModal] = useState(false);
  const [showTransfersSheet, setShowTransfersSheet] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showDebtsSheet, setShowDebtsSheet] = useState(false);
  const [alarmPromptClient, setAlarmPromptClient] = useState<Client | null>(null);
  const [alarmTime, setAlarmTime] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const toggleFilter = useCallback((filterId: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filterId)) {
        next.delete(filterId);
      } else {
        next.add(filterId);
      }
      return next;
    });
  }, []);

  const allVisibleClients = getVisibleClients(selectedDay);
  const completedClients = getCompletedClients(selectedDay);

  const visibleClients = useMemo(() => {
    let filtered = allVisibleClients;

    // Search filter
    if (searchTerm.trim()) {
      const term = normalizeText(searchTerm);
      filtered = filtered.filter((c) => {
        const name = normalizeText(c.name || '');
        const address = normalizeText(c.address || '');
        return name.includes(term) || address.includes(term);
      });
    }

    // Active filters
    if (activeFilters.size > 0) {
      filtered = filtered.filter((c) => {
        for (const f of activeFilters) {
          if (f === 'once_fav') {
            if (c.freq !== 'once' && !c.isStarred) return false;
          } else if (f === 'con_deuda') {
            if (getClientDebtTotal(c.id) <= 0) return false;
          } else {
            // Product filter
            const qty = parseInt(String(c.products?.[f] || 0), 10);
            if (qty <= 0) return false;
          }
        }
        return true;
      });
    }

    return filtered;
  }, [allVisibleClients, searchTerm, activeFilters, getClientDebtTotal]);

  // Group clients by next visit date for section headers
  const clientSections = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const groups: Record<string, Client[]> = {};

    visibleClients.forEach((c) => {
      const nextDate = getNextVisitDate(c, selectedDay);
      let dateKey: string;
      if (nextDate) {
        const d = new Date(nextDate);
        d.setHours(0, 0, 0, 0);
        dateKey = d.toISOString().split('T')[0];
      } else {
        dateKey = today.toISOString().split('T')[0];
      }
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(c);
    });

    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    return Object.keys(groups)
      .sort()
      .map((dateKey) => {
        const d = new Date(dateKey + 'T12:00:00');
        const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        let label: string;
        if (diffDays <= 0) {
          label = `Hoy — ${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
        } else if (diffDays === 1) {
          label = `Mañana — ${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
        } else {
          label = `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
        }

        return {
          title: label,
          dateKey,
          isToday: diffDays <= 0,
          data: groups[dateKey],
        };
      });
  }, [visibleClients, selectedDay]);

  // Clients for the nearest date only (for the product counter)
  const nearestDateClients = useMemo(() => {
    if (clientSections.length === 0) return [];
    return clientSections[0].data;
  }, [clientSections]);

  // Load daily load data when day changes
  useEffect(() => {
    loadForDay(selectedDay);
  }, [selectedDay, loadForDay]);

  const handleMarkDone = useCallback(
    (client: Client) => {
      markAsDone(client.id, client);
    },
    [markAsDone],
  );

  const handleDelete = useCallback(
    (client: Client) => {
      Alert.alert(
        'Quitar de la lista?',
        'Se guardara en el Directorio.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Quitar',
            onPress: () => deleteFromDay(client.id),
          },
        ],
      );
    },
    [deleteFromDay],
  );

  const handleUndoComplete = useCallback(
    (client: Client) => {
      undoComplete(client.id);
    },
    [undoComplete],
  );

  const handleToggleStar = useCallback(
    (client: Client) => {
      toggleStar(client.id, client.isStarred);
    },
    [toggleStar],
  );

  const handleAlarm = useCallback(
    (client: Client) => {
      if (client.alarm) {
        Alert.alert(
          'Alarma activa',
          `Alarma: ${client.alarm}`,
          [
            { text: 'Cerrar', style: 'cancel' },
            {
              text: 'Quitar alarma',
              style: 'destructive',
              onPress: () => saveAlarm(client.id, ''),
            },
          ],
        );
      } else {
        // Set default time to current hour rounded to next 30 min
        const now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
        setAlarmTime(now);
        setAlarmPromptClient(client);
      }
    },
    [saveAlarm],
  );

  const handleTransfer = useCallback(
    (client: Client) => {
      if (hasPendingTransfer(client.id)) {
        setShowTransfersSheet(true);
      } else {
        Alert.alert(
          'Agregar transferencia?',
          `Marcar transferencia pendiente para ${client.name}`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Agregar',
              onPress: () => addTransfer(client),
            },
          ],
        );
      }
    },
    [hasPendingTransfer, addTransfer],
  );

  const pendingTransferCount = transfers.length;

  // Map client ID to its global position among ALL clients for the day
  const globalPositionMap = useMemo(() => {
    const allClients = getAllDayClients(selectedDay);
    const map: Record<string, number> = {};
    allClients.forEach((c, idx) => {
      map[c.id] = idx;
    });
    return map;
  }, [getAllDayClients, selectedDay]);

  const renderClient = useCallback(
    ({ item }: { item: Client }) => {
      const globalIndex = globalPositionMap[item.id] ?? 0;
      return (
        <ClientCard
          client={item}
          index={globalIndex}
          isAdmin={isAdmin}
          hasDebt={getClientDebtTotal(item.id) > 0}
          hasPendingTransfer={hasPendingTransfer(item.id)}
          onMarkDone={() => handleMarkDone(item)}
          onEdit={() => setEditingClient(item)}
          onDelete={() => handleDelete(item)}
          onDebt={() => setDebtClient(item)}
          onToggleStar={() => handleToggleStar(item)}
          onTransfer={() => handleTransfer(item)}
          onAlarm={() => handleAlarm(item)}
          onChangePosition={(newPos) => changePosition(item.id, newPos, selectedDay)}
        />
      );
    },
    [isAdmin, handleMarkDone, handleDelete, getClientDebtTotal, hasPendingTransfer, handleToggleStar, handleTransfer, handleAlarm, changePosition, selectedDay, globalPositionMap],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Cargando clientes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Day selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.daySelector}
        contentContainerStyle={styles.daySelectorContent}
      >
        {ALL_DAYS.map((day) => {
          const isToday = day === getTodayDayName();
          const isSelected = day === selectedDay;
          const count = dayCounts[day] || 0;

          return (
            <TouchableOpacity
              key={day}
              onPress={() => {
                if (day === selectedDay) {
                  sectionListRef.current?.scrollToLocation({
                    sectionIndex: 0,
                    itemIndex: 0,
                    viewOffset: 0,
                    animated: true,
                  });
                } else {
                  setSelectedDay(day);
                }
              }}
              style={[
                styles.dayChip,
                isSelected && styles.dayChipSelected,
                isToday && !isSelected && styles.dayChipToday,
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.dayChipText,
                  isSelected && styles.dayChipTextSelected,
                ]}
              >
                {day.slice(0, 3)}
              </Text>
              <Text
                style={[
                  styles.dayCount,
                  isSelected && styles.dayCountSelected,
                ]}
              >
                {count}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Product counter — only nearest date */}
      <ProductCounter clients={nearestDateClients} />

      {/* Action bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.actionBar}
        contentContainerStyle={styles.actionBarContent}
      >
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnAdd]}
          onPress={() => setShowAddClientModal(true)}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnAddText]}>+ Cliente</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnNote]}
          onPress={() => setShowNoteModal(true)}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnNoteText]}>+ Nota</Text>
        </TouchableOpacity>
        {debts.length > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDebt]}
            onPress={() => setShowDebtsSheet(true)}
          >
            <Text style={[styles.actionBtnText, styles.actionBtnDebtText]}>
              Deudas ({debts.length})
            </Text>
          </TouchableOpacity>
        )}
        {pendingTransferCount > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnTransfer]}
            onPress={() => setShowTransfersSheet(true)}
          >
            <Text style={[styles.actionBtnText, styles.actionBtnTransferText]}>
              Transf ({pendingTransferCount})
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Search bar + Filters */}
      <View style={styles.searchSection}>
        <View style={styles.searchRow}>
          <View style={styles.searchInputWrapper}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Buscar por nombre o direccion..."
              placeholderTextColor={colors.textHint}
              autoCorrect={false}
            />
            {searchTerm.length > 0 && (
              <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.filterToggleBtn, showFilters && styles.filterToggleBtnActive]}
            onPress={() => setShowFilters(!showFilters)}
          >
            <Text style={[styles.filterToggleText, showFilters && styles.filterToggleTextActive]}>
              Filtros{activeFilters.size > 0 ? ` (${activeFilters.size})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        {showFilters && (
          <View style={styles.filtersPanel}>
            <Text style={styles.filterSectionTitle}>TIPO</Text>
            <View style={styles.filterChipsRow}>
              <TouchableOpacity
                style={[styles.filterChip, activeFilters.has('once_fav') && styles.filterChipActive]}
                onPress={() => toggleFilter('once_fav')}
              >
                <Text style={[styles.filterChipText, activeFilters.has('once_fav') && styles.filterChipTextActive]}>
                  ☆ Una vez / Favoritos
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, activeFilters.has('con_deuda') && styles.filterChipActive]}
                onPress={() => toggleFilter('con_deuda')}
              >
                <Text style={[styles.filterChipText, activeFilters.has('con_deuda') && styles.filterChipTextActive]}>
                  $ Con deuda
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.filterSectionTitle, { marginTop: 10 }]}>PRODUCTOS</Text>
            <View style={styles.filterChipsRow}>
              {PRODUCTS.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.filterChip, activeFilters.has(p.id) && styles.filterChipActive]}
                  onPress={() => toggleFilter(p.id)}
                >
                  <Text style={[styles.filterChipText, activeFilters.has(p.id) && styles.filterChipTextActive]}>
                    {p.icon} {p.short}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Client list */}
      <SectionList
        ref={sectionListRef}
        sections={clientSections}
        renderItem={renderClient}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, section.isToday && styles.sectionHeaderToday]}>
            <Text style={[styles.sectionHeaderText, section.isToday && styles.sectionHeaderTextToday]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionHeaderCount, section.isToday && styles.sectionHeaderCountToday]}>
              {section.data.length}
            </Text>
          </View>
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>
              No hay clientes para {selectedDay}
            </Text>
          </View>
        }
        ListFooterComponent={
          completedClients.length > 0 ? (
            <View style={styles.completedSection}>
              <TouchableOpacity
                onPress={() => setShowCompleted(!showCompleted)}
                style={styles.completedHeader}
                activeOpacity={0.7}
              >
                <Text style={styles.completedTitle}>
                  {showCompleted ? '▼' : '▶'} Completados ({completedClients.length})
                </Text>
              </TouchableOpacity>
              {showCompleted && (
                <>
                  {completedClients.map((client) => (
                    <TouchableOpacity
                      key={client.id}
                      style={styles.completedCard}
                      onPress={() => handleUndoComplete(client)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.completedName}>
                        {(client.name || '').toUpperCase()}
                      </Text>
                      <Text style={styles.completedHint}>Tocar para deshacer</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={styles.deleteAllBtn}
                    onPress={() => {
                      Alert.alert(
                        'Eliminar completados',
                        `Eliminar ${completedClients.length} cliente${completedClients.length !== 1 ? 's' : ''} completado${completedClients.length !== 1 ? 's' : ''}?`,
                        [
                          { text: 'Cancelar', style: 'cancel' },
                          {
                            text: 'Eliminar todo',
                            style: 'destructive',
                            onPress: () => deleteAllCompleted(selectedDay),
                          },
                        ],
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.deleteAllBtnText}>🗑️ Eliminar todo</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null
        }
      />

      {/* Edit Client Modal */}
      <EditClientModal
        visible={!!editingClient}
        client={editingClient}
        onSave={updateClient}
        onClose={() => setEditingClient(null)}
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

      {/* Note Modal */}
      <NoteModal
        visible={showNoteModal}
        onSave={addNote}
        onClose={() => setShowNoteModal(false)}
      />

      {/* Daily Load Modal */}
      <DailyLoadModal
        visible={showDailyLoadModal}
        day={selectedDay}
        initialData={dailyLoad}
        onSave={saveDailyLoad}
        onClose={() => setShowDailyLoadModal(false)}
      />

      {/* Add Client Modal */}
      <AddClientModal
        visible={showAddClientModal}
        day={selectedDay}
        onSave={addClient}
        onClose={() => setShowAddClientModal(false)}
      />

      {/* Debts Sheet */}
      <DebtsSheet
        visible={showDebtsSheet}
        debts={debts}
        clients={clients}
        isAdmin={isAdmin}
        onMarkPaid={markDebtPaid}
        onEditDebt={editDebt}
        onClose={() => setShowDebtsSheet(false)}
        onTransferPayment={(clientId) => {
          const client = clients.find((c) => c.id === clientId);
          if (!client) return;
          if (!hasPendingTransfer(clientId)) {
            addTransfer(client);
          }
          setShowDebtsSheet(false);
          setShowTransfersSheet(true);
        }}
      />

      {/* Transfers Sheet */}
      <TransfersSheet
        visible={showTransfersSheet}
        transfers={transfers}
        isAdmin={isAdmin}
        onReview={markTransferReviewed}
        onClose={() => setShowTransfersSheet(false)}
      />

      {/* Alarm Time Picker Modal */}
      <Modal visible={!!alarmPromptClient} animationType="fade" transparent>
        <View style={styles.alarmOverlay}>
          <View style={styles.alarmModal}>
            <Text style={styles.alarmTitle}>Seleccionar hora</Text>
            <DateTimePicker
              value={alarmTime}
              mode="time"
              display="spinner"
              onChange={(_event: DateTimePickerEvent, date?: Date) => {
                if (date) setAlarmTime(date);
              }}
              locale="es-ES"
              themeVariant={isDark ? 'dark' : 'light'}
              style={{ height: 150 }}
            />
            <View style={styles.alarmActions}>
              <TouchableOpacity
                style={styles.alarmCancelBtn}
                onPress={() => setAlarmPromptClient(null)}
              >
                <Text style={styles.alarmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.alarmSaveBtn}
                onPress={() => {
                  if (alarmPromptClient) {
                    const hours = alarmTime.getHours().toString().padStart(2, '0');
                    const minutes = alarmTime.getMinutes().toString().padStart(2, '0');
                    saveAlarm(alarmPromptClient.id, `${hours}:${minutes}`);
                  }
                  setAlarmPromptClient(null);
                }}
              >
                <Text style={styles.alarmSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: 14,
  },
  daySelector: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  daySelectorContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dayChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.sectionBackground,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  dayChipSelected: {
    backgroundColor: colors.primary,
  },
  dayChipToday: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  dayChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayChipTextSelected: {
    color: colors.textWhite,
  },
  dayCount: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    backgroundColor: colors.cardBorder,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  dayCountSelected: {
    color: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  actionBar: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  actionBarContent: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: {
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  actionBtnAdd: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  actionBtnAddText: {
    color: colors.primary,
  },
  actionBtnNote: {
    backgroundColor: colors.warningAmberBg,
    borderWidth: 1,
    borderColor: colors.warningAmberBorder,
  },
  actionBtnNoteText: {
    color: colors.warningDarker,
  },
  actionBtnDebt: {
    backgroundColor: colors.dangerLight,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  actionBtnDebtText: {
    color: colors.danger,
  },
  actionBtnTransfer: {
    backgroundColor: colors.successLighter,
    borderWidth: 1,
    borderColor: colors.successLight,
  },
  actionBtnTransferText: {
    color: colors.successDark,
  },
  searchSection: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    fontSize: 14,
    color: colors.textHint,
  },
  filterToggleBtn: {
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterToggleBtnActive: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primary,
  },
  filterToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  filterToggleTextActive: {
    color: colors.primary,
  },
  filtersPanel: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.sectionBackground,
  },
  filterSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textHint,
    marginBottom: 6,
  },
  filterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.primaryDark,
  },
  listContent: {
    padding: 12,
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 6,
    marginBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: colors.cardBorder,
  },
  sectionHeaderToday: {
    borderBottomColor: colors.primary,
  },
  sectionHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
  sectionHeaderTextToday: {
    color: colors.primary,
  },
  sectionHeaderCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textHint,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionHeaderCountToday: {
    color: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textHint,
  },
  completedSection: {
    borderTopWidth: 2,
    borderTopColor: colors.cardBorder,
    borderStyle: 'dashed',
    marginTop: 12,
    paddingTop: 4,
  },
  completedHeader: {
    padding: 12,
  },
  completedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textHint,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  completedCard: {
    backgroundColor: colors.successLighter,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  completedName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.successText,
  },
  completedHint: {
    fontSize: 11,
    color: colors.successAccent,
    fontStyle: 'italic',
  },
  deleteAllBtn: {
    backgroundColor: colors.dangerLight,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  deleteAllBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
  },
  alarmOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  alarmModal: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
  },
  alarmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  alarmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  alarmCancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.sectionBackground,
  },
  alarmCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMuted,
  },
  alarmSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  alarmSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textWhite,
  },
});

export default HomeScreen;
