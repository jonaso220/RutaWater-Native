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
  // Chrome (day tabs, product counter, action bar, search) scales with the
  // global fontScale, which now ramps up on wide screens (see useLayout).
  const styles = useMemo(() => getStyles(colors, fontScale, isWide), [colors, fontScale, isWide]);

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
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showTransfersSheet, setShowTransfersSheet] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showSmartModal, setShowSmartModal] = useState(false);
  const [showDebtsSheet, setShowDebtsSheet] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
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
    setRefreshing(true);
    hapticSelection();
    try {
      // Perfil activo primero; si todavía no cargó, caer al grupo familiar
      // (comportamiento previo) y por último al usuario solo.
      const scopeGroupId = activeScopeGroupId || groupData?.groupId;
      const scopeField = scopeGroupId ? 'groupId' : 'userId';
      const scopeValue = scopeGroupId || user.uid;
      await db
        .collection('clients')
        .where(scopeField, '==', scopeValue)
        .get({ source: 'server' });
    } catch (e) {
      reportError(e, 'Refresh error');
    } finally {
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
      // Las notas se BORRAN al marcarlas listas — no hay doc que restaurar,
      // así que ofrecer "deshacer" sería mentirle al usuario (el update
      // fallaría en silencio).
      if (!client.isNote) {
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
    handleDelete,
    handleDebtCb,
    handleToggleStar,
    handleTransfer,
    handleAlarm,
    handleRelationshipsCb,
    changePosition,
  };

  const stableHandlers = useMemo(
    () => ({
      onMarkDone: (c: Client) => handlersRef.current.handleMarkDone(c),
      onEdit: (c: Client) => handlersRef.current.handleEditCb(c),
      onDelete: (c: Client) => handlersRef.current.handleDelete(c),
      onDebt: (c: Client) => handlersRef.current.handleDebtCb(c),
      onToggleStar: (c: Client) => handlersRef.current.handleToggleStar(c),
      onTransfer: (c: Client) => handlersRef.current.handleTransfer(c),
      onAlarm: (c: Client) => handlersRef.current.handleAlarm(c),
      onRelationships: (c: Client) => handlersRef.current.handleRelationshipsCb(c),
      onChangePosition: (id: string, pos: number, day: string) =>
        handlersRef.current.changePosition(id, pos, day),
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
          selectedDay={selectedDay}
          onMarkDone={stableHandlers.onMarkDone}
          onEdit={stableHandlers.onEdit}
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
      selectedDay,
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
                selectedDay={selectedDay}
                onMarkDone={stableHandlers.onMarkDone}
                onEdit={stableHandlers.onEdit}
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
      selectedDay,
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
        </View>
      </Animated.View>

      {/* Action bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.actionBar}
        contentContainerStyle={styles.actionBarContent}
      >
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnRoute]}
          onPress={() => void handleStartRoute()}
          accessibilityLabel={t('home.startRoute')}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnRouteText]}>🧭 {t('home.startRoute')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnAi]}
          onPress={() => setShowSmartModal(true)}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnAiText]}>✨ Pedido IA</Text>
        </TouchableOpacity>
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
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnCalendar]}
          onPress={() => setShowCalendar(true)}
          accessibilityLabel={t('home.calendar')}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnCalendarText]}>📅 {t('home.calendar')}</Text>
        </TouchableOpacity>
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
            <Text style={[styles.filterSectionTitle, { marginTop: 10 }]}>{t('home.filterFrequency')}</Text>
            <View style={styles.filterChipsRow}>
              <TouchableOpacity
                style={[styles.filterChip, !hasFreqFilter && styles.filterChipActive]}
                onPress={clearFreqFilters}
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
                >
                  <Text style={[styles.filterChipText, activeFilters.has(`freq_${freq}`) && styles.filterChipTextActive]}>
                    📆 {t(`freq.${freq}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.filterSectionTitle, { marginTop: 10 }]}>{t('home.filterProducts')}</Text>
            <View style={styles.filterChipsRow}>
              {catalogProducts.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.filterChip, activeFilters.has(p.id) && styles.filterChipActive]}
                  onPress={() => toggleFilter(p.id)}
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

      <UndoBanner queue={undoQueue} selectedDay={selectedDay} onUndo={handleUndoMarkDone} />

      {/* Edit Client Modal */}
      <EditClientModal
        visible={!!editingClient}
        client={editingClient}
        allClients={clients}
        onSave={updateClient}
        onClose={() => setEditingClient(null)}
        onRemoveFromDay={handleDelete}
        scheduledDay={deferredDay}
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
        visible={showNoteModal}
        onSave={addNote}
        onClose={() => setShowNoteModal(false)}
      />

      {/* Add Client Modal */}
      <AddClientModal
        visible={showAddClientModal}
        day={selectedDay}
        onSave={addClient}
        onClose={() => setShowAddClientModal(false)}
      />

      {/* Smart Order Modal (Claude) */}
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

const getStyles = (colors: ThemeColors, scale: number = 1, isWide: boolean = false) => {
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
  actionBar: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  actionBarContent: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    gap: s(8),
    alignItems: 'center',
  },
  actionBtn: {
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(12),
    paddingVertical: isWide ? s(8) : s(6),
    borderRadius: s(8),
  },
  actionBtnText: {
    // Slightly larger on wide screens so the action buttons don't look small.
    fontSize: isWide ? s(15) : s(14),
    fontWeight: '700',
    color: colors.textSecondary,
  },
  actionBtnRoute: {
    backgroundColor: colors.successDark,
    borderWidth: 1,
    borderColor: colors.success,
  },
  actionBtnRouteText: {
    color: colors.textWhite,
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
  actionBtnCalendar: {
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  actionBtnCalendarText: {
    color: colors.textSecondary,
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
  actionBtnAi: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionBtnAiText: {
    color: colors.textWhite,
  },
  routeSessionBar: {
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
    marginTop: s(10),
    paddingTop: s(10),
    borderTopWidth: 1,
    borderTopColor: colors.sectionBackground,
  },
  filterSectionTitle: {
    fontSize: isWide ? s(14) : s(13),
    fontWeight: '700',
    color: colors.textHint,
    marginBottom: s(6),
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
    borderColor: 'transparent',
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
