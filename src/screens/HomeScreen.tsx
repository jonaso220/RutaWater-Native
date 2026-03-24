import React, { useState, useCallback, useEffect, useMemo, useRef, useDeferredValue, useTransition } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import ModalOverlay from '../components/ModalOverlay';
import DraggableFlatList, {
  ScaleDecorator,
  RenderItemParams,
} from 'react-native-draggable-flatlist';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useScrollToTop } from '@react-navigation/native';
import { Client } from '../types';
import { ALL_DAYS, PRODUCTS } from '../constants/products';
import { getTodayDayName, fuzzyMatch, getNextVisitDate } from '../utils/helpers';
import { db } from '../config/firebase';
import { useAuthContext } from '../context/AuthContext';
import { useClientsStore } from '../stores/clientsStore';
import { useDebtsStore } from '../stores/debtsStore';
import { useTransfersStore } from '../stores/transfersStore';
import { useDailyLoadsStore } from '../stores/dailyLoadsStore';
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
import RelationshipsModal from '../components/RelationshipsModal';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';

type ListItem =
  | { type: 'header'; key: string; title: string; count: number; isToday: boolean }
  | { type: 'client'; key: string; client: Client; sectionDateKey: string };

// --- Memoized SectionHeader to avoid re-renders ---
interface SectionHeaderProps {
  title: string;
  count: number;
  isToday: boolean;
  colors: ThemeColors;
  fontScale: number;
}

const SectionHeader = React.memo<SectionHeaderProps>(({ title, count, isToday, colors, fontScale }) => {
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);
  return (
    <View style={[styles.sectionHeader, isToday && styles.sectionHeaderToday]}>
      <Text style={[styles.sectionHeaderText, isToday && styles.sectionHeaderTextToday]}>
        {title}
      </Text>
      <Text style={[styles.sectionHeaderCount, isToday && styles.sectionHeaderCountToday]}>
        {count}
      </Text>
    </View>
  );
});

// Stable keyExtractor — defined outside component to avoid re-creation
const keyExtractor = (item: ListItem) => item.key;

// --- Memoized DaySelector to avoid re-renders when client list changes ---
// Use gesture-handler components to avoid touch conflicts in horizontal ScrollView on Android
import { ScrollView as GHScrollView, TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';

interface DaySelectorProps {
  selectedDay: string;
  dayCounts: Record<string, number>;
  isWide: boolean;
  colors: ThemeColors;
  fontScale: number;
  onSelectDay: (day: string) => void;
}

const DaySelector = React.memo<DaySelectorProps>(({
  selectedDay,
  dayCounts,
  isWide,
  colors,
  fontScale,
  onSelectDay,
}) => {
  const styles = getStyles(colors, fontScale);
  const todayName = useMemo(() => getTodayDayName(), []);

  return (
    <GHScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.daySelector}
      contentContainerStyle={styles.daySelectorContent}
    >
      {ALL_DAYS.map((day) => {
        const isToday = day === todayName;
        const isSelected = day === selectedDay;
        const count = dayCounts[day] || 0;

        return (
          <GHTouchableOpacity
            key={day}
            onPress={() => onSelectDay(day)}
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
          </GHTouchableOpacity>
        );
      })}
    </GHScrollView>
  );
});

// --- Memoized wrapper to prevent ClientCard re-renders on every day switch ---
interface ClientItemProps {
  client: Client;
  globalIndex: number;
  isAdmin: boolean;
  hasDebt: boolean;
  hasPendingTransfer: boolean;
  hasRelationships: boolean;
  isDragEnabled: boolean;
  enCaminoMessage?: string;
  fontScale?: number;
  selectedDay: string;
  onMarkDone: (client: Client) => void;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
  onDebt: (client: Client) => void;
  onToggleStar: (client: Client) => void;
  onTransfer: (client: Client) => void;
  onAlarm: (client: Client) => void;
  onRelationships: (client: Client) => void;
  onChangePosition: (clientId: string, newPos: number, day: string) => void;
  drag?: () => void;
}

