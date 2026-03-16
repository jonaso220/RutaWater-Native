import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
} from 'react-native';
import DraggableFlatList, {
  NestableScrollContainer,
  NestableDraggableFlatList,
  ScaleDecorator,
  RenderItemParams,
} from 'react-native-draggable-flatlist';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useScrollToTop } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { Client } from '../types';
import { ALL_DAYS, PRODUCTS } from '../constants/products';
import { getTodayDayName, fuzzyMatch, getNextVisitDate } from '../utils/helpers';
import { db } from '../config/firebase';
import { useAuthContext } from '../context/AuthContext';
import { useClientsContext } from '../context/ClientsContext';
import { useDebtsContext } from '../context/DebtsContext';
import { useTransfersContext } from '../context/TransfersContext';
import { useDailyLoadsContext } from '../context/DailyLoadsContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
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
import { useNavigation } from '@react-navigation/native';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';

type ListItem =
  | { type: 'header'; key: string; title: string; count: number; isToday: boolean }
  | { type: 'client'; key: string; client: Client; sectionDateKey: string };

const HomeScreen = () => {
  const { colors, isDark } = useTheme();
  const { fontScale, isWide } = useLayout();
  const styles = getStyles(colors, fontScale);

  const navigation = useNavigation<any>();
  const { isAdmin, user, groupData } = useAuthContext();
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
    canAddClient,
    clientCount,
  } = useClientsContext();
  const { debts, addDebt, markDebtPaid, editDebt, getClientDebtTotal, markAllDebtsPaid } = useDebtsContext();
  const { transfers, hasPendingTransfer, addTransfer, markTransferReviewed } = useTransfersContext();
  const { dailyLoad, loadForDay, saveDailyLoad } = useDailyLoadsContext();

  const scrollRef = useRef<any>(null);
  useScrollToTop(scrollRef);
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = getTodayDayName();
    return today === 'Domingo' ? 'Lunes' : today;
  });
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
  const [appSettings, setAppSettings] = useState<Record<string, string> | null>(null);
  const [undoInfo, setUndoInfo] = useState<{
    client: Client;
    previousData: Record<string, any>;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Fix 3: Detect cross-midnight day change
  useEffect(() => {
    const rawToday = getTodayDayName();
    let lastKnownToday = rawToday === 'Domingo' ? 'Lunes' : rawToday;

    const checkDay = () => {
      let currentToday = getTodayDayName();
      if (currentToday === 'Domingo') currentToday = 'Lunes';
      if (currentToday !== lastKnownToday) {
        // Day changed! Only auto-switch if user was viewing the old "today"
        if (selectedDay === lastKnownToday) {
          setSelectedDay(currentToday);
        }
        lastKnownToday = currentToday;
      }
    };
    const interval = setInterval(checkDay, 60000);
    return () => clearInterval(interval);
  }, [selectedDay]);

  // Fix 4: Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fix 5: Clean up undo banner timer on unmount
  useEffect(() => {
    return () => {
      if (undoInfo?.timer) clearTimeout(undoInfo.timer);
    };
  }, [undoInfo]);

  // Load WhatsApp templates
  useEffect(() => {
    if (!user?.uid) return;
    const settingsDocId = groupData?.groupId || user.uid;
    db.collection('settings').doc(settingsDocId).get().then((doc) => {
      if (doc.exists) setAppSettings(doc.data() as Record<string, string>);
    }).catch(() => {});
  }, [user?.uid, groupData?.groupId]);

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

    // Fuzzy search filter (debounced)
    if (debouncedSearchTerm.trim()) {
      const matcher = fuzzyMatch(debouncedSearchTerm);
      filtered = filtered.filter((c) => matcher(c.name || '', c.address || '', c.phone || ''));
    }

    // Active filters (type filters: AND, product filters: OR — matches webapp)
    if (activeFilters.size > 0) {
      const typeFilters = [...activeFilters].filter((f) => f === 'once_starred' || f === 'con_deuda');
      const productFilters = [...activeFilters].filter((f) => f !== 'once_starred' && f !== 'con_deuda');

      filtered = filtered.filter((c) => {
        // Type filters: AND (must pass all)
        const passesType = typeFilters.every((f) => {
          if (f === 'once_starred') return c.freq === 'once' || c.isStarred;
          if (f === 'con_deuda') return getClientDebtTotal(c.id) > 0;
          return true;
        });
        // Product filters: OR (must have at least one)
        const passesProduct = productFilters.length === 0 || productFilters.some((f) => {
          const qty = parseInt(String(c.products?.[f] || 0), 10);
          return qty > 0;
        });
        return passesType && passesProduct;
      });
    }

    return filtered;
  }, [allVisibleClients, debouncedSearchTerm, activeFilters, getClientDebtTotal]);

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
        const d = new Date(dateKey + 'T00:00:00');
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

  // Flatten sections into a single array for DraggableFlatList
  const flatListData = useMemo(() => {
    const items: ListItem[] = [];
    clientSections.forEach((section) => {
      items.push({
        type: 'header',
        key: `header-${section.dateKey}`,
        title: section.title,
        count: section.data.length,
        isToday: section.isToday,
      });
      section.data.forEach((client) => {
        items.push({
          type: 'client',
          key: client.id,
          client,
          sectionDateKey: section.dateKey,
        });
      });
    });
    return items;
  }, [clientSections]);

  const isDragEnabled = debouncedSearchTerm.trim().length === 0 && activeFilters.size === 0;

  // Load daily load data when day changes
  useEffect(() => {
    loadForDay(selectedDay);
  }, [selectedDay, loadForDay]);

  const handleMarkDone = useCallback(
    (client: Client) => {
      // Clear any existing undo timer
      if (undoInfo?.timer) clearTimeout(undoInfo.timer);

      // Save previous state for undo
      const previousData: Record<string, any> = {};
      if (client.freq === 'once') {
        previousData.isCompleted = client.isCompleted;
        previousData.completedAt = client.completedAt ? (client.completedAt.toDate ? client.completedAt.toDate() : client.completedAt) : null;
        previousData.alarm = client.alarm;
        previousData.isStarred = client.isStarred;
      } else {
        previousData.lastVisited = client.lastVisited ? (client.lastVisited.toDate ? client.lastVisited.toDate() : client.lastVisited) : null;
        previousData.specificDate = client.specificDate;
        previousData.alarm = client.alarm;
        previousData.isStarred = client.isStarred;
      }

      // Execute mark as done
      markAsDone(client.id, client);

      // Show undo banner with 5 second timer
      const timer = setTimeout(() => {
        setUndoInfo(null);
      }, 5000);

      setUndoInfo({ client, previousData, timer });
    },
    [markAsDone, undoInfo],
  );

  const handleUndoMarkDone = useCallback(() => {
    if (!undoInfo) return;
    clearTimeout(undoInfo.timer);

    const { client, previousData } = undoInfo;

    if (client.freq === 'once') {
      undoComplete(client.id);
    } else {
      // Revert the periodic client
      updateClient(client.id, {
        lastVisited: previousData.lastVisited,
        specificDate: previousData.specificDate,
        alarm: previousData.alarm,
        isStarred: previousData.isStarred,
      } as any);
    }

    setUndoInfo(null);
  }, [undoInfo, undoComplete, updateClient]);

  const handleDelete = useCallback(
    (client: Client) => {
      Alert.alert(
        'Quitar de la lista?',
        'Se guardara en el Directorio.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Quitar',
            onPress: () => deleteFromDay(client.id, selectedDay),
          },
        ],
      );
    },
    [deleteFromDay, selectedDay],
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

  const renderDraggableItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<ListItem>) => {
      if (item.type === 'header') {
        return (
          <View style={[styles.sectionHeader, item.isToday && styles.sectionHeaderToday]}>
            <Text style={[styles.sectionHeaderText, item.isToday && styles.sectionHeaderTextToday]}>
              {item.title}
            </Text>
            <Text style={[styles.sectionHeaderCount, item.isToday && styles.sectionHeaderCountToday]}>
              {item.count}
            </Text>
          </View>
        );
      }

      const client = item.client;
      const globalIndex = globalPositionMap[client.id] ?? 0;

      return (
        <ScaleDecorator activeScale={1.03}>
          <ClientCard
            client={client}
            index={globalIndex}
            isAdmin={isAdmin}
            hasDebt={getClientDebtTotal(client.id) > 0}
            hasPendingTransfer={hasPendingTransfer(client.id)}
            onMarkDone={() => handleMarkDone(client)}
            onEdit={() => setEditingClient(client)}
            onDelete={() => handleDelete(client)}
            onDebt={() => setDebtClient(client)}
            onToggleStar={() => handleToggleStar(client)}
            onTransfer={() => handleTransfer(client)}
            onAlarm={() => handleAlarm(client)}
            onChangePosition={(newPos) => changePosition(client.id, newPos, selectedDay)}
            onDrag={isDragEnabled ? drag : undefined}
            enCaminoMessage={appSettings?.whatsappEnCamino}
            fontScale={fontScale}
          />
        </ScaleDecorator>
      );
    },
    [isDragEnabled, isAdmin, handleMarkDone, handleDelete, getClientDebtTotal, hasPendingTransfer, handleToggleStar, handleTransfer, handleAlarm, changePosition, selectedDay, globalPositionMap, appSettings, styles],
  );

  const handleDragEnd = useCallback(
    ({ data, from, to }: { data: ListItem[]; from: number; to: number }) => {
      if (from === to) return;

      const movedItem = flatListData[from];
      if (movedItem.type !== 'client') return;

      // Find which section the item landed in (walk backward in reordered data)
      let landedSectionKey: string | null = null;
      for (let i = to; i >= 0; i--) {
        if (data[i].type === 'header') {
          landedSectionKey = data[i].key.replace('header-', '');
          break;
        }
      }

      // Reject cross-section drag
      if (landedSectionKey !== movedItem.sectionDateKey) return;

      // Find neighbor clients at the drop position in the reordered array
      let prevClientId: string | null = null;
      let nextClientId: string | null = null;

      for (let i = to - 1; i >= 0; i--) {
        if (data[i].type === 'header') break;
        if (data[i].type === 'client' && data[i].key !== movedItem.key) {
          prevClientId = data[i].key;
          break;
        }
      }
      for (let i = to + 1; i < data.length; i++) {
        if (data[i].type === 'header') break;
        if (data[i].type === 'client' && data[i].key !== movedItem.key) {
          nextClientId = data[i].key;
          break;
        }
      }

      // Map neighbor to position in the full day client list
      const allDayClients = getAllDayClients(selectedDay);
      let targetPos: number;

      if (prevClientId) {
        const prevIdx = allDayClients.findIndex((c) => c.id === prevClientId);
        targetPos = prevIdx >= 0 ? prevIdx + 2 : 1; // 1-indexed, after prev
      } else if (nextClientId) {
        const nextIdx = allDayClients.findIndex((c) => c.id === nextClientId);
        targetPos = nextIdx >= 0 ? nextIdx + 1 : 1; // 1-indexed, at next's position
      } else {
        targetPos = 1;
      }

      changePosition(movedItem.client.id, targetPos, selectedDay);
    },
    [flatListData, changePosition, selectedDay, getAllDayClients],
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
      <View style={{ flex: 1 }}>
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
                  scrollRef.current?.scrollTo({ y: 0, animated: true });
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
                {isWide ? day : day.slice(0, 3)}
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
          onPress={() => {
            if (!canAddClient) {
              Alert.alert(
                'Limite alcanzado',
                `Has alcanzado el limite de ${FREE_CLIENT_LIMIT} clientes del plan gratuito. Actualiza a Premium para clientes ilimitados.`,
                [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Ver Premium', onPress: () => navigation.navigate('Paywall') },
                ],
              );
              return;
            }
            setShowAddClientModal(true);
          }}
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
            <Ionicons name="search" size={16} color={colors.textHint} style={styles.searchIcon} />
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
                style={[styles.filterChip, activeFilters.has('once_starred') && styles.filterChipActive]}
                onPress={() => toggleFilter('once_starred')}
              >
                <Text style={[styles.filterChipText, activeFilters.has('once_starred') && styles.filterChipTextActive]}>
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
                    <Ionicons name={p.icon} size={13} /> {p.short}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Client list */}
      <NestableScrollContainer
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
      >
        {flatListData.length > 0 ? (
          <NestableDraggableFlatList
            data={flatListData}
            keyExtractor={(item) => item.key}
            renderItem={renderDraggableItem}
            onDragEnd={handleDragEnd}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="clipboard-outline" size={40} color={colors.textHint} style={{ marginBottom: 8 }} />
            <Text style={styles.emptyText}>
              No hay clientes para {selectedDay}
            </Text>
          </View>
        )}

        {/* Completed section */}
        {completedClients.length > 0 && (
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
                  <Text style={styles.deleteAllBtnText}><Ionicons name="trash" size={14} /> Eliminar todo</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </NestableScrollContainer>
      </View>

      {/* Undo Banner */}
      {undoInfo && (
        <View style={styles.undoBanner}>
          <Text style={styles.undoBannerText} numberOfLines={1}>
            {undoInfo.client.name} completado
          </Text>
          <TouchableOpacity onPress={handleUndoMarkDone} style={styles.undoButton}>
            <Text style={styles.undoButtonText}>Deshacer</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Edit Client Modal */}
      <EditClientModal
        visible={!!editingClient}
        client={editingClient}
        onSave={updateClient}
        onClose={() => setEditingClient(null)}
        showClientInfo
      />

      {/* Debt Modal */}
      <DebtModal
        visible={!!debtClient}
        client={debtClient}
        debts={debts}
        debtTemplate={appSettings?.whatsappDeuda}
        reminderTemplate={appSettings?.whatsappRecordatorio}
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
        onMarkAllPaid={markAllDebtsPaid}
        onEditDebt={editDebt}
        onClose={() => setShowDebtsSheet(false)}
        onAddDebt={addDebt}
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

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
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
    fontSize: s(16),
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
    justifyContent: 'center',
    flexGrow: 1,
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
    fontSize: s(16),
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayChipTextSelected: {
    color: colors.textWhite,
  },
  dayCount: {
    fontSize: s(13),
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
    fontSize: s(14),
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
    fontSize: s(16),
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: s(16),
    color: colors.textPrimary,
    padding: 0,
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    fontSize: s(16),
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
    fontSize: s(14),
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
    fontSize: s(13),
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: s(14),
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
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textMuted,
  },
  sectionHeaderTextToday: {
    color: colors.primary,
  },
  sectionHeaderCount: {
    fontSize: s(14),
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
    fontSize: s(48),
    marginBottom: 12,
  },
  emptyText: {
    fontSize: s(17),
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
    fontSize: s(15),
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
    fontSize: s(15),
    fontWeight: '700',
    color: colors.successText,
  },
  completedHint: {
    fontSize: s(13),
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
    fontSize: s(15),
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
    maxWidth: 400,
    alignSelf: 'center' as const,
    width: '100%' as const,
  },
  alarmTitle: {
    fontSize: s(20),
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
    fontSize: s(17),
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
    fontSize: s(17),
    fontWeight: '700',
    color: colors.textWhite,
  },
  undoBanner: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: colors.textPrimary,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 999,
  },
  undoBannerText: {
    color: colors.background,
    fontSize: s(15),
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  undoButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  undoButtonText: {
    color: colors.textWhite,
    fontSize: s(14),
    fontWeight: '700',
  },
});
};

export default HomeScreen;
