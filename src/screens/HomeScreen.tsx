import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useDeferredValue, useTransition } from 'react';
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
  Animated,
  Easing,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  LayoutAnimation,
  UIManager,
  AppState,
} from 'react-native';
import { useScrollToTop, useFocusEffect } from '@react-navigation/native';
import { Client } from '../types';
import { createVisitCommand } from '../utils/visitCompletion';
import { useProducts } from '../stores/productCatalogStore';
import { getTodayDayName, fuzzyMatch, getNextVisitDate, toLocalDateString, settingsDocId } from '../utils/helpers';
import {
  ScopedWhatsAppTemplates,
  normalizeWhatsAppTemplates,
  templatesForScope,
} from '../utils/whatsAppTemplates';
import { millisecondsUntilNextLocalDay, nextLocalDateKey } from '../utils/localDayClock';
import { hapticLight, hapticSelection } from '../utils/haptics';
import { db } from '../config/firebase';
import { dataScopeQuery } from '../utils/dataScope';
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
import { getClientPhoneSearchText } from '../utils/clientPhones';

type ListItem =
  | { type: 'header'; key: string; title: string; count: number; isToday: boolean }
  | { type: 'client'; key: string; client: Client; sectionDateKey: string }
  | { type: 'gridrow'; key: string; clients: Client[]; sectionDateKey: string };

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
const HEADER_HIDE_ANIMATION_MS = 240;
const HEADER_SHOW_ANIMATION_MS = 280;
const HEADER_HIDE_SCROLL_DISTANCE = 48;
const HEADER_SHOW_SCROLL_DISTANCE = 28;
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
  tomorrowVisitMessage?: string;
  isTomorrowVisit: boolean;
  fontScale?: number;
  wideLayout?: boolean;
  selectedDay: string;
  onMarkDone: (client: Client, forDay?: string) => void;
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
  tomorrowVisitMessage,
  isTomorrowVisit,
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
  const handleMarkDone = useCallback(() => onMarkDone(client, selectedDay), [onMarkDone, client, selectedDay]);
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
      tomorrowVisitMessage={tomorrowVisitMessage}
      isTomorrowVisit={isTomorrowVisit}
      fontScale={fontScale}
      wideLayout={wideLayout}
    />
  );
});