const ClientItem = React.memo<ClientItemProps>(({
  client,
  globalIndex,
  isAdmin,
  hasDebt,
  hasPendingTransfer,
  hasRelationships,
  isDragEnabled,
  enCaminoMessage,
  fontScale,
  selectedDay,
  onMarkDone,
  onEdit,
  onDelete,
  onDebt,
  onToggleStar,
  onTransfer,
  onAlarm,
  onRelationships,
  onChangePosition,
  drag,
}) => {
  const handleMarkDone = useCallback(() => onMarkDone(client), [onMarkDone, client]);
  const handleEdit = useCallback(() => onEdit(client), [onEdit, client]);
  const handleDelete = useCallback(() => onDelete(client), [onDelete, client]);
  const handleDebt = useCallback(() => onDebt(client), [onDebt, client]);
  const handleToggleStar = useCallback(() => onToggleStar(client), [onToggleStar, client]);
  const handleTransfer = useCallback(() => onTransfer(client), [onTransfer, client]);
  const handleAlarm = useCallback(() => onAlarm(client), [onAlarm, client]);
  const handleRelationships = useCallback(() => onRelationships(client), [onRelationships, client]);
  const handleChangePosition = useCallback(
    (newPos: number) => onChangePosition(client.id, newPos, selectedDay),
    [onChangePosition, client.id, selectedDay],
  );

  return (
    <ScaleDecorator activeScale={1.03}>
      <ClientCard
        client={client}
        index={globalIndex}
        isAdmin={isAdmin}
        hasDebt={hasDebt}
        hasPendingTransfer={hasPendingTransfer}
        hasRelationships={hasRelationships}
        onMarkDone={handleMarkDone}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDebt={handleDebt}
        onToggleStar={handleToggleStar}
        onTransfer={handleTransfer}
        onAlarm={handleAlarm}
        onRelationships={handleRelationships}
        onChangePosition={handleChangePosition}
        onDrag={isDragEnabled ? drag : undefined}
        enCaminoMessage={enCaminoMessage}
        fontScale={fontScale}
      />
    </ScaleDecorator>
  );
});

