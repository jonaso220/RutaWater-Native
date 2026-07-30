import React, { useState, useCallback, useEffect, useMemo, useRef, useDeferredValue, useTransition } from 'react';
import { reportError } from '../lib/crashReporting';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  RefreshControl,
  FlatList,
  Linking,
  Animated,
  Easing,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import ModalOverlay from '../components/ModalOverlay';
import { useScrollToTop, useFocusEffect } from '@react-navigation/native';
import { Client } from '../types';
import { useProducts } from '../stores/productCatalogStore';
import { getTodayDayName, fuzzyMatch, getNextVisitDate, toLocalDateString, parseDate, settingsDocId } from '../utils/helpers';
import { hapticLight, hapticSelection } from '../utils/haptics';
import { db } from '../config/firebase';
import { useAuthContext } from '../context/AuthContext';
import { useClientsStore } from '../stores/clientsStore';
import { useDebtsStore } from '../stores/debtsStore';
import { useTransfersStore } from '../stores/transfersStore';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import ClientCard from '../components/ClientCard';
import SkeletonCard from '../components/SkeletonCard';
import AlarmPicker from '../components/AlarmPicker';
import UndoBanner from '../components/UndoBanner';
import { useUndoQueue } from '../hooks/useUndoQueue';
import EditClientModal from '../components/EditClientModal';
import ClientProductsModal from '../components/ClientProductsModal';
import ClientNotesModal from '../components/ClientNotesModal';
import DebtModal from '../components/DebtModal';
import ProductCounter from '../components/ProductCounter';
import NoteModal from '../components/NoteModal';
import TransfersSheet from '../components/TransfersSheet';
import DebtsSheet from '../components/DebtsSheet';
import AddClientModal from '../components/AddClientModal';
import PromptModal from '../components/PromptModal';
import SmartOrderModal from '../components/SmartOrderModal';
import RelationshipsModal from '../components/RelationshipsModal';
import ProfilesModal from '../components/ProfilesModal';
import CalendarModal from '../components/CalendarModal';
import { useProfileStore } from '../stores/profileStore';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { Frequency } from '../constants/products';
import { WIDE_CONTENT_MAX_WIDTH } from '../constants/layout';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  RouteMapStop,
  RouteSession as RouteSessionState,
  buildGoogleMapsDirectionsUrl,
  coordinatesFromClient,
  reconcileRouteSession,
} from '../utils/mapsRoute';

type ListItem =
  | { type: 'header'; key: string; title: string; count: number; isToday: boolean }
  | { type: 'client'; key: string; client: Client }
  | { type: 'gridrow'; key: string; clients: Client[]; sectionDateKey: string };

type RouteSession = RouteSessionState & { routeDay: string };

// --- Memoized SectionHeader to avoid re-renders ---
interface SectionHeaderProps {
  title: string;
  count: number;
  isToday: boolean;
  colors: ThemeColors;
  fontScale: number;
  isWide?: boolean;
}