const HomeScreen = () => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { fontScale, isWide, isPhoneLandscape, width: screenWidth, height: screenHeight } = useLayout();
  // Always a single column. On wide screens (Mac/iPad) the card itself switches
  // to a horizontal layout (info on the left, action buttons on the right) so it
  // uses the extra width instead of tiling into 2 narrower columns.
  const numColumns = 1;
  // Gate the card's horizontal (wide) layout: only on genuinely large screens.
  const wideCard = screenWidth >= 900 || (isPhoneLandscape && screenWidth >= 740);
  // Chrome (day tabs, product counter, action bar, search) scales with the
  // global fontScale, which now ramps up on wide screens (see useLayout).
  const styles = useMemo(
    () => getStyles(colors, fontScale, isWide, isPhoneLandscape),
    [colors, fontScale, isWide, isPhoneLandscape],
  );
  const chromeSize = (value: number) => Math.round(value * fontScale);

  const navigation = useNavigation<any>();
  const { isAdmin, user, groupData, scopeReadVersion } = useAuthContext();
  const catalogProducts = useProducts();
  const profileSwitcherVisible = useProfileStore((s) => s.switcherVisible);
  const setProfileSwitcherVisible = useProfileStore((s) => s.setSwitcherVisible);
  const clients = useClientsStore((s) => s.clients);
  const loading = useClientsStore((s) => s.loading);
  const hasLoadedClientsRef = useRef(!loading);
  if (!loading) hasLoadedClientsRef.current = true;
  const isInitialClientsLoading = loading && !hasLoadedClientsRef.current;
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
  const [localTodayKey, setLocalTodayKey] = useState(() => toLocalDateString(new Date()));
  const tomorrowDateKey = useMemo(() => nextLocalDateKey(localTodayKey), [localTodayKey]);
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
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [relationshipClient, setRelationshipClient] = useState<Client | null>(null);
  const [alarmPromptClient, setAlarmPromptClient] = useState<Client | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const collapsibleHeaderProgress = useRef(new Animated.Value(1)).current;
  const androidHeaderScrollY = useRef(new Animated.Value(0)).current;
  const collapsibleHeaderVisibleRef = useRef(true);
  const lastListOffsetRef = useRef(0);
  const lastScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const scrollDirectionDistanceRef = useRef(0);
  const headerLayoutKey = `${screenWidth}:${screenHeight}:${fontScale}`;
  const [headerMeasurement, setHeaderMeasurement] = useState({ key: headerLayoutKey, height: 0 });
  const collapsibleHeaderHeight = headerMeasurement.key === headerLayoutKey ? headerMeasurement.height : 0;
  const [stickyControlsHeight, setStickyControlsHeight] = useState(0);
  const headerAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const reorderAnimationActiveRef = useRef(false);
  const reorderAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
    return () => {
      headerAnimationRef.current?.stop();
      if (reorderAnimationTimerRef.current) clearTimeout(reorderAnimationTimerRef.current);
    };
  }, []);

  const setCollapsibleHeaderVisible = useCallback((visible: boolean, animate = true) => {
    if (collapsibleHeaderVisibleRef.current === visible) {
      if (!animate) collapsibleHeaderProgress.setValue(visible ? 1 : 0);
      return;
    }

    collapsibleHeaderVisibleRef.current = visible;
    headerAnimationRef.current?.stop();
    headerAnimationRef.current = null;
    collapsibleHeaderProgress.stopAnimation();

    const duration = visible ? HEADER_SHOW_ANIMATION_MS : HEADER_HIDE_ANIMATION_MS;
    if (!animate) {
      collapsibleHeaderProgress.setValue(visible ? 1 : 0);
      return;
    }

    const animation = Animated.timing(collapsibleHeaderProgress, {
      toValue: visible ? 1 : 0,
      duration,
      easing: Easing.bezier(0.2, 0, 0, 1),
      // Only drives a translateY, so the list never relayouts mid-scroll.
      useNativeDriver: true,
      isInteraction: false,
    });
    headerAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (headerAnimationRef.current !== animation) return;
      headerAnimationRef.current = null;
      if (finished) collapsibleHeaderProgress.setValue(visible ? 1 : 0);
    });
  }, [collapsibleHeaderProgress]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // iOS can pause the header animation while the app backgrounds.
      // Restore its intended endpoint before the screen becomes interactive so
      // the header can never remain permanently half-open.
      setCollapsibleHeaderVisible(collapsibleHeaderVisibleRef.current, false);
    });
    return () => subscription.remove();
  }, [setCollapsibleHeaderVisible]);

  const resetHeaderScrollTracking = useCallback(() => {
    lastListOffsetRef.current = 0;
    lastScrollDirectionRef.current = 0;
    scrollDirectionDistanceRef.current = 0;
  }, []);

  useLayoutEffect(() => {
    // A rotation can interrupt a collapse animation and changes the header's
    // natural height. Reopen it while the new layout is measured independently.
    headerAnimationRef.current?.stop();
    headerAnimationRef.current = null;
    collapsibleHeaderProgress.stopAnimation();
    setCollapsibleHeaderVisible(true, false);
    androidHeaderScrollY.setValue(0);
    resetHeaderScrollTracking();
  }, [headerLayoutKey, collapsibleHeaderProgress, androidHeaderScrollY, setCollapsibleHeaderVisible, resetHeaderScrollTracking]);

  const requestCollapsibleHeaderVisible = useCallback((visible: boolean) => {
    setCollapsibleHeaderVisible(visible);
  }, [setCollapsibleHeaderVisible]);

  const handleClientListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = offset - lastListOffsetRef.current;
    lastListOffsetRef.current = offset;

    if (offset <= 8) {
      lastScrollDirectionRef.current = 0;
      scrollDirectionDistanceRef.current = 0;
      requestCollapsibleHeaderVisible(true);
      return;
    }
    if (Math.abs(delta) < 1) return;

    const direction: -1 | 1 = delta > 0 ? 1 : -1;
    if (lastScrollDirectionRef.current !== direction) {
      lastScrollDirectionRef.current = direction;
      scrollDirectionDistanceRef.current = 0;
    }
    scrollDirectionDistanceRef.current += Math.abs(delta);

    const distanceToToggle = direction === 1
      ? HEADER_HIDE_SCROLL_DISTANCE
      : HEADER_SHOW_SCROLL_DISTANCE;
    if (scrollDirectionDistanceRef.current >= distanceToToggle) {
      requestCollapsibleHeaderVisible(direction === -1);
      scrollDirectionDistanceRef.current = 0;
    }
  }, [requestCollapsibleHeaderVisible]);

  const handleClientListBeginDrag = useCallback(() => {
    if (showFilters) setShowFilters(false);
  }, [showFilters]);

  const handleCollapsibleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      // The header is only translated, never clipped, so every layout is its
      // real height and it can shrink when a row (e.g. day loads) disappears.
      setHeaderMeasurement((current) => (
        current.key === headerLayoutKey && current.height === nextHeight
          ? current
          : { key: headerLayoutKey, height: nextHeight }
      ));
    }
  }, [headerLayoutKey]);

  const handleStickyControlsLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (nextHeight > 0) setStickyControlsHeight(nextHeight);
  }, []);

  const androidHeaderTravel = Math.max(collapsibleHeaderHeight, 1);
  const androidClampedHeaderScroll = useMemo(
    () => Animated.diffClamp(androidHeaderScrollY, 0, androidHeaderTravel),
    [androidHeaderScrollY, androidHeaderTravel],
  );
  const androidScrolledHeaderTranslateY = useMemo(
    () => androidClampedHeaderScroll.interpolate({
      inputRange: [0, androidHeaderTravel],
      outputRange: [0, -androidHeaderTravel],
      extrapolate: 'clamp',
    }),
    [androidClampedHeaderScroll, androidHeaderTravel],
  );
  // Both platforms float the header over the list and move it with native
  // transforms instead of animating its height: Android tracks the scroll
  // position, iOS toggles by scroll direction. Keep the compact filter panel
  // visible on both paths.
  const compactFiltersOpen = isPhoneLandscape && showFilters;
  const iosToggledHeaderTranslateY = useMemo(
    () => collapsibleHeaderProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [-collapsibleHeaderHeight, 0],
    }),
    [collapsibleHeaderProgress, collapsibleHeaderHeight],
  );
  const headerTranslateY = compactFiltersOpen
    ? -collapsibleHeaderHeight
    : Platform.OS === 'android'
      ? androidScrolledHeaderTranslateY
      : iosToggledHeaderTranslateY;
  const androidHeaderOnScroll = useMemo(
    () => Animated.event(
      [{ nativeEvent: { contentOffset: { y: androidHeaderScrollY } } }],
      { useNativeDriver: true },
    ),
    [androidHeaderScrollY],
  );
  const listChromeHeight = (compactFiltersOpen ? 0 : collapsibleHeaderHeight) + stickyControlsHeight;
  const clientListContentStyle = useMemo(
    () => [
      styles.listContent,
      // Keep the list viewport fixed. Its content starts below the floating
      // header, while native transforms move the chrome out of view.
      { paddingTop: listChromeHeight + 12 },
    ],
    [styles.listContent, listChromeHeight],
  );

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
      const { field, value, additionalFilter } = dataScopeQuery(
        user.uid,
        scopeGroupId,
        scopeReadVersion,
      );
      let scopedQuery = db
        .collection('clients')
        .where(field, '==', value);
      if (additionalFilter) {
        scopedQuery = scopedQuery.where(
          additionalFilter.field,
          '==',
          additionalFilter.value,
        );
      }
      const serverRead = scopedQuery.get({ source: 'server' });

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
  }, [user?.uid, activeScopeGroupId, groupData?.groupId, scopeReadVersion]);
  const settingsScopeKey = user?.uid ? settingsDocId(user.uid, groupData?.groupId) : '';
  const [appSettingsSnapshot, setAppSettingsSnapshot] = useState<ScopedWhatsAppTemplates>({
    scopeKey: '',
    data: null,
  });
  const appSettings = templatesForScope(settingsScopeKey, appSettingsSnapshot);
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

  // Keep both the selected weekday and contextual date actions correct across
  // local midnight, including after the app returns from the background.
  useEffect(() => {
    let lastKnownToday = getTodayDayName();
    let rolloverTimer: ReturnType<typeof setTimeout> | undefined;

    const checkDay = () => {
      const currentToday = getTodayDayName();
      const currentTodayKey = toLocalDateString(new Date());
      setLocalTodayKey((previousKey) => (
        previousKey === currentTodayKey ? previousKey : currentTodayKey
      ));
      if (currentToday !== lastKnownToday) {
        // Day changed! Only auto-switch if user was viewing the old "today"
        if (selectedDay === lastKnownToday) {
          setSelectedDay(currentToday);
        }
        lastKnownToday = currentToday;
      }
    };

    const scheduleNextRollover = () => {
      if (rolloverTimer) clearTimeout(rolloverTimer);
      rolloverTimer = setTimeout(() => {
        checkDay();
        scheduleNextRollover();
      }, millisecondsUntilNextLocalDay() + 50);
    };

    checkDay();
    scheduleNextRollover();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      checkDay();
      scheduleNextRollover();
    });

    return () => {
      if (rolloverTimer) clearTimeout(rolloverTimer);
      appStateSubscription.remove();
    };
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
    let active = true;
    const docId = settingsScopeKey;
    setAppSettingsSnapshot({ scopeKey: docId, data: null });
    if (!docId) return () => { active = false; };

    const unsubscribe = db.collection('settings').doc(docId).onSnapshot((doc) => {
      if (!active) return;
      setAppSettingsSnapshot({
        scopeKey: docId,
        data: doc.exists ? normalizeWhatsAppTemplates(doc.data()) : null,
      });
    }, (error) => {
      if (!active) return;
      setAppSettingsSnapshot({ scopeKey: docId, data: null });
      reportError(error, 'Error loading WhatsApp templates');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [settingsScopeKey]);

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
      filtered = filtered.filter((c) => matcher(c.name || '', c.address || '', getClientPhoneSearchText(c)));
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
    const today = new Date(`${localTodayKey}T00:00:00`);
    // Local date keys: toISOString() is UTC and would shift the day in
    // timezones east of Greenwich (harmless in UTC-3, wrong in Europe).
    const todayKey = localTodayKey;

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
  }, [visibleClients, deferredDay, localTodayKey, t]);

  // Clients for the nearest date only (for the product counter)
  const nearestDateClients = useMemo(() => {
    if (clientSections.length === 0) return [];
    return clientSections[0].data;
  }, [clientSections]);

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
          sectionDateKey: section.dateKey,
        });
      });
    });
    return items;
  }, [clientSections]);

  // Scroll to top on day change for instant feel
  useEffect(() => {
    resetHeaderScrollTracking();
    setCollapsibleHeaderVisible(true, false);
    if (Platform.OS === 'android') androidHeaderScrollY.setValue(0);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    });
  }, [deferredDay, resetHeaderScrollTracking, setCollapsibleHeaderVisible, androidHeaderScrollY]);

  const handleMarkDone = useCallback(
    (client: Client, forDay?: string) => {
      const day = forDay || selectedDayRef.current;
      // Capture before opening the confirmation: a server echo must never
      // change which occurrence this tap will complete.
      const command = createVisitCommand(client, user?.uid || '', day);
      if (!command) return;
      const complete = () => {
        hapticLight();
        markAsDone(client.id, client, day, command).then((ok) => {
          if (!ok) Alert.alert(t('error'), t('home.markDoneFailed'));
        });
        if (!client.isNote || client.freq !== 'once') {
          pushUndo({ client, command, sectionDay: day });
        }
      };
      if (command.occurrence > toLocalDateString(new Date())) {
        const [year, month, date] = command.occurrence.split('-');
        Alert.alert(t('home.completeEarlyTitle'),
          t('home.completeEarlyMessage', { name: client.name, date: `${date}/${month}/${year}` }),
          [{ text: t('cancel'), style: 'cancel' },
            { text: t('home.completeEarlyConfirm'), onPress: complete }]);
      } else {
        complete();
      }
    },
    [markAsDone, pushUndo, t, user?.uid],
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
              onPress: async () => {
                try {
                  const created = await addTransfer(client);
                  if (created === false) setShowTransfersSheet(true);
                } catch {
                  Alert.alert(t('error'), t('home.transferSaveError'));
                }
              },
            },
          ],
        );
      }
    },
    [hasPendingTransfer, addTransfer],
  );

  const pendingTransferCount = transfers.length;

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

  // Stable modal callbacks: with memoized modals, unrelated Home renders (search
  // keystrokes, "Listo", header toggles) no longer re-render closed modals.
  const closeProductsModal = useCallback(() => setProductsClient(null), []);
  const closeNotesModal = useCallback(() => setNotesClient(null), []);
  const closeEditModal = useCallback(() => setEditingClient(null), []);
  const closeDebtModal = useCallback(() => setDebtClient(null), []);
  const closeAddClientModal = useCallback(() => setShowAddClientModal(false), []);
  const closeSmartModal = useCallback(() => setShowSmartModal(false), []);
  const closeDebtsSheet = useCallback(() => setShowDebtsSheet(false), []);
  const closeTransfersSheet = useCallback(() => setShowTransfersSheet(false), []);
  const closeRelationshipsModal = useCallback(() => setRelationshipClient(null), []);
  const closeAlarmPicker = useCallback(() => setAlarmPromptClient(null), []);
  const closeProfileSwitcher = useCallback(() => setProfileSwitcherVisible(false), [setProfileSwitcherVisible]);
  const closeCalendar = useCallback(() => setShowCalendar(false), []);
  const handleDebtsTransferPayment = useCallback((clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    if (!hasPendingTransfer(clientId)) {
      addTransfer(client);
    }
    setShowDebtsSheet(false);
    setShowTransfersSheet(true);
  }, [clients, hasPendingTransfer, addTransfer]);

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
      onMarkDone: (c: Client, day?: string) => handlersRef.current.handleMarkDone(c, day),
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
          tomorrowVisitMessage={appSettings?.whatsappTomorrowVisit}
          isTomorrowVisit={item.sectionDateKey === tomorrowDateKey}
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
      tomorrowDateKey,
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
                tomorrowVisitMessage={appSettings?.whatsappTomorrowVisit}
                isTomorrowVisit={item.sectionDateKey === tomorrowDateKey}
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
      tomorrowDateKey,
      stableHandlers,
      numColumns,
      styles,
    ],
  );

  if (isInitialClientsLoading) {
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
      <View style={styles.homeContent}>
        <Animated.View
          style={[
            styles.collapsibleTopHeader,
            collapsibleHeaderHeight > 0 && {
              transform: [{ translateY: headerTranslateY }],
            },
          ]}
        >
          <View
            key={headerLayoutKey}
            onLayout={handleCollapsibleHeaderLayout}
          >
          {/* Each horizontal scroller owns a full-width row. */}
          <DaySelector
            selectedDay={selectedDay}
            dayCounts={dayCounts}
            isWide={isWide}
            colors={colors}
            fontScale={fontScale}
            compact={isPhoneLandscape}
            onSelectDay={handleSelectDay}
          />

          {/* Product counter — only nearest date */}
          <ProductCounter clients={nearestDateClients} fontScale={fontScale} compact={isPhoneLandscape} />

          {/* Quick actions — collapse with the calendar and load summary. */}
          <View style={styles.actionPanel}>
            <View style={styles.actionPanelContent}>
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
                  style={[styles.actionCompactButton, styles.actionCompactClient]}
                  onPress={() => {
                    hapticSelection();
                    openAddClientFlow();
                  }}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.newClient')}
                >
                  <Ionicons name="person-add-outline" size={chromeSize(17)} color={colors.primary} />
                  <Text style={styles.actionCompactClientText} numberOfLines={1}>
                    {t('home.newClient')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionCompactButton, styles.actionCompactDebt]}
                  onPress={() => {
                    hapticSelection();
                    setShowDebtsSheet(true);
                  }}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('home.debts')}: ${debts.length}`}
                >
                  <Ionicons name="cash-outline" size={chromeSize(17)} color={colors.danger} />
                  <Text style={styles.actionCompactDebtText} numberOfLines={1}>
                    {t('home.debts')}
                  </Text>
                  {debts.length > 0 && (
                    <View style={styles.actionCompactBadge}>
                      <Text style={styles.actionCompactBadgeText}>
                        {debts.length > 99 ? '99+' : debts.length}
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
                    setShowTransfersSheet(true);
                  }}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('home.transfers')}: ${pendingTransferCount}`}
                >
                  <Ionicons name="swap-horizontal-outline" size={chromeSize(17)} color={colors.successText} />
                  <Text style={styles.actionCompactShortcutText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    {t('home.transfers')}
                  </Text>
                  {pendingTransferCount > 0 && (
                    <View style={[styles.actionCompactBadge, styles.actionCompactTransferBadge]}>
                      <Text style={styles.actionCompactBadgeText}>
                        {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
            </View>
          </View>
          </View>
        </Animated.View>

        <Animated.View
          onLayout={handleStickyControlsLayout}
          style={[
            styles.stickyControls,
            {
              top: collapsibleHeaderHeight,
              transform: [{ translateY: headerTranslateY }],
            },
          ]}
        >
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
            onPress={() => {
              setShowFilters(!showFilters);
              if (isPhoneLandscape) setCollapsibleHeaderVisible(showFilters);
            }}
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
          <View style={[
            styles.filtersPanel,
            isPhoneLandscape && { maxHeight: Math.round(screenHeight * 0.4) },
          ]}>
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
        </Animated.View>
        {/* Al cambiar de reparto, mantener la cabecera y la navegación activas.
            Solo el contenido dependiente del nuevo scope muestra carga. */}
        {loading ? (
          <View
            style={[styles.scopeLoadingContainer, { marginTop: listChromeHeight }]}
            accessibilityRole="progressbar"
          >
            <Text style={styles.loadingText}>{t('loading')}</Text>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </View>
        ) : numColumns > 1 ? (
          <Animated.FlatList
            ref={scrollRef}
            data={gridData}
            extraData={`${debts.length}-${transfers.length}-${numColumns}`}
            keyExtractor={keyExtractor}
            renderItem={renderGridItem}
            style={{ flex: 1 }}
            contentContainerStyle={clientListContentStyle}
            onScroll={Platform.OS === 'android' ? androidHeaderOnScroll : handleClientListScroll}
            scrollEventThrottle={16}
            onScrollBeginDrag={handleClientListBeginDrag}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={11}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
                progressViewOffset={listChromeHeight}
              />
            }
            ListEmptyComponent={listEmptyComponent}
            ListFooterComponent={listFooterComponent}
          />
        ) : (
          <Animated.FlatList
            ref={scrollRef}
            data={flatListData}
            extraData={`${debts.length}-${transfers.length}`}
            keyExtractor={keyExtractor}
            renderItem={renderListItem}
            onScroll={Platform.OS === 'android' ? androidHeaderOnScroll : handleClientListScroll}
            scrollEventThrottle={16}
            onScrollBeginDrag={handleClientListBeginDrag}
            style={{ flex: 1 }}
            contentContainerStyle={clientListContentStyle}
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
                progressViewOffset={listChromeHeight}
              />
            }
            ListEmptyComponent={listEmptyComponent}
            ListFooterComponent={listFooterComponent}
          />
      )}
      </View>

      <UndoBanner queue={undoQueue} selectedDay={selectedDay} onUndo={handleUndoMarkDone} />

      {/* Focused order-detail editors opened directly from each card. */}
      <ClientProductsModal
        visible={!!productsClient}
        client={productsClient}
        onSave={updateClient}
        onClose={closeProductsModal}
      />

      <ClientNotesModal
        visible={!!notesClient}
        client={notesClient}
        onSave={updateClient}
        onClose={closeNotesModal}
      />

      {/* Edit Client Modal */}
      <EditClientModal
        visible={!!editingClient && !editingClient.isNote}
        client={editingClient?.isNote ? null : editingClient}
        allClients={clients}
        onSave={updateClient}
        onClose={closeEditModal}
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
        onClose={closeDebtModal}
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
        onClose={closeAddClientModal}
      />

      {/* Smart Order Modal (IA) */}
      <SmartOrderModal
        visible={showSmartModal}
        onClose={closeSmartModal}
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
        onClose={closeDebtsSheet}
        onAddDebt={addDebt}
        reminderTemplate={appSettings?.whatsappRecordatorio}
        debtTemplate={appSettings?.whatsappDeuda}
        onTransferPayment={handleDebtsTransferPayment}
      />

      {/* Transfers Sheet */}
      <TransfersSheet
        visible={showTransfersSheet}
        transfers={transfers}
        onReview={markTransferReviewed}
        onClose={closeTransfersSheet}
      />

      {/* Relationships Modal */}
      <RelationshipsModal
        visible={!!relationshipClient}
        client={relationshipClient ? (clients.find((c) => c.id === relationshipClient.id) || relationshipClient) : null}
        allClients={clients}
        onClose={closeRelationshipsModal}
        onAddRelationship={addRelationship}
        onRemoveRelationship={removeRelationship}
      />

      <AlarmPicker
        client={alarmPromptClient}
        selectedDay={selectedDay}
        onClose={closeAlarmPicker}
      />

      {/* Profiles / Repartos switcher rápido (abierto desde el chip del header) */}
      <ProfilesModal
        mode="quick"
        visible={profileSwitcherVisible}
        onClose={closeProfileSwitcher}
      />

      {/* Calendario (solo vista del mes) */}
      <CalendarModal
        visible={showCalendar}
        onClose={closeCalendar}
      />
    </View>
  );
};