const HomeScreen = () => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { fontScale, isWide } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);

  const navigation = useNavigation<any>();
  const { isAdmin, user, groupData } = useAuthContext();
  const clients = useClientsStore((s) => s.clients);
  const loading = useClientsStore((s) => s.loading);
  const getAllDayClients = useClientsStore((s) => s.getAllDayClients);
  const getVisibleClients = useClientsStore((s) => s.getVisibleClients);
  const getCompletedClients = useClientsStore((s) => s.getCompletedClients);
  const markAsDone = useClientsStore((s) => s.markAsDone);
  const undoComplete = useClientsStore((s) => s.undoComplete);
  const deleteAllCompleted = useClientsStore((s) => s.deleteAllCompleted);
  const deleteFromDay = useClientsStore((s) => s.deleteFromDay);
  const updateClient = useClientsStore((s) => s.updateClient);
  const toggleStar = useClientsStore((s) => s.toggleStar);
  const saveAlarm = useClientsStore((s) => s.saveAlarm);
  const addNote = useClientsStore((s) => s.addNote);
  const addClient = useClientsStore((s) => s.addClient);
  const changePosition = useClientsStore((s) => s.changePosition);
  const addRelationship = useClientsStore((s) => s.addRelationship);
  const removeRelationship = useClientsStore((s) => s.removeRelationship);
  const dayCounts = useClientsStore((s) => s.dayCounts);
  const canAddClient = useClientsStore((s) => s.canAddClient);
  const debts = useDebtsStore((s) => s.debts);
  const addDebt = useDebtsStore((s) => s.addDebt);
  const markDebtPaid = useDebtsStore((s) => s.markDebtPaid);
  const editDebt = useDebtsStore((s) => s.editDebt);
  const getClientDebtTotal = useDebtsStore((s) => s.getClientDebtTotal);
  const markAllDebtsPaid = useDebtsStore((s) => s.markAllDebtsPaid);
  const transfers = useTransfersStore((s) => s.transfers);
  const hasPendingTransfer = useTransfersStore((s) => s.hasPendingTransfer);
  const addTransfer = useTransfersStore((s) => s.addTransfer);
  const markTransferReviewed = useTransfersStore((s) => s.markTransferReviewed);
  const dailyLoad = useDailyLoadsStore((s) => s.dailyLoad);
  const loadForDay = useDailyLoadsStore((s) => s.loadForDay);
  const saveDailyLoad = useDailyLoadsStore((s) => s.saveDailyLoad);

  const scrollRef = useRef<any>(null);
  useScrollToTop(scrollRef);
  const [selectedDay, setSelectedDay] = useState(() => {
    return getTodayDayName();
  });
  // Deferred day: tab highlights instantly, list updates in background
  const deferredDay = useDeferredValue(selectedDay);
  const isDayPending = selectedDay !== deferredDay;
  const [, startTransition] = useTransition();
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showDailyLoadModal, setShowDailyLoadModal] = useState(false);
  const [showTransfersSheet, setShowTransfersSheet] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showDebtsSheet, setShowDebtsSheet] = useState(false);
  const [relationshipClient, setRelationshipClient] = useState<Client | null>(null);
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

  // Refs to access state without adding as dependencies (stabilizes callbacks)
  const undoInfoRef = useRef(undoInfo);
  undoInfoRef.current = undoInfo;
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;

  // Fix 3: Detect cross-midnight day change
  useEffect(() => {
    let lastKnownToday = getTodayDayName();

    const checkDay = () => {
      const currentToday = getTodayDayName();
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

  const handleSelectDay = useCallback((day: string) => {
    setSelectedDay((prev) => {
      if (day === prev) {
        scrollRef.current?.scrollToOffset?.({ offset: 0, animated: true });
        return prev;
      }
      return day;
    });
  }, [startTransition]);

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

  const allVisibleClients = useMemo(() => getVisibleClients(deferredDay), [getVisibleClients, deferredDay]);
  const completedClients = useMemo(() => getCompletedClients(deferredDay), [getCompletedClients, deferredDay]);

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
    const todayKey = today.toISOString().split('T')[0];

    const groups: Record<string, Client[]> = {};

    // Cache getDayIndex result for selectedDay since it's the same for all clients
    visibleClients.forEach((c) => {
      const nextDate = getNextVisitDate(c, deferredDay);
      const dateKey = nextDate
        ? nextDate.toISOString().split('T')[0].slice(0, 10)
        : todayKey;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(c);
    });

    const dayNames = [t('days.domingo'), t('days.lunes'), t('days.martes'), t('days.miercoles'), t('days.jueves'), t('days.viernes'), t('days.sabado')];
    const monthNames = [t('months.ene'), t('months.feb'), t('months.mar'), t('months.abr'), t('months.may'), t('months.jun'), t('months.jul'), t('months.ago'), t('months.sep'), t('months.oct'), t('months.nov'), t('months.dic')];

    return Object.keys(groups)
      .sort()
      .map((dateKey) => {
        const d = new Date(dateKey + 'T00:00:00');
        const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        let label: string;
        if (diffDays <= 0) {
          label = `${t('home.today')} — ${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
        } else if (diffDays === 1) {
          label = `${t('home.tomorrow')} — ${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
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
  }, [visibleClients, deferredDay]);

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

  // Load daily load data when day changes + scroll to top
  useEffect(() => {
    loadForDay(deferredDay);
    // Scroll to top on day change for instant feel
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    });
  }, [deferredDay, loadForDay]);

  const handleMarkDone = useCallback(
    (client: Client) => {
      // Clear any existing undo timer (via ref to avoid dependency)
      if (undoInfoRef.current?.timer) clearTimeout(undoInfoRef.current.timer);

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
    [markAsDone],
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
        t('home.removeFromList'),
        t('home.removeFromListMsg'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('home.remove'),
            onPress: () => deleteFromDay(client.id, selectedDayRef.current),
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
          t('home.activeAlarm'),
          `Alarma: ${client.alarm}`,
          [
            { text: t('close'), style: 'cancel' },
            {
              text: t('home.removeAlarm'),
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
          t('home.addTransfer'),
          t('home.addTransferMsg', { name: client.name }),
          [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('add'),
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
  // Reuse allVisibleClients instead of calling getAllDayClients again
  const globalPositionMap = useMemo(() => {
    const map: Record<string, number> = {};
    allVisibleClients.forEach((c, idx) => {
      map[c.id] = idx;
    });
    return map;
  }, [allVisibleClients]);

  // Pre-compute debt and transfer maps so we don't call functions inline per-client
  const debtMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    visibleClients.forEach((c) => {
      map[c.id] = getClientDebtTotal(c.id) > 0;
    });
    return map;
  }, [visibleClients, getClientDebtTotal]);

  const transferMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    visibleClients.forEach((c) => {
      map[c.id] = hasPendingTransfer(c.id);
    });
    return map;
  }, [visibleClients, hasPendingTransfer]);

  const relationshipMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    visibleClients.forEach((c) => {
      map[c.id] = !!(c.relationships && Object.keys(c.relationships).length > 0);
    });
    return map;
  }, [visibleClients]);

  // Stable callbacks that accept client as parameter (won't change on day switch)
  const handleEditCb = useCallback((client: Client) => setEditingClient(client), []);
  const handleDebtCb = useCallback((client: Client) => setDebtClient(client), []);
  const handleRelationshipsCb = useCallback((client: Client) => setRelationshipClient(client), []);

  // Use refs for data that changes frequently but shouldn't recreate renderItem
  const globalPositionMapRef = useRef(globalPositionMap);
  globalPositionMapRef.current = globalPositionMap;
  const debtMapRef = useRef(debtMap);
  debtMapRef.current = debtMap;
  const transferMapRef = useRef(transferMap);
  transferMapRef.current = transferMap;
  const relationshipMapRef = useRef(relationshipMap);
  relationshipMapRef.current = relationshipMap;
  const isDragEnabledRef = useRef(isDragEnabled);
  isDragEnabledRef.current = isDragEnabled;
  const selectedDayForRenderRef = useRef(selectedDay);
  selectedDayForRenderRef.current = selectedDay;
  const appSettingsRef = useRef(appSettings);
  appSettingsRef.current = appSettings;

  const renderDraggableItem = useCallback(
    ({ item, drag }: RenderItemParams<ListItem>) => {
      if (item.type === 'header') {
        return (
          <SectionHeader
            title={item.title}
            count={item.count}
            isToday={item.isToday}
            colors={colors}
            fontScale={fontScale}
          />
        );
      }

      const client = item.client;
      const globalIndex = globalPositionMapRef.current[client.id] ?? 0;

      return (
        <ClientItem
          client={client}
          globalIndex={globalIndex}
          isAdmin={isAdmin}
          hasDebt={debtMapRef.current[client.id] ?? false}
          hasPendingTransfer={transferMapRef.current[client.id] ?? false}
          hasRelationships={relationshipMapRef.current[client.id] ?? false}
          isDragEnabled={isDragEnabledRef.current}
          enCaminoMessage={appSettingsRef.current?.whatsappEnCamino}
          fontScale={fontScale}
          selectedDay={selectedDayForRenderRef.current}
          onMarkDone={handleMarkDone}
          onEdit={handleEditCb}
          onDelete={handleDelete}
          onDebt={handleDebtCb}
          onToggleStar={handleToggleStar}
          onTransfer={handleTransfer}
          onAlarm={handleAlarm}
          onRelationships={handleRelationshipsCb}
          onChangePosition={changePosition}
          drag={drag}
        />
      );
    },
    [isAdmin, handleMarkDone, handleDelete, handleToggleStar, handleTransfer, handleAlarm, changePosition, colors, fontScale, handleEditCb, handleDebtCb, handleRelationshipsCb],
  );

  const flatListDataRef = useRef(flatListData);
  flatListDataRef.current = flatListData;

  const handleDragEnd = useCallback(
    ({ data, from, to }: { data: ListItem[]; from: number; to: number }) => {
      if (from === to) return;

      const movedItem = flatListDataRef.current[from];
      if (!movedItem || movedItem.type !== 'client') return;

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
      const day = selectedDayRef.current;
      const allDayClients = getAllDayClients(day);
      let targetPos: number;

      if (prevClientId) {
        const prevIdx = allDayClients.findIndex((c) => c.id === prevClientId);
        targetPos = prevIdx >= 0 ? prevIdx + 2 : 1;
      } else if (nextClientId) {
        const nextIdx = allDayClients.findIndex((c) => c.id === nextClientId);
        targetPos = nextIdx >= 0 ? nextIdx + 1 : 1;
      } else {
        targetPos = 1;
      }

      changePosition(movedItem.client.id, targetPos, day);
    },
    [changePosition, getAllDayClients],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('home.loadingClients')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
      {/* Day selector */}
      <DaySelector
        selectedDay={selectedDay}
        dayCounts={dayCounts}
        isWide={isWide}
        colors={colors}
        fontScale={fontScale}
        onSelectDay={handleSelectDay}
      />

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
                t('home.limitReached'),
                t('home.limitMessage', { limit: FREE_CLIENT_LIMIT }),
                [
                  { text: t('cancel'), style: 'cancel' },
                  { text: t('home.seePremium'), onPress: () => navigation.navigate('Paywall') },
                ],
              );
              return;
            }
            setShowAddClientModal(true);
          }}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnAddText]}>+ {t('home.client')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnNote]}
          onPress={() => setShowNoteModal(true)}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnNoteText]}>+ {t('home.note')}</Text>
        </TouchableOpacity>
        {debts.length > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDebt]}
            onPress={() => setShowDebtsSheet(true)}
          >
            <Text style={[styles.actionBtnText, styles.actionBtnDebtText]}>
              {t('home.debts')} ({debts.length})
            </Text>
          </TouchableOpacity>
        )}
        {pendingTransferCount > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnTransfer]}
            onPress={() => setShowTransfersSheet(true)}
          >
            <Text style={[styles.actionBtnText, styles.actionBtnTransferText]}>
              {t('home.transfers')} ({pendingTransferCount})
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Search bar + Filters */}
      <View style={styles.searchSection}>
        <View style={styles.searchRow}>
          <View style={styles.searchInputWrapper}>
            <Text style={[styles.searchIcon, { fontSize: 14 }]}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder={t('home.searchPlaceholder')}
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
              {t('home.filters')}{activeFilters.size > 0 ? ` (${activeFilters.size})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        {showFilters && (
          <View style={styles.filtersPanel}>
            <Text style={styles.filterSectionTitle}>{t('home.filterType')}</Text>
            <View style={styles.filterChipsRow}>
              <TouchableOpacity
                style={[styles.filterChip, activeFilters.has('once_starred') && styles.filterChipActive]}
                onPress={() => toggleFilter('once_starred')}
              >
                <Text style={[styles.filterChipText, activeFilters.has('once_starred') && styles.filterChipTextActive]}>
                  ⭐ {t('home.filterOnceStarred')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterChip, activeFilters.has('con_deuda') && styles.filterChipActive]}
                onPress={() => toggleFilter('con_deuda')}
              >
                <Text style={[styles.filterChipText, activeFilters.has('con_deuda') && styles.filterChipTextActive]}>
                  💰 {t('home.filterWithDebt')}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.filterSectionTitle, { marginTop: 10 }]}>{t('home.filterProducts')}</Text>
            <View style={styles.filterChipsRow}>
              {PRODUCTS.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.filterChip, activeFilters.has(p.id) && styles.filterChipActive]}
                  onPress={() => toggleFilter(p.id)}
                >
                  <Text style={[styles.filterChipText, activeFilters.has(p.id) && styles.filterChipTextActive]}>
                    {p.emoji} {p.short}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Client list */}
      <DraggableFlatList
        ref={scrollRef}
        data={flatListData}
        extraData={`${debts.length}-${transfers.length}`}
        keyExtractor={keyExtractor}
        renderItem={renderDraggableItem}
        onDragEnd={handleDragEnd}
        activationDistance={15}
        containerStyle={[{ flex: 1 }, isDayPending && { opacity: 0.6 }]}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
        updateCellsBatchingPeriod={30}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>📋</Text>
            <Text style={styles.emptyText}>
              {t('home.noClients', { day: selectedDay })}
            </Text>
          </View>
        }
        ListFooterComponent={completedClients.length > 0 ? (
          <View style={styles.completedSection}>
            <TouchableOpacity
              onPress={() => setShowCompleted(!showCompleted)}
              style={styles.completedHeader}
              activeOpacity={0.7}
            >
              <Text style={styles.completedTitle}>
                {showCompleted ? '▼' : '▶'} {t('home.completed')} ({completedClients.length})
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
                    <Text style={styles.completedHint}>{t('home.tapToUndo')}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.deleteAllBtn}
                  onPress={() => {
                    Alert.alert(
                      t('home.deleteAllTitle'),
                      t('home.deleteAllMessage', { count: completedClients.length, day: selectedDay }),
                      [
                        { text: t('cancel'), style: 'cancel' },
                        {
                          text: t('home.deleteAllConfirm'),
                          style: 'destructive',
                          onPress: () => deleteAllCompleted(selectedDay),
                        },
                      ],
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.deleteAllBtnText}>🗑️ {t('home.deleteAll')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
      />
      </View>

      {/* Undo Banner */}
      {undoInfo && (
        <View style={styles.undoBanner}>
          <Text style={styles.undoBannerText} numberOfLines={1}>
            {t('home.clientCompleted', { name: undoInfo.client.name })}
          </Text>
          <TouchableOpacity onPress={handleUndoMarkDone} style={styles.undoButton}>
            <Text style={styles.undoButtonText}>{t('home.undo')}</Text>
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

      {/* Relationships Modal */}
      <RelationshipsModal
        visible={!!relationshipClient}
        client={relationshipClient ? (clients.find((c) => c.id === relationshipClient.id) || relationshipClient) : null}
        allClients={clients}
        onClose={() => setRelationshipClient(null)}
        onAddRelationship={addRelationship}
        onRemoveRelationship={removeRelationship}
      />

      {/* Alarm Time Picker */}
      {Platform.OS === 'android' && !!alarmPromptClient && (
        <DateTimePicker
          value={alarmTime}
          mode="time"
          display="default"
          onChange={(event: DateTimePickerEvent, date?: Date) => {
            if (event.type === 'set' && date && alarmPromptClient) {
              const hours = date.getHours().toString().padStart(2, '0');
              const minutes = date.getMinutes().toString().padStart(2, '0');
              saveAlarm(alarmPromptClient.id, `${hours}:${minutes}`);
            }
            setAlarmPromptClient(null);
          }}
        />
      )}
      {Platform.OS === 'ios' && (
        <ModalOverlay visible={!!alarmPromptClient} onClose={() => setAlarmPromptClient(null)} animationType="fade">
          <View style={styles.alarmOverlay}>
            <View style={styles.alarmModal}>
              <Text style={styles.alarmTitle}>{t('home.selectTime')}</Text>
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
                  <Text style={styles.alarmCancelText}>{t('cancel')}</Text>
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
                  <Text style={styles.alarmSaveText}>{t('save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ModalOverlay>
      )}
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