const SectionHeader = React.memo<SectionHeaderProps>(({ title, count, isToday, colors, fontScale, isWide = false }) => {
  const styles = useMemo(() => getStyles(colors, fontScale, isWide), [colors, fontScale, isWide]);
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

const REORDER_ANIMATION_MS = 240;
const REFRESH_TIMEOUT_MS = 10_000;
const reorderLayoutAnimation = {
  duration: REORDER_ANIMATION_MS,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
};

import DaySelector from '../components/DaySelector';
import { ProductLabel } from '../components/ProductIcon';

// --- Memoized wrapper to prevent ClientCard re-renders on every day switch ---
interface ClientItemProps {
  client: Client;
  globalIndex: number;
  isAdmin: boolean;
  hasDebt: boolean;
  hasPendingTransfer: boolean;
  hasRelationships: boolean;
  enCaminoMessage?: string;
  fontScale?: number;
  wideLayout?: boolean;
  selectedDay: string;
  onMarkDone: (client: Client) => void;
  onEdit: (client: Client) => void;
  onEditProducts: (client: Client) => void;
  onEditNotes: (client: Client) => void;
  onDelete: (client: Client) => void;
  onDebt: (client: Client) => void;
  onToggleStar: (client: Client) => void;
  onTransfer: (client: Client) => void;
  onAlarm: (client: Client) => void;
  onRelationships: (client: Client) => void;
  onChangePosition: (clientId: string, newPos: number, day: string) => void;
}

const ClientItem = React.memo<ClientItemProps>(({
  client,
  globalIndex,
  isAdmin,
  hasDebt,
  hasPendingTransfer,
  hasRelationships,
  enCaminoMessage,
  fontScale,
  wideLayout,
  selectedDay,
  onMarkDone,
  onEdit,
  onEditProducts,
  onEditNotes,
  onDelete,
  onDebt,
  onToggleStar,
  onTransfer,
  onAlarm,
  onRelationships,
  onChangePosition,
}) => {
  const handleMarkDone = useCallback(() => onMarkDone(client), [onMarkDone, client]);
  const handleEdit = useCallback(() => onEdit(client), [onEdit, client]);
  const handleEditProducts = useCallback(() => onEditProducts(client), [onEditProducts, client]);
  const handleEditNotes = useCallback(() => onEditNotes(client), [onEditNotes, client]);
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
    <ClientCard
      client={client}
      index={globalIndex}
      isAdmin={isAdmin}
      hasDebt={hasDebt}
      hasPendingTransfer={hasPendingTransfer}
      hasRelationships={hasRelationships}
      onMarkDone={handleMarkDone}
      onEdit={handleEdit}
      onEditProducts={handleEditProducts}
      onEditNotes={handleEditNotes}
      onDelete={handleDelete}
      onDebt={handleDebt}
      onToggleStar={handleToggleStar}
      onTransfer={handleTransfer}
      onAlarm={handleAlarm}
      onRelationships={handleRelationships}
      onChangePosition={handleChangePosition}
      enCaminoMessage={enCaminoMessage}
      fontScale={fontScale}
      wideLayout={wideLayout}
    />
  );
});

const HomeScreen = () => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { fontScale, isWide, width: screenWidth } = useLayout();
  // Always a single column. On wide screens (Mac/iPad) the card itself switches
  // to a horizontal layout (info on the left, action buttons on the right) so it
  // uses the extra width instead of tiling into 2 narrower columns.
  const numColumns = 1;
  // Gate the card's horizontal (wide) layout: only on genuinely large screens.
  const wideCard = screenWidth >= 900;
  // The single-row command deck needs desktop-class width. iPad portrait is
  // considered wide for typography, but not wide enough to keep every label.
  const extraWideHeader = screenWidth >= 1100;
  // Chrome (day tabs, product counter, action bar, search) scales with the
  // global fontScale, which now ramps up on wide screens (see useLayout).
  const styles = useMemo(
    () => getStyles(colors, fontScale, isWide, extraWideHeader),
    [colors, fontScale, isWide, extraWideHeader],
  );
  const chromeSize = (value: number) => Math.round(value * fontScale);

  const navigation = useNavigation<any>();
  const { isAdmin, user, groupData } = useAuthContext();
  const catalogProducts = useProducts();
  const profileSwitcherVisible = useProfileStore((s) => s.switcherVisible);
  const setProfileSwitcherVisible = useProfileStore((s) => s.setSwitcherVisible);
  const clients = useClientsStore((s) => s.clients);
  const loading = useClientsStore((s) => s.loading);
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
  const updateNote = useClientsStore((s) => s.updateNote);
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
  const [productsClient, setProductsClient] = useState<Client | null>(null);
  const [notesClient, setNotesClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showTransfersSheet, setShowTransfersSheet] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showSmartModal, setShowSmartModal] = useState(false);
  const [showDebtsSheet, setShowDebtsSheet] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [relationshipClient, setRelationshipClient] = useState<Client | null>(null);
  const [alarmPromptClient, setAlarmPromptClient] = useState<Client | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [routeSession, setRouteSession] = useState<RouteSession | null>(null);
  const collapsibleHeaderProgress = useRef(new Animated.Value(1)).current;
  const collapsibleHeaderVisibleRef = useRef(true);
  const lastListOffsetRef = useRef(0);
  const lastScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const scrollDirectionDistanceRef = useRef(0);
  const [collapsibleHeaderHeight, setCollapsibleHeaderHeight] = useState(0);
  const reorderAnimationActiveRef = useRef(false);
  const reorderAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
    return () => {
      if (reorderAnimationTimerRef.current) clearTimeout(reorderAnimationTimerRef.current);
      if (quickActionTimerRef.current) clearTimeout(quickActionTimerRef.current);
    };
  }, []);

  const setCollapsibleHeaderVisible = useCallback((visible: boolean, animate = true) => {
    if (collapsibleHeaderVisibleRef.current === visible) {
      if (!animate) collapsibleHeaderProgress.setValue(visible ? 1 : 0);
      return;
    }

    collapsibleHeaderVisibleRef.current = visible;
    collapsibleHeaderProgress.stopAnimation();
    if (!animate) {
      collapsibleHeaderProgress.setValue(visible ? 1 : 0);
      return;
    }

    Animated.timing(collapsibleHeaderProgress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [collapsibleHeaderProgress]);

  const resetHeaderScrollTracking = useCallback(() => {
    lastListOffsetRef.current = 0;
    lastScrollDirectionRef.current = 0;
    scrollDirectionDistanceRef.current = 0;
  }, []);

  const handleClientListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = offset - lastListOffsetRef.current;
    lastListOffsetRef.current = offset;

    if (offset <= 8) {
      lastScrollDirectionRef.current = 0;
      scrollDirectionDistanceRef.current = 0;
      setCollapsibleHeaderVisible(true);
      return;
    }
    if (Math.abs(delta) < 1) return;

    const direction: -1 | 1 = delta > 0 ? 1 : -1;
    if (lastScrollDirectionRef.current !== direction) {
      lastScrollDirectionRef.current = direction;
      scrollDirectionDistanceRef.current = 0;
    }
    scrollDirectionDistanceRef.current += Math.abs(delta);

    const distanceToToggle = direction === 1 ? 24 : 12;
    if (scrollDirectionDistanceRef.current >= distanceToToggle) {
      setCollapsibleHeaderVisible(direction === -1);
      scrollDirectionDistanceRef.current = 0;
    }
  }, [setCollapsibleHeaderVisible]);

  const handleCollapsibleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setCollapsibleHeaderHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
    }
  }, []);

  // Pull-to-refresh: force a server-side read of clients so the user can
  // get a fresh copy even if the realtime listener is temporarily quiet
  // (e.g. after coming back from background or in poor network).
  // El scope debe ser el del REPARTO ACTIVO (igual que la query del listener):
  // con el grupo primario acá, refrescar desde un reparto custom primaba la
  // caché del scope equivocado y no traía nada de lo que se estaba viendo.
  const activeScopeGroupId = useProfileStore((s) => s.activeProfile?.scopeGroupId);
  const onRefresh = useCallback(async () => {
    if (!user?.uid) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    setRefreshing(true);
    hapticSelection();
    try {
      // Perfil activo primero; si todavía no cargó, caer al grupo familiar
      // (comportamiento previo) y por último al usuario solo.
      const scopeGroupId = activeScopeGroupId || groupData?.groupId;
      const scopeField = scopeGroupId ? 'groupId' : 'userId';
      const scopeValue = scopeGroupId || user.uid;
      const serverRead = db
        .collection('clients')
        .where(scopeField, '==', scopeValue)
        .get({ source: 'server' });

      // Firestore can leave a forced server read pending indefinitely when
      // connectivity drops. The realtime listener may still recover later,
      // but the native RefreshControl must always be released.
      await Promise.race([
        serverRead,
        new Promise<void>((resolve) => {
          refreshTimer = setTimeout(resolve, REFRESH_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      reportError(e, 'Refresh error');
    } finally {
      if (refreshTimer) clearTimeout(refreshTimer);
      setRefreshing(false);
    }
  }, [user?.uid, activeScopeGroupId, groupData?.groupId]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [appSettings, setAppSettings] = useState<Record<string, string> | null>(null);
  // Queue of undo entries: each "Listo" tap pushes one. Banner shows the
  // newest; tapping Undo pops the newest. Each entry self-expires after 5s.
  // This avoids losing undo capability when the user marks several clients
  const { queue: undoQueue, push: pushUndo, undoMostRecent: handleUndoMarkDone } = useUndoQueue();
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Clear search when leaving this tab
  useFocusEffect(
    useCallback(() => {
      return () => setSearchTerm('');
    }, []),
  );

  // Refs to access state without adding as dependencies (stabilizes callbacks)
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;
  const routeSessionRef = useRef<RouteSession | null>(routeSession);
  routeSessionRef.current = routeSession;

  const updateRouteSession = useCallback((session: RouteSession | null) => {
    routeSessionRef.current = session;
    setRouteSession(session);
  }, []);

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

  // Load WhatsApp templates (real-time listener)
  useEffect(() => {
    if (!user?.uid) return;
    const docId = settingsDocId(user.uid, groupData?.groupId);
    const unsubscribe = db.collection('settings').doc(docId).onSnapshot((doc) => {
      if (doc.exists) setAppSettings(doc.data() as Record<string, string>);
    }, () => {});
    return () => unsubscribe();
  }, [user?.uid, groupData?.groupId]);

  const handleSelectDay = useCallback((day: string) => {
    setShowFilters(false);
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

  const clearFreqFilters = useCallback(() => {
    setActiveFilters((prev) => {
      if (![...prev].some((f) => f.startsWith('freq_'))) return prev;
      return new Set([...prev].filter((f) => !f.startsWith('freq_')));
    });
  }, []);

  const hasFreqFilter = [...activeFilters].some((f) => f.startsWith('freq_'));

  const allVisibleClients = useMemo(() => getVisibleClients(deferredDay), [getVisibleClients, deferredDay]);
  const completedClients = useMemo(() => getCompletedClients(deferredDay), [getCompletedClients, deferredDay]);

  const visibleClients = useMemo(() => {
    let filtered = allVisibleClients;

    // Fuzzy search filter (debounced)
    if (debouncedSearchTerm.trim()) {
      const matcher = fuzzyMatch(debouncedSearchTerm);
      filtered = filtered.filter((c) => matcher(c.name || '', c.address || '', c.phone || ''));
    }

    // Active filters (type filters: AND, freq filters: OR, product filters: OR — matches webapp)
    if (activeFilters.size > 0) {
      const typeFilters = [...activeFilters].filter((f) => f === 'once_starred' || f === 'con_deuda');
      const freqFilters = [...activeFilters].filter((f) => f.startsWith('freq_'));
      const productFilters = [...activeFilters].filter(
        (f) => f !== 'once_starred' && f !== 'con_deuda' && !f.startsWith('freq_')
      );

      filtered = filtered.filter((c) => {
        // Type filters: AND (must pass all)
        const passesType = typeFilters.every((f) => {
          if (f === 'once_starred') return c.freq === 'once' || c.isStarred;
          if (f === 'con_deuda') return getClientDebtTotal(c.id) > 0;
          return true;
        });
        // Frequency filters: OR (a client has a single freq, so AND would never match two)
        const passesFreq = freqFilters.length === 0 || freqFilters.includes(`freq_${c.freq}`);
        // Product filters: OR (must have at least one)
        const passesProduct = productFilters.length === 0 || productFilters.some((f) => {
          const qty = parseInt(String(c.products?.[f] || 0), 10);
          return qty > 0;
        });
        return passesType && passesFreq && passesProduct;
      });
    }

    return filtered;
  }, [allVisibleClients, debouncedSearchTerm, activeFilters, getClientDebtTotal]);

  // Group clients by next visit date for section headers
  const clientSections = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Local date keys: toISOString() is UTC and would shift the day in
    // timezones east of Greenwich (harmless in UTC-3, wrong in Europe).
    const todayKey = toLocalDateString(today);

    const groups: Record<string, Client[]> = {};

    // Cache getDayIndex result for selectedDay since it's the same for all clients
    visibleClients.forEach((c) => {
      const nextDate = getNextVisitDate(c, deferredDay);
      let dateKey = nextDate ? toLocalDateString(nextDate) : todayKey;
      // Overdue dates (e.g. an uncompleted one-time order from days ago) group
      // under today: they're still pending, and a past dateKey would create a
      // bogus extra "Hoy" section and hijack the day's load counter.
      if (dateKey < todayKey) dateKey = todayKey;
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

  // Route preparation must ignore temporary search/product filters. Otherwise
  // starting a route while a search is active would silently omit clients.
  const nearestRouteClients = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = toLocalDateString(today);
    let nearestKey: string | null = null;
    const keyed = allVisibleClients.map((client) => {
      const nextDate = getNextVisitDate(client, deferredDay);
      let dateKey = nextDate ? toLocalDateString(nextDate) : todayKey;
      if (dateKey < todayKey) dateKey = todayKey;
      if (nearestKey === null || dateKey < nearestKey) nearestKey = dateKey;
      return { client, dateKey };
    });
    return keyed.filter((item) => item.dateKey === nearestKey).map((item) => item.client);
  }, [allVisibleClients, deferredDay]);

  const orderedRouteStops = useMemo(() => nearestRouteClients
    .filter((client) => !client.isNote && (!!client.mapsLink || !!coordinatesFromClient(client.lat, client.lng)))
    .map((client): RouteMapStop => ({
      clientId: client.id,
      name: client.name || '',
      mapsLink: client.mapsLink || '',
      coordinates: coordinatesFromClient(client.lat, client.lng),
    })), [nearestRouteClients]);

  const orderedRouteStopsRef = useRef({ day: deferredDay, stops: orderedRouteStops });
  orderedRouteStopsRef.current = { day: deferredDay, stops: orderedRouteStops };

  // A guided route used to be a fixed snapshot created at start time. Keep
  // its pending portion aligned with live position/location changes instead.
  useEffect(() => {
    const session = routeSessionRef.current;
    if (!session || session.routeDay !== deferredDay) return;
    const reconciled = reconcileRouteSession(session, orderedRouteStops);
    if (reconciled !== session) updateRouteSession(reconciled);
  }, [deferredDay, orderedRouteStops, updateRouteSession]);

  const openRouteStop = useCallback(async (stop: RouteMapStop) => {
    const directionsUrl = stop.coordinates
      ? buildGoogleMapsDirectionsUrl(stop.coordinates)
      : null;
    const url = stop.mapsLink || directionsUrl;
    if (!url) {
      Alert.alert(t('home.routeOpenFailedTitle'), t('home.routeOpenFailedMsg'));
      return false;
    }
    try {
      await Linking.openURL(url);
      return true;
    } catch (e) {
      reportError(e, 'Error opening guided route stop');
      Alert.alert(t('home.routeOpenFailedTitle'), t('home.routeOpenFailedMsg'));
      return false;
    }
  }, [t]);

  const handleStartRoute = useCallback(async () => {
    if (orderedRouteStops.length === 0) {
      Alert.alert(t('home.routeNoClientsTitle'), t('home.routeNoClientsMsg'));
      return;
    }

    const session: RouteSession = { stops: orderedRouteStops, currentIndex: 0, routeDay: deferredDay };
    updateRouteSession(session);
    await openRouteStop(orderedRouteStops[0]);
  }, [deferredDay, orderedRouteStops, openRouteStop, t, updateRouteSession]);

  const advanceGuidedRoute = useCallback(async (completedClientId?: string) => {
    const storedSession = routeSessionRef.current;
    if (!storedSession) return;
    const current = storedSession.stops[storedSession.currentIndex];
    if (completedClientId && current.clientId !== completedClientId) return;

    const latestRoute = orderedRouteStopsRef.current;
    const session = latestRoute.day === storedSession.routeDay
      ? reconcileRouteSession(storedSession, latestRoute.stops)
      : storedSession;

    // The completed client can disappear from the live list before this
    // callback runs. In that case reconciliation has already selected the
    // next stop, so open it without advancing a second time.
    if (completedClientId && session.stops[session.currentIndex]?.clientId !== completedClientId) {
      updateRouteSession(session);
      await openRouteStop(session.stops[session.currentIndex]);
      return;
    }

    const nextIndex = session.currentIndex + 1;
    if (nextIndex >= session.stops.length) {
      updateRouteSession(null);
      Alert.alert(t('home.routeFinishedTitle'), t('home.routeFinishedMsg'));
      return;
    }

    const nextSession: RouteSession = { ...session, currentIndex: nextIndex };
    updateRouteSession(nextSession);
    await openRouteStop(nextSession.stops[nextIndex]);
  }, [openRouteStop, t, updateRouteSession]);

  // Flatten sections into a single array for FlatList
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
        });
      });
    });
    return items;
  }, [clientSections]);

  // Scroll to top on day change for instant feel
  useEffect(() => {
    resetHeaderScrollTracking();
    setCollapsibleHeaderVisible(true, false);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    });
  }, [deferredDay, resetHeaderScrollTracking, setCollapsibleHeaderVisible]);

  const handleMarkDone = useCallback(
    (client: Client) => {
      // Capture ALL fields markAsDone may modify, regardless of current
      // freq, so undo restores correctly even if freq changed concurrently.
      // parseDate: el undo reescribe estos valores en Firestore, que acepta
      // Date pero no el objeto Timestamp leído; null si el campo estaba vacío.
      const previousData: Record<string, any> = {
        isCompleted: client.isCompleted ?? false,
        completedAt: parseDate(client.completedAt),
        lastVisited: parseDate(client.lastVisited),
        lastDeliveredAt: parseDate(client.lastDeliveredAt),
        previousDeliveredAt: parseDate(client.previousDeliveredAt),
        doneFor: client.doneFor ?? '',
        specificDate: client.specificDate ?? '',
        alarm: client.alarm ?? '',
        isStarred: client.isStarred ?? false,
      };

      hapticLight();
      // Optimista a propósito (offline el promise queda pendiente y no debe
      // bloquear); si el servidor rechaza el write, avisar — el listener ya
      // habrá vuelto a mostrar el cliente.
      markAsDone(client.id, client, selectedDayRef.current).then((ok) => {
        if (!ok) {
          Alert.alert(t('error'), t('home.markDoneFailed'));
          return;
        }
        void advanceGuidedRoute(client.id);
      });
      // Las notas de una sola vez se borran definitivamente. Las recurrentes
      // avanzan al próximo ciclo y sí pueden deshacerse como cualquier agenda.
      if (!client.isNote || client.freq !== 'once') {
        pushUndo({
          client,
          previousData,
          sectionDay: selectedDayRef.current,
        });
      }
    },
    [advanceGuidedRoute, markAsDone, pushUndo, t],
  );

  const handleDelete = useCallback(
    (client: Client) => {
      Alert.alert(
        client.isNote ? t('noteModal.deleteTitle') : t('home.removeFromList'),
        client.isNote ? t('noteModal.deleteMessage') : t('home.removeFromListMsg'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: client.isNote ? t('noteModal.deleteAction') : t('home.remove'),
            style: client.isNote ? 'destructive' : 'default',
            onPress: () => deleteFromDay(client.id, selectedDayRef.current),
          },
        ],
      );
    },
    [deleteFromDay],
  );

  const handleUndoComplete = useCallback(
    (client: Client) => {
      undoComplete(client);
    },
    [undoComplete],
  );

  const handleToggleStar = useCallback(
    (client: Client) => {
      hapticSelection();
      toggleStar(client.id, client.isStarred);
    },
    [toggleStar],
  );

  const handleAlarm = useCallback(
    (client: Client) => {
      if (client.alarm) {
        // Active alarm: confirm removal. The new-alarm flow lives in AlarmPicker.
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
        setAlarmPromptClient(client);
      }
    },
    [saveAlarm, t],
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
  const quickActionsPendingCount = pendingTransferCount;

  const openAddClientFlow = useCallback(() => {
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
  }, [canAddClient, navigation, t]);

  const openFromQuickActions = useCallback((action: () => void) => {
    hapticSelection();
    setShowQuickActions(false);
    if (quickActionTimerRef.current) clearTimeout(quickActionTimerRef.current);
    // Let the native bottom sheet finish dismissing before presenting another modal.
    quickActionTimerRef.current = setTimeout(action, Platform.OS === 'ios' ? 220 : 0);
  }, []);

  // Map client ID to its global position among ALL clients for the day.
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
  const handleEditProductsCb = useCallback((client: Client) => setProductsClient(client), []);
  const handleEditNotesCb = useCallback((client: Client) => setNotesClient(client), []);

  const handleSaveNote = useCallback(
    (notes: string, date: string, freq: Exclude<Frequency, 'on_demand'>) => {
      if (editingClient?.isNote) {
        return updateNote(editingClient.id, notes, date, freq);
      }
      return addNote(notes, date, freq);
    },
    [addNote, editingClient?.id, editingClient?.isNote, updateNote],
  );

  const handleCloseNote = useCallback(() => {
    setShowNoteModal(false);
    setEditingClient((current) => current?.isNote ? null : current);
  }, []);
  const handleDebtCb = useCallback((client: Client) => setDebtClient(client), []);
  const handleRelationshipsCb = useCallback((client: Client) => setRelationshipClient(client), []);

  // Stable handler wrappers — read from a ref so renderListItem
  // doesn't have to depend on individual handler identities. Without this,
  // any change to addTransfer / saveAlarm / hasPendingTransfer (which the
  // handlers depend on) recreates handleTransfer/handleAlarm and triggers
  // a re-render of every visible card.
  const handlersRef = useRef({
    handleMarkDone,
    handleEditCb,
    handleEditProductsCb,
    handleEditNotesCb,
    handleDelete,
    handleDebtCb,
    handleToggleStar,
    handleTransfer,
    handleAlarm,
    handleRelationshipsCb,
    changePosition,
  });
  handlersRef.current = {
    handleMarkDone,
    handleEditCb,
    handleEditProductsCb,
    handleEditNotesCb,
    handleDelete,
    handleDebtCb,
    handleToggleStar,
    handleTransfer,
    handleAlarm,
    handleRelationshipsCb,
    changePosition,
  };

  const reorderContextRef = useRef({
    day: deferredDay,
    positions: globalPositionMap,
    clientCount: allVisibleClients.length,
  });
  reorderContextRef.current = {
    day: deferredDay,
    positions: globalPositionMap,
    clientCount: allVisibleClients.length,
  };

  const stableHandlers = useMemo(
    () => ({
      onMarkDone: (c: Client) => handlersRef.current.handleMarkDone(c),
      onEdit: (c: Client) => handlersRef.current.handleEditCb(c),
      onEditProducts: (c: Client) => handlersRef.current.handleEditProductsCb(c),
      onEditNotes: (c: Client) => handlersRef.current.handleEditNotesCb(c),
      onDelete: (c: Client) => handlersRef.current.handleDelete(c),
      onDebt: (c: Client) => handlersRef.current.handleDebtCb(c),
      onToggleStar: (c: Client) => handlersRef.current.handleToggleStar(c),
      onTransfer: (c: Client) => handlersRef.current.handleTransfer(c),
      onAlarm: (c: Client) => handlersRef.current.handleAlarm(c),
      onRelationships: (c: Client) => handlersRef.current.handleRelationshipsCb(c),
      onChangePosition: (id: string, pos: number, day: string) => {
        const context = reorderContextRef.current;
        if (!Number.isFinite(pos) || context.positions[id] === undefined) return;
        const boundedPosition = Math.max(1, Math.min(Math.trunc(pos), context.clientCount));
        const currentPosition = context.positions[id] + 1;
        if (
          context.clientCount === 0 ||
          day !== context.day ||
          currentPosition === boundedPosition ||
          reorderAnimationActiveRef.current
        ) return;

        // Animate the layout produced by the optimistic local reorder. The
        // short guard only prevents overlapping visual transitions; Firestore
        // persistence and rollback remain owned by changePosition.
        reorderAnimationActiveRef.current = true;
        LayoutAnimation.configureNext(reorderLayoutAnimation);
        void handlersRef.current.changePosition(id, boundedPosition, day);

        reorderAnimationTimerRef.current = setTimeout(() => {
          reorderAnimationActiveRef.current = false;
          reorderAnimationTimerRef.current = null;
        }, REORDER_ANIMATION_MS + 40);
      },
    }),
    [],
  );

  const renderListItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return (
          <SectionHeader
            title={item.title}
            count={item.count}
            isToday={item.isToday}
            colors={colors}
            fontScale={fontScale}
            isWide={isWide}
          />
        );
      }
      // gridrow items only appear in the wide-screen FlatList, never here.
      if (item.type !== 'client') return null;

      const client = item.client;
      const globalIndex = globalPositionMap[client.id] ?? 0;

      return (
        <ClientItem
          client={client}
          globalIndex={globalIndex}
          isAdmin={isAdmin}
          hasDebt={debtMap[client.id] ?? false}
          hasPendingTransfer={transferMap[client.id] ?? false}
          hasRelationships={relationshipMap[client.id] ?? false}
          enCaminoMessage={appSettings?.whatsappEnCamino}
          fontScale={fontScale}
          wideLayout={wideCard}
          selectedDay={deferredDay}
          onMarkDone={stableHandlers.onMarkDone}
          onEdit={stableHandlers.onEdit}
          onEditProducts={stableHandlers.onEditProducts}
          onEditNotes={stableHandlers.onEditNotes}
          onDelete={stableHandlers.onDelete}
          onDebt={stableHandlers.onDebt}
          onToggleStar={stableHandlers.onToggleStar}
          onTransfer={stableHandlers.onTransfer}
          onAlarm={stableHandlers.onAlarm}
          onRelationships={stableHandlers.onRelationships}
          onChangePosition={stableHandlers.onChangePosition}
        />
      );
    },
    [
      stableHandlers,
      colors,
      fontScale,
      isWide,
      wideCard,
      isAdmin,
      deferredDay,
      appSettings,
      globalPositionMap,
      debtMap,
      transferMap,
      relationshipMap,
    ],
  );

  // --- Wide-screen grid (Mac / iPad landscape) ---
  // On wide screens we lay the cards out in 2-3 columns to fill the width.
  // Reordering is done by tapping the position number on every screen size.
  //
  // Font scale tuned to the column width rather than the whole screen, so a
  // 2-column card isn't sized as if it owned the full window. A wide column
  // (~665px on a landscape iPad) scales up to 1.5x so the text fills the card
  // instead of looking tiny; a near-phone-width column floors at 1.15x.
  const gridFontScale = useMemo(() => {
    if (numColumns <= 1) return fontScale;
    const columnWidth = screenWidth / numColumns;
    return Math.min(1.5, Math.max(1.15, columnWidth / 400));
  }, [numColumns, screenWidth, fontScale]);

  // Section headers stay full-width; clients are chunked into rows of N.
  const gridData = useMemo<ListItem[]>(() => {
    if (numColumns <= 1) return [];
    const items: ListItem[] = [];
    clientSections.forEach((section) => {
      items.push({
        type: 'header',
        key: `header-${section.dateKey}`,
        title: section.title,
        count: section.data.length,
        isToday: section.isToday,
      });
      for (let i = 0; i < section.data.length; i += numColumns) {
        items.push({
          type: 'gridrow',
          key: `gridrow-${section.dateKey}-${i}`,
          clients: section.data.slice(i, i + numColumns),
          sectionDateKey: section.dateKey,
        });
      }
    });
    return items;
  }, [clientSections, numColumns]);

  const renderGridItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return (
          <View style={styles.gridHeaderWrap}>
            <SectionHeader
              title={item.title}
              count={item.count}
              isToday={item.isToday}
              colors={colors}
              fontScale={fontScale}
              isWide={isWide}
            />
          </View>
        );
      }
      if (item.type !== 'gridrow') return null;
      return (
        <View style={styles.gridRow}>
          {item.clients.map((client) => (
            <View key={client.id} style={styles.gridCell}>
              <ClientItem
                client={client}
                globalIndex={globalPositionMap[client.id] ?? 0}
                isAdmin={isAdmin}
                hasDebt={debtMap[client.id] ?? false}
                hasPendingTransfer={transferMap[client.id] ?? false}
                hasRelationships={relationshipMap[client.id] ?? false}
                enCaminoMessage={appSettings?.whatsappEnCamino}
                fontScale={gridFontScale}
                selectedDay={deferredDay}
                onMarkDone={stableHandlers.onMarkDone}
                onEdit={stableHandlers.onEdit}
                onEditProducts={stableHandlers.onEditProducts}
                onEditNotes={stableHandlers.onEditNotes}
                onDelete={stableHandlers.onDelete}
                onDebt={stableHandlers.onDebt}
                onToggleStar={stableHandlers.onToggleStar}
                onTransfer={stableHandlers.onTransfer}
                onAlarm={stableHandlers.onAlarm}
                onRelationships={stableHandlers.onRelationships}
                onChangePosition={stableHandlers.onChangePosition}
              />
            </View>
          ))}
          {item.clients.length < numColumns &&
            Array.from({ length: numColumns - item.clients.length }).map((_, i) => (
              <View key={`spacer-${i}`} style={styles.gridCell} />
            ))}
        </View>
      );
    },
    [
      colors,
      fontScale,
      isWide,
      gridFontScale,
      isAdmin,
      deferredDay,
      appSettings,
      globalPositionMap,
      debtMap,
      transferMap,
      relationshipMap,
      stableHandlers,
      numColumns,
      styles,
    ],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </View>
    );
  }

  // Shared between the phone and wide-screen FlatList layouts.
  const listEmptyComponent = (
    <View style={styles.emptyContainer}>
      <Text style={{ fontSize: 40, marginBottom: 8 }}>{searchTerm || activeFilters.size > 0 ? '🔍' : '📋'}</Text>
      <Text style={styles.emptyText}>
        {searchTerm || activeFilters.size > 0
          ? t('home.noSearchResults')
          : t('home.noClients', { day: selectedDay })}
      </Text>
      {searchTerm || activeFilters.size > 0 ? (
        <Text style={styles.emptySubtext}>{t('home.noSearchResultsSubtitle')}</Text>
      ) : (
        <Text style={styles.emptySubtext}>{t('home.noClientsSubtitle')}</Text>
      )}
    </View>
  );

  const listFooterComponent =
    completedClients.length > 0 ? (
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
                <Text style={styles.completedName}>{(client.name || '').toUpperCase()}</Text>
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
    ) : null;

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
      <Animated.View
        style={[
          styles.collapsibleTopHeader,
          collapsibleHeaderHeight > 0 && {
            height: collapsibleHeaderProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, collapsibleHeaderHeight],
            }),
            opacity: collapsibleHeaderProgress,
            transform: [{
              translateY: collapsibleHeaderProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [-Math.min(collapsibleHeaderHeight, 40), 0],
              }),
            }],
          },
        ]}
      >
        <View onLayout={handleCollapsibleHeaderLayout}>
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
          <ProductCounter clients={nearestDateClients} fontScale={fontScale} />

          {/* Quick actions — collapse with the calendar and load summary. */}
          <View style={styles.actionPanel}>
            <View style={styles.actionPanelContent}>
          {!isWide ? (
            <View style={styles.actionCompactStack}>
              <View style={styles.actionCompactRow}>
                <TouchableOpacity
                  style={[styles.actionCompactButton, styles.actionCompactAi]}
                  onPress={() => {
                    hapticSelection();
                    setShowSmartModal(true);
                  }}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.aiOrder')}
                >
                  <Ionicons name="sparkles" size={chromeSize(17)} color={colors.textWhite} />
                  <Text style={styles.actionCompactAiText} numberOfLines={1}>
                    {t('home.aiOrder')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionCompactButton, styles.actionCompactMore]}
                  onPress={() => {
                    hapticSelection();
                    setShowQuickActions(true);
                  }}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('home.quickActions')}${quickActionsPendingCount > 0 ? `: ${quickActionsPendingCount}` : ''}`}
                  accessibilityState={{ expanded: showQuickActions }}
                >
                  <Ionicons name="grid-outline" size={chromeSize(17)} color={colors.primary} />
                  <Text style={styles.actionCompactMoreText} numberOfLines={1}>
                    {t('home.quickActions')}
                  </Text>
                  {quickActionsPendingCount > 0 && (
                    <View style={styles.actionCompactBadge}>
                      <Text style={styles.actionCompactBadgeText}>
                        {quickActionsPendingCount > 99 ? '99+' : quickActionsPendingCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.actionCompactShortcutRow}>
                <TouchableOpacity
                  style={styles.actionCompactShortcut}
                  onPress={() => {
                    hapticSelection();
                    setShowNoteModal(true);
                  }}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.newNote')}
                >
                  <Ionicons name="document-text-outline" size={chromeSize(16)} color={colors.warningDarker} />
                  <Text style={styles.actionCompactShortcutText} numberOfLines={1}>
                    {t('home.note')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionCompactShortcut}
                  onPress={() => {
                    hapticSelection();
                    setShowCalendar(true);
                  }}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.calendar')}
                >
                  <Ionicons name="calendar-outline" size={chromeSize(16)} color={colors.primary} />
                  <Text style={styles.actionCompactShortcutText} numberOfLines={1}>
                    {t('home.calendar')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionCompactShortcut}
                  onPress={() => {
                    hapticSelection();
                    setShowDebtsSheet(true);
                  }}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('home.debts')}: ${debts.length}`}
                >
                  <Ionicons name="cash-outline" size={chromeSize(17)} color={colors.danger} />
                  <Text style={styles.actionCompactShortcutText} numberOfLines={1}>
                    {t('home.debts')}
                  </Text>
                  {debts.length > 0 && (
                    <View style={styles.actionCountBadge}>
                      <Text style={styles.actionCountBadgeText}>
                        {debts.length > 99 ? '99+' : debts.length}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
          <View style={styles.actionPrimaryRow}>
            <TouchableOpacity
              style={[styles.actionPrimaryButton, styles.actionPrimaryAi]}
              onPress={() => {
                hapticSelection();
                setShowSmartModal(true);
              }}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityLabel={t('home.aiOrder')}
            >
              <Ionicons name="sparkles" size={chromeSize(19)} color={colors.textWhite} />
              <Text style={styles.actionPrimaryText} numberOfLines={1}>
                {t('home.aiOrder')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionPrimaryButton, styles.actionPrimaryClient]}
              onPress={() => {
                hapticSelection();
                openAddClientFlow();
              }}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={t('home.newClient')}
            >
              <Ionicons name="person-add-outline" size={chromeSize(19)} color={colors.primary} />
              <Text style={styles.actionPrimaryClientText} numberOfLines={1}>
                {t('home.newClient')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionQuickRow}>
            <TouchableOpacity
              style={styles.actionQuickButton}
              onPress={() => {
                hapticSelection();
                setShowNoteModal(true);
              }}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={t('home.newNote')}
            >
              <View style={[styles.actionQuickIcon, styles.actionQuickIconNote]}>
                <Ionicons name="document-text-outline" size={chromeSize(18)} color={colors.warningDarker} />
              </View>
              <Text style={styles.actionQuickLabel} numberOfLines={1} adjustsFontSizeToFit>
                {t('home.note')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionQuickButton}
              onPress={() => {
                hapticSelection();
                setShowCalendar(true);
              }}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={t('home.calendar')}
            >
              <View style={[styles.actionQuickIcon, styles.actionQuickIconCalendar]}>
                <Ionicons name="calendar-outline" size={chromeSize(18)} color={colors.primary} />
              </View>
              <Text style={styles.actionQuickLabel} numberOfLines={1} adjustsFontSizeToFit>
                {t('home.calendar')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionQuickButton}
              onPress={() => {
                hapticSelection();
                setShowDebtsSheet(true);
              }}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={`${t('home.debts')}: ${debts.length}`}
            >
              <View style={[styles.actionQuickIcon, styles.actionQuickIconDebt]}>
                <Ionicons name="cash-outline" size={chromeSize(19)} color={colors.danger} />
              </View>
              <Text style={styles.actionQuickLabel} numberOfLines={1} adjustsFontSizeToFit>
                {t('home.debts')}
              </Text>
              {debts.length > 0 && (
                <View style={styles.actionCountBadge}>
                  <Text style={styles.actionCountBadgeText} numberOfLines={1}>
                    {debts.length > 99 ? '99+' : debts.length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionQuickButton}
              onPress={() => {
                hapticSelection();
                setShowTransfersSheet(true);
              }}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={`${t('home.transfers')}: ${pendingTransferCount}`}
            >
              <View style={[styles.actionQuickIcon, styles.actionQuickIconTransfer]}>
                <Ionicons name="swap-horizontal-outline" size={chromeSize(19)} color={colors.successText} />
              </View>
              <Text style={styles.actionQuickLabel} numberOfLines={1} adjustsFontSizeToFit>
                {t('home.transfers')}
              </Text>
              {pendingTransferCount > 0 && (
                <View style={styles.actionTransferCountBadge}>
                  <Text style={styles.actionCountBadgeText} numberOfLines={1}>
                    {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
            </>
          )}
            </View>
          </View>
        </View>
      </Animated.View>

      {routeSession && (
        <View style={styles.routeSessionBar}>
          <View style={styles.routeSessionInfo}>
            <Text style={styles.routeSessionTitle} numberOfLines={1}>
              {t('home.routeGuidedProgress', {
                current: routeSession.currentIndex + 1,
                total: routeSession.stops.length,
                name: routeSession.stops[routeSession.currentIndex].name,
              })}
            </Text>
            <Text style={styles.routeSessionHint} numberOfLines={1}>
              {t('home.routeGuidedHint')}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.routeSessionActions}>
            <TouchableOpacity
              style={styles.routeSessionButton}
              onPress={() => void openRouteStop(routeSession.stops[routeSession.currentIndex])}
            >
              <Text style={styles.routeSessionButtonText}>🗺️ {t('home.routeOpenCurrent')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.routeSessionButton} onPress={() => void advanceGuidedRoute()}>
              <Text style={styles.routeSessionButtonText}>{t('home.routeSkip')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.routeSessionButton, styles.routeSessionStopButton]}
              onPress={() => {
                Alert.alert(t('home.routeStopTitle'), t('home.routeStopMsg'), [
                  { text: t('cancel'), style: 'cancel' },
                  { text: t('home.routeStop'), style: 'destructive', onPress: () => updateRouteSession(null) },
                ]);
              }}
            >
              <Text style={[styles.routeSessionButtonText, styles.routeSessionStopText]}>{t('home.routeStop')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

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
            accessibilityRole="button"
            accessibilityLabel={t('home.filters')}
            accessibilityState={{ expanded: showFilters }}
          >
            <Text style={[styles.filterToggleText, showFilters && styles.filterToggleTextActive]}>
              {t('home.filters')}{activeFilters.size > 0 ? ` (${activeFilters.size})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        {showFilters && (
          <View style={styles.filtersPanel}>
            <View style={styles.filtersPanelHeader}>
              <View style={styles.filtersPanelTitleRow}>
                <Ionicons name="options-outline" size={chromeSize(18)} color={colors.primary} />
                <Text style={styles.filtersPanelTitle}>{t('home.filters')}</Text>
                {activeFilters.size > 0 && (
                  <View style={styles.filtersActiveBadge}>
                    <Text style={styles.filtersActiveBadgeText}>{activeFilters.size}</Text>
                  </View>
                )}
              </View>
            </View>
            <ScrollView
              style={styles.filtersScroll}
              contentContainerStyle={styles.filtersScrollContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.filterGroup}>
                <View style={styles.filterGroupHeader}>
                  <Ionicons name="person-outline" size={chromeSize(15)} color={colors.textHint} />
                  <Text style={styles.filterSectionTitle}>{t('home.filterType')}</Text>
                </View>
                <View style={styles.filterChipsRow}>
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilters.has('once_starred') && styles.filterChipActive]}
                    onPress={() => toggleFilter('once_starred')}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.filterOnceStarred')}
                    accessibilityState={{ selected: activeFilters.has('once_starred') }}
                  >
                    <Text style={[styles.filterChipText, activeFilters.has('once_starred') && styles.filterChipTextActive]}>
                      ⭐ {t('home.filterOnceStarred')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.filterChip, activeFilters.has('con_deuda') && styles.filterChipActive]}
                    onPress={() => toggleFilter('con_deuda')}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.filterWithDebt')}
                    accessibilityState={{ selected: activeFilters.has('con_deuda') }}
                  >
                    <Text style={[styles.filterChipText, activeFilters.has('con_deuda') && styles.filterChipTextActive]}>
                      💰 {t('home.filterWithDebt')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.filterGroup}>
                <View style={styles.filterGroupHeader}>
                  <Ionicons name="repeat-outline" size={chromeSize(15)} color={colors.textHint} />
                  <Text style={styles.filterSectionTitle}>{t('home.filterFrequency')}</Text>
                </View>
                <View style={styles.filterChipsRow}>
                  <TouchableOpacity
                    style={[styles.filterChip, !hasFreqFilter && styles.filterChipActive]}
                    onPress={clearFreqFilters}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.filterFreqAll')}
                    accessibilityState={{ selected: !hasFreqFilter }}
                  >
                    <Text style={[styles.filterChipText, !hasFreqFilter && styles.filterChipTextActive]}>
                      {t('home.filterFreqAll')}
                    </Text>
                  </TouchableOpacity>
                  {(['weekly', 'biweekly', 'triweekly', 'monthly', 'once'] as const).map((freq) => (
                    <TouchableOpacity
                      key={freq}
                      style={[styles.filterChip, activeFilters.has(`freq_${freq}`) && styles.filterChipActive]}
                      onPress={() => toggleFilter(`freq_${freq}`)}
                      accessibilityRole="button"
                      accessibilityLabel={t(`freq.${freq}`)}
                      accessibilityState={{ selected: activeFilters.has(`freq_${freq}`) }}
                    >
                      <Text style={[styles.filterChipText, activeFilters.has(`freq_${freq}`) && styles.filterChipTextActive]}>
                        📆 {t(`freq.${freq}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.filterGroup}>
                <View style={styles.filterGroupHeader}>
                  <Ionicons name="cube-outline" size={chromeSize(15)} color={colors.textHint} />
                  <Text style={styles.filterSectionTitle}>{t('home.filterProducts')}</Text>
                  <View style={styles.filterGroupCountBadge}>
                    <Text style={styles.filterGroupCountText}>{catalogProducts.length}</Text>
                  </View>
                </View>
                <View style={styles.filterChipsRow}>
                  {catalogProducts.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.filterChip, activeFilters.has(p.id) && styles.filterChipActive]}
                      onPress={() => toggleFilter(p.id)}
                      accessibilityRole="button"
                      accessibilityLabel={p.short}
                      accessibilityState={{ selected: activeFilters.has(p.id) }}
                    >
                      <ProductLabel
                        value={p.emoji}
                        label={p.short}
                        size={Math.round((isWide ? 15 : 14) * fontScale)}
                        style={[styles.filterChipText, activeFilters.has(p.id) && styles.filterChipTextActive]}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>
          </View>
        )}
      </View>
      {/* Client list — single-column on phones, multi-column grid on wide screens */}
      {numColumns > 1 ? (
        <FlatList
          ref={scrollRef}
          data={gridData}
          extraData={`${debts.length}-${transfers.length}-${numColumns}`}
          keyExtractor={keyExtractor}
          renderItem={renderGridItem}
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          onScroll={handleClientListScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => showFilters && setShowFilters(false)}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={11}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={listEmptyComponent}
          ListFooterComponent={listFooterComponent}
        />
      ) : (
      <FlatList
        ref={scrollRef}
        data={flatListData}
        extraData={`${debts.length}-${transfers.length}`}
        keyExtractor={keyExtractor}
        renderItem={renderListItem}
        onScroll={handleClientListScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => showFilters && setShowFilters(false)}
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={11}
        updateCellsBatchingPeriod={30}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={listEmptyComponent}
        ListFooterComponent={listFooterComponent}
      />
      )}
      </View>

      <ModalOverlay
        visible={showQuickActions && !isWide}
        onClose={() => setShowQuickActions(false)}
        animationType="slide"
      >
        <View style={styles.quickActionsOverlay}>
          <TouchableOpacity
            style={styles.quickActionsBackdrop}
            activeOpacity={1}
            onPress={() => setShowQuickActions(false)}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
          />
          <View style={styles.quickActionsSheet}>
            <TouchableOpacity
              style={styles.quickActionsHandleButton}
              onPress={() => setShowQuickActions(false)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
            >
              <View style={styles.quickActionsHandle} />
            </TouchableOpacity>

            <View style={styles.quickActionsHeader}>
              <View style={styles.quickActionsTitleRow}>
                <View style={styles.quickActionsHeaderIcon}>
                  <Ionicons name="grid-outline" size={chromeSize(18)} color={colors.primary} />
                </View>
                <View style={styles.quickActionsHeaderCopy}>
                  <Text style={styles.quickActionsTitle}>{t('home.quickActionsTitle')}</Text>
                  <Text style={styles.quickActionsSubtitle}>{t('home.quickActionsHint')}</Text>
                </View>
              </View>
            </View>

            <View style={styles.quickActionsGrid}>
              <TouchableOpacity
                style={[styles.quickActionSheetButton, styles.quickActionSheetButtonWide]}
                onPress={() => openFromQuickActions(openAddClientFlow)}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityLabel={t('home.newClient')}
              >
                <View style={[styles.quickActionSheetIcon, styles.actionQuickIconClient]}>
                  <Ionicons name="person-add-outline" size={chromeSize(20)} color={colors.primary} />
                </View>
                <Text style={styles.quickActionSheetLabel} numberOfLines={1}>
                  {t('home.newClient')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickActionSheetButton, styles.quickActionSheetButtonWide]}
                onPress={() => openFromQuickActions(() => setShowTransfersSheet(true))}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityLabel={`${t('home.transfers')}: ${pendingTransferCount}`}
              >
                <View style={[styles.quickActionSheetIcon, styles.quickActionSheetTransferIcon]}>
                  <Ionicons name="swap-horizontal-outline" size={chromeSize(21)} color={colors.successText} />
                </View>
                <Text style={styles.quickActionSheetLabel} numberOfLines={1}>
                  {t('home.transfers')}
                </Text>
                {pendingTransferCount > 0 && (
                  <View style={[styles.quickActionSheetBadge, styles.quickActionSheetTransferBadge]}>
                    <Text style={styles.quickActionSheetBadgeText}>
                      {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ModalOverlay>

      <UndoBanner queue={undoQueue} selectedDay={selectedDay} onUndo={handleUndoMarkDone} />

      {/* Focused order-detail editors opened directly from each card. */}
      <ClientProductsModal
        visible={!!productsClient}
        client={productsClient}
        onSave={updateClient}
        onClose={() => setProductsClient(null)}
      />

      <ClientNotesModal
        visible={!!notesClient}
        client={notesClient}
        onSave={updateClient}
        onClose={() => setNotesClient(null)}
      />

      {/* Edit Client Modal */}
      <EditClientModal
        visible={!!editingClient && !editingClient.isNote}
        client={editingClient?.isNote ? null : editingClient}
        allClients={clients}
        onSave={updateClient}
        onClose={() => setEditingClient(null)}
        onRemoveFromDay={handleDelete}
        scheduledDay={deferredDay}
        showClientInfo
        hideOrderDetails
      />

      {/* Debt Modal */}
      <DebtModal
        visible={!!debtClient}
        client={debtClient}
        debts={debts}
        allClients={clients}
        debtTemplate={appSettings?.whatsappDeuda}
        reminderTemplate={appSettings?.whatsappRecordatorio}
        onClose={() => setDebtClient(null)}
        onAddDebt={addDebt}
        onMarkPaid={markDebtPaid}
        onMarkAllPaid={markAllDebtsPaid}
        onEditDebt={editDebt}
      />

      {/* Note Modal */}
      <NoteModal
        visible={showNoteModal || !!editingClient?.isNote}
        note={editingClient?.isNote ? editingClient : null}
        onSave={handleSaveNote}
        onClose={handleCloseNote}
      />

      {/* Add Client Modal */}
      <AddClientModal
        visible={showAddClientModal}
        day={selectedDay}
        onSave={addClient}
        onClose={() => setShowAddClientModal(false)}
      />

      {/* Smart Order Modal (IA) */}
      <SmartOrderModal
        visible={showSmartModal}
        onClose={() => setShowSmartModal(false)}
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
        reminderTemplate={appSettings?.whatsappRecordatorio}
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

      <AlarmPicker
        client={alarmPromptClient}
        selectedDay={selectedDay}
        onClose={() => setAlarmPromptClient(null)}
      />

      {/* Profiles / Repartos switcher rápido (abierto desde el chip del header) */}
      <ProfilesModal
        mode="quick"
        visible={profileSwitcherVisible}
        onClose={() => setProfileSwitcherVisible(false)}
      />

      {/* Calendario (solo vista del mes) */}
      <CalendarModal
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
      />
    </View>
  );
};

const getStyles = (
  colors: ThemeColors,
  scale: number = 1,
  isWide: boolean = false,
  extraWideHeader: boolean = false,
) => {
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
  collapsibleTopHeader: {
    flexShrink: 0,
    overflow: 'hidden',
  },
  loadingText: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: s(16),
  },
  actionPanel: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    paddingHorizontal: s(12),
    paddingTop: s(8),
    paddingBottom: s(9),
  },
  actionPanelContent: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: extraWideHeader ? 'row' : 'column',
    alignItems: 'stretch',
    gap: s(8),
  },
  actionCompactRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: s(8),
  },
  actionCompactStack: {
    gap: s(7),
  },
  actionCompactButton: {
    minHeight: s(46),
    borderRadius: s(12),
    borderWidth: 1,
    paddingHorizontal: s(9),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
  },
  actionCompactRoute: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.successDark,
    borderColor: colors.success,
  },
  actionCompactPrimaryText: {
    flexShrink: 1,
    fontSize: s(14),
    fontWeight: '800',
    color: colors.textWhite,
  },
  actionCompactAi: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  actionCompactAiText: {
    fontSize: s(13),
    fontWeight: '800',
    color: colors.textWhite,
  },
  actionCompactMore: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLight,
  },
  actionCompactMoreText: {
    flexShrink: 1,
    fontSize: s(13),
    fontWeight: '800',
    color: colors.primary,
  },
  actionCompactShortcutRow: {
    flexDirection: 'row',
    gap: s(6),
  },
  actionCompactShortcut: {
    flex: 1,
    minWidth: 0,
    minHeight: s(38),
    borderRadius: s(10),
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(7),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(5),
  },
  actionCompactShortcutText: {
    flexShrink: 1,
    fontSize: s(11),
    fontWeight: '700',
    color: colors.textSecondary,
  },
  actionCompactBadge: {
    position: 'absolute',
    top: s(-5),
    right: s(-4),
    minWidth: s(19),
    height: s(19),
    borderRadius: s(10),
    paddingHorizontal: s(4),
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCompactBadgeText: {
    fontSize: s(9),
    lineHeight: s(11),
    fontWeight: '900',
    color: colors.textWhite,
  },
  actionPrimaryRow: {
    flex: extraWideHeader ? 1.15 : undefined,
    flexDirection: 'row',
    gap: s(8),
  },
  actionPrimaryButton: {
    flex: 1,
    minWidth: 0,
    minHeight: isWide ? s(48) : s(44),
    borderRadius: s(12),
    borderWidth: 1,
    paddingHorizontal: s(10),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(7),
  },
  actionPrimaryRoute: {
    backgroundColor: colors.successDark,
    borderColor: colors.success,
  },
  actionPrimaryAi: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  actionPrimaryClient: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLight,
  },
  actionPrimaryText: {
    flexShrink: 1,
    fontSize: isWide ? s(15) : s(14),
    fontWeight: '800',
    color: colors.textWhite,
    letterSpacing: 0.1,
  },
  actionPrimaryClientText: {
    flexShrink: 1,
    fontSize: isWide ? s(15) : s(14),
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.1,
  },
  actionQuickRow: {
    flex: extraWideHeader ? 1 : undefined,
    flexDirection: 'row',
    gap: s(7),
  },
  actionQuickButton: {
    flex: 1,
    minWidth: 0,
    minHeight: isWide ? s(52) : s(55),
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: s(11),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(3),
    paddingVertical: s(5),
    gap: s(3),
  },
  actionQuickIcon: {
    width: isWide ? s(26) : s(27),
    height: isWide ? s(26) : s(27),
    borderRadius: s(9),
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionQuickIconClient: {
    backgroundColor: colors.primaryLight,
  },
  actionQuickIconNote: {
    backgroundColor: colors.warningAmberBg,
  },
  actionQuickIconCalendar: {
    backgroundColor: colors.primaryLighter,
  },
  actionQuickIconDebt: {
    backgroundColor: colors.dangerLight,
  },
  actionQuickIconTransfer: {
    backgroundColor: colors.successLighter,
  },
  actionQuickLabel: {
    width: '100%',
    textAlign: 'center',
    fontSize: isWide ? s(13) : s(11),
    lineHeight: isWide ? s(16) : s(13),
    fontWeight: '700',
    color: colors.textSecondary,
  },
  actionCountBadge: {
    position: 'absolute',
    top: s(4),
    right: s(5),
    minWidth: s(18),
    height: s(18),
    borderRadius: s(9),
    paddingHorizontal: s(4),
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.card,
  },
  actionCountBadgeText: {
    fontSize: s(10),
    lineHeight: s(12),
    fontWeight: '800',
    color: colors.textWhite,
  },
  actionTransferCountBadge: {
    position: 'absolute',
    top: s(4),
    right: s(5),
    minWidth: s(18),
    height: s(18),
    borderRadius: s(9),
    paddingHorizontal: s(4),
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.card,
  },
  actionTransferNotice: {
    flex: extraWideHeader ? 0.58 : undefined,
    minWidth: extraWideHeader ? s(180) : undefined,
    minHeight: s(34),
    backgroundColor: colors.successLighter,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: s(10),
    paddingHorizontal: s(10),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionTransferInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  actionTransferText: {
    fontSize: s(13),
    fontWeight: '700',
    color: colors.successText,
  },
  actionTransferBadge: {
    minWidth: s(22),
    height: s(22),
    borderRadius: s(11),
    paddingHorizontal: s(5),
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTransferBadgeText: {
    fontSize: s(11),
    fontWeight: '800',
    color: colors.textWhite,
  },
  quickActionsOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  quickActionsBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  quickActionsSheet: {
    width: '100%',
    backgroundColor: colors.card,
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.cardBorder,
    paddingHorizontal: s(16),
    paddingTop: s(7),
    paddingBottom: Platform.OS === 'ios' ? s(28) : s(18),
  },
  quickActionsHandleButton: {
    alignSelf: 'center',
    width: s(68),
    height: s(24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionsHandle: {
    width: s(38),
    height: s(4),
    borderRadius: s(2),
    backgroundColor: colors.cardBorder,
  },
  quickActionsHeader: {
    paddingBottom: s(13),
    marginBottom: s(10),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  quickActionsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  quickActionsHeaderIcon: {
    width: s(38),
    height: s(38),
    borderRadius: s(12),
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionsHeaderCopy: {
    flex: 1,
    gap: s(2),
  },
  quickActionsTitle: {
    fontSize: s(18),
    fontWeight: '900',
    color: colors.textPrimary,
  },
  quickActionsSubtitle: {
    fontSize: s(12),
    color: colors.textMuted,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(9),
  },
  quickActionSheetButton: {
    width: '48.5%',
    minHeight: s(66),
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(9),
    paddingHorizontal: s(10),
    paddingVertical: s(10),
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: s(14),
  },
  quickActionSheetButtonWide: {
    width: '100%',
  },
  quickActionSheetIcon: {
    width: s(38),
    height: s(38),
    borderRadius: s(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionSheetTransferIcon: {
    backgroundColor: colors.successLighter,
  },
  quickActionSheetLabel: {
    flex: 1,
    fontSize: s(13),
    fontWeight: '800',
    color: colors.textSecondary,
  },
  quickActionSheetBadge: {
    minWidth: s(22),
    height: s(22),
    borderRadius: s(11),
    paddingHorizontal: s(5),
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionSheetTransferBadge: {
    backgroundColor: colors.success,
  },
  quickActionSheetBadgeText: {
    fontSize: s(10),
    fontWeight: '900',
    color: colors.textWhite,
  },
  routeSessionBar: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    backgroundColor: colors.successLighter,
    borderBottomWidth: 1,
    borderBottomColor: colors.successLight,
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    gap: s(8),
  },
  routeSessionInfo: {
    gap: s(2),
  },
  routeSessionTitle: {
    color: colors.successDark,
    fontSize: s(15),
    fontWeight: '800',
  },
  routeSessionHint: {
    color: colors.textMuted,
    fontSize: s(12),
  },
  routeSessionActions: {
    gap: s(6),
  },
  routeSessionButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.successLight,
    borderRadius: s(8),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
  },
  routeSessionButtonText: {
    color: colors.successDark,
    fontSize: s(12),
    fontWeight: '700',
  },
  routeSessionStopButton: {
    borderColor: colors.dangerBorder,
  },
  routeSessionStopText: {
    color: colors.danger,
  },
  searchSection: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchRow: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: s(8),
    alignItems: 'center',
  },
  searchInputWrapper: {
    flex: 1,
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
  filterToggleBtn: {
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(12),
    paddingVertical: isWide ? s(10) : s(8),
    borderRadius: s(10),
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterToggleBtnActive: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primary,
  },
  filterToggleText: {
    fontSize: isWide ? s(15) : s(14),
    fontWeight: '700',
    color: colors.textSecondary,
  },
  filterToggleTextActive: {
    color: colors.primary,
  },
  filtersPanel: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    marginTop: s(10),
    maxHeight: isWide ? s(460) : s(320),
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: s(14),
    padding: s(10),
    overflow: 'hidden',
  },
  filtersPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: s(8),
    marginBottom: s(8),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  filtersPanelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(7),
  },
  filtersPanelTitle: {
    fontSize: isWide ? s(17) : s(16),
    fontWeight: '800',
    color: colors.textPrimary,
  },
  filtersActiveBadge: {
    minWidth: s(22),
    height: s(22),
    borderRadius: s(11),
    paddingHorizontal: s(6),
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersActiveBadgeText: {
    fontSize: s(12),
    fontWeight: '800',
    color: colors.textWhite,
  },
  filtersScroll: {
    flexShrink: 1,
  },
  filtersScrollContent: {
    gap: s(8),
    paddingBottom: s(2),
  },
  filterGroup: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: s(12),
    padding: s(10),
  },
  filterGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginBottom: s(8),
  },
  filterSectionTitle: {
    fontSize: isWide ? s(14) : s(13),
    fontWeight: '800',
    color: colors.textHint,
  },
  filterGroupCountBadge: {
    minWidth: s(20),
    height: s(20),
    paddingHorizontal: s(5),
    borderRadius: s(10),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sectionBackground,
  },
  filterGroupCountText: {
    fontSize: s(11),
    fontWeight: '800',
    color: colors.textMuted,
  },
  filterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
  },
  filterChip: {
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(12),
    paddingVertical: isWide ? s(8) : s(6),
    borderRadius: s(20),
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  filterChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: isWide ? s(15) : s(14),
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.primaryText,
  },
  listContent: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH + 24,
    alignSelf: 'center',
    padding: 12,
    paddingBottom: 100,
  },
  // The 2-column block is capped and centered as a whole so on very wide
  // screens (Mac) the columns stay together (normal gap) and the extra space
  // goes to the outer margins — instead of each card centering in its own
  // half and leaving a big empty gutter down the middle.
  gridRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    width: '100%',
    maxWidth: 1600,
    alignSelf: 'center',
  },
  gridCell: {
    flex: 1,
  },
  gridHeaderWrap: {
    width: '100%',
    maxWidth: 1600,
    alignSelf: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(8),
    paddingHorizontal: s(4),
    marginTop: s(6),
    marginBottom: s(6),
    borderBottomWidth: 2,
    borderBottomColor: colors.cardBorder,
  },
  sectionHeaderToday: {
    borderBottomColor: colors.primary,
  },
  sectionHeaderText: {
    fontSize: isWide ? s(19) : s(16),
    fontWeight: '700',
    color: colors.textMuted,
  },
  sectionHeaderTextToday: {
    color: colors.primary,
  },
  sectionHeaderCount: {
    fontSize: isWide ? s(15) : s(14),
    fontWeight: '700',
    color: colors.textHint,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(8),
    paddingVertical: s(2),
    borderRadius: s(10),
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
  emptySubtext: {
    fontSize: s(14),
    color: colors.textHint,
    marginTop: 6,
    opacity: 0.7,
  },
  completedSection: {
    borderTopWidth: 2,
    borderTopColor: colors.cardBorder,
    borderStyle: 'dashed',
    marginTop: s(12),
    paddingTop: s(4),
  },
  completedHeader: {
    padding: s(12),
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
    borderRadius: s(10),
    padding: s(12),
    marginBottom: s(6),
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
    borderRadius: s(10),
    padding: s(12),
    marginTop: s(8),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  deleteAllBtnText: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.danger,
  },
});
};

export default HomeScreen;