const getStyles = (
  colors: ThemeColors,
  scale: number = 1,
  isWide: boolean = false,
  isPhoneLandscape: boolean = false,
) => {
  const s = (v: number) => Math.round(v * scale);
  const singleActionRow = isWide || isPhoneLandscape;
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  homeContent: {
    flex: 1,
    overflow: 'hidden',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  collapsibleTopHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    elevation: 2,
  },
  stickyControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
    elevation: 3,
  },
  loadingText: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: s(16),
  },
  scopeLoadingContainer: {
    flex: 1,
    paddingTop: s(4),
  },
  actionPanel: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    paddingHorizontal: s(12),
    paddingTop: s(8),
    paddingBottom: s(isPhoneLandscape ? 6 : 9),
  },
  actionPanelContent: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: s(8),
  },
  actionCompactRow: {
    flex: singleActionRow ? 1 : undefined,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: s(8),
  },
  actionCompactStack: {
    flexDirection: singleActionRow ? 'row' : 'column',
    alignItems: 'stretch',
    gap: s(7),
  },
  actionCompactButton: {
    flex: 1,
    minWidth: 0,
    minHeight: s(isPhoneLandscape ? 44 : 48),
    borderRadius: s(12),
    borderWidth: 1,
    paddingHorizontal: s(4),
    paddingVertical: s(isPhoneLandscape ? 4 : 6),
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(3),
  },
  actionCompactAi: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  actionCompactAiText: {
    width: '100%',
    textAlign: 'center',
    fontSize: s(12),
    lineHeight: s(15),
    fontWeight: '800',
    color: colors.textWhite,
  },
  actionCompactClient: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLight,
  },
  actionCompactClientText: {
    width: '100%',
    textAlign: 'center',
    fontSize: s(12),
    lineHeight: s(15),
    fontWeight: '800',
    color: colors.primary,
  },
  actionCompactDebt: {
    backgroundColor: colors.dangerLight,
    borderColor: colors.dangerBorder,
  },
  actionCompactDebtText: {
    width: '100%',
    textAlign: 'center',
    fontSize: s(12),
    lineHeight: s(15),
    fontWeight: '800',
    color: colors.danger,
  },
  actionCompactShortcutRow: {
    flex: singleActionRow ? 1 : undefined,
    flexDirection: 'row',
    gap: s(6),
  },
  actionCompactShortcut: {
    flex: 1,
    minWidth: 0,
    minHeight: s(isPhoneLandscape ? 44 : isWide ? 48 : 38),
    borderRadius: s(10),
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.sectionBackground,
    paddingHorizontal: s(isPhoneLandscape ? 4 : 7),
    paddingVertical: singleActionRow ? s(isPhoneLandscape ? 4 : 6) : 0,
    flexDirection: singleActionRow ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(singleActionRow ? 3 : 5),
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
  actionCompactTransferBadge: {
    backgroundColor: colors.success,
  },
  searchSection: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: isPhoneLandscape ? 4 : 8,
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
