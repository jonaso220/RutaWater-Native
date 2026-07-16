import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { ProductLabel } from './ProductIcon';
import ClientInfoEditModal from './ClientInfoEditModal';
import FrequencyEditModal from './FrequencyEditModal';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Client } from '../types';
import { useProducts } from '../stores/productCatalogStore';
import { FREQUENCIES, Frequency, getFreqLabel } from '../constants/products';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { getModalWidth, getNextVisitDate } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';
import { scheduleClientAlarm } from '../services/notifications';
import { getLastVisitDate } from '../utils/recency';

interface EditClientModalProps {
  visible: boolean;
  client: Client | null;
  // Used to compute the top order for the destination day when a 'once'
  // client moves to a new day — without it we'd carry the source-day index
  // (e.g. position 54) into a day with a totally different ordering.
  allClients?: Client[];
  onSave: (clientId: string, data: Partial<Client>) => void;
  onClose: () => void;
  onDelete?: (clientId: string) => Promise<void>;
  // Removes the client from the current day's list (keeps it in the directory).
  // Used from the Inicio flow; not destructive.
  onRemoveFromDay?: (client: Client) => void;
  // Day whose card was opened in Inicio. This lets the frequency calendar
  // point at that card's actual pending occurrence (also for multi-day clients).
  scheduledDay?: string;
  showClientInfo?: boolean;
  hideOrderDetails?: boolean;
}

const EditClientModal: React.FC<EditClientModalProps> = ({
  visible,
  client,
  allClients,
  onSave,
  onClose,
  onDelete,
  onRemoveFromDay,
  scheduledDay,
  showClientInfo = false,
  hideOrderDetails = false,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  const [products, setProducts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [freq, setFreq] = useState<Frequency>('weekly');
  const [startDate, setStartDate] = useState<string>('');
  const [pickerDate, setPickerDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [freqModalVisible, setFreqModalVisible] = useState(false);
  const catalogProducts = useProducts();

  useEffect(() => {
    if (client) {
      setSaving(false);
      setName(client.name || '');
      setAddress(client.address || '');
      setPhone(client.phone || '');
      setMapsLink(client.mapsLink || '');
      // Initialize products from client data. Start from whatever the client
      // already has (so quantities for hidden/removed products survive an edit)
      // then make sure every product in the current catalog has an entry.
      const prods: Record<string, number> = {};
      Object.keys(client.products || {}).forEach((k) => {
        prods[k] = parseInt(String(client.products?.[k] || 0), 10) || 0;
      });
      catalogProducts.forEach((p) => {
        if (prods[p.id] === undefined) prods[p.id] = 0;
      });
      setProducts(prods);
      setNotes(client.notes || '');
      setFreq(client.freq || 'weekly');
      setStartDate(client.specificDate || '');
      // When opened from Inicio, point the calendar at the occurrence
      // represented by that card instead of at today. Keep the Directory flow
      // unchanged. This is deliberately separate from startDate: merely
      // opening Edit must not create/change the persisted frequency anchor.
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const scheduledDate = scheduledDay
        ? getNextVisitDate(client, scheduledDay)
        : null;
      let initialPickerDate = scheduledDate;
      if (!initialPickerDate && client.specificDate) {
        const clientDate = new Date(client.specificDate + 'T12:00:00');
        initialPickerDate = clientDate >= today ? clientDate : today;
      }
      initialPickerDate = initialPickerDate || today;
      initialPickerDate.setHours(12, 0, 0, 0);
      setPickerDate(initialPickerDate);
      setShowDatePicker(false);
      setInfoModalVisible(false);
      setFreqModalVisible(false);
    }
  }, [client?.id, scheduledDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset sub-modal state when the parent modal is hidden, so reopening
  // with the same client doesn't flash a stale sub-modal.
  useEffect(() => {
    if (!visible) {
      setInfoModalVisible(false);
      setFreqModalVisible(false);
    }
  }, [visible]);

  if (!client) return null;

  const needsDate = freq === 'once' || freq === 'weekly' || freq === 'biweekly' || freq === 'triweekly' || freq === 'monthly';

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setPickerDate(selectedDate);
      const yyyy = selectedDate.getFullYear();
      const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(selectedDate.getDate()).padStart(2, '0');
      setStartDate(`${yyyy}-${mm}-${dd}`);
    }
  };

  const formatDisplayDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const dayNames = t('dayNames', { returnObjects: true }) as string[];
    const monthNames = t('monthNames', { returnObjects: true }) as string[];
    return `${dayNames[d.getDay()]} ${d.getDate()} de ${monthNames[d.getMonth()]}`;
  };

  const handleSave = async () => {
    if (saving) return;
    // Allow saving if client has visitDay OR visitDays OR user selected a new date
    const hasDay = (client.visitDays && client.visitDays.length > 0) || (client.visitDay && client.visitDay !== 'Sin Asignar');
    const hasNewDate = needsDate && startDate;
    if (freq !== 'once' && freq !== 'on_demand' && !hasDay && !hasNewDate) {
      Alert.alert(t('error'), t('editModal.errorNoDays'));
      return;
    }
    setSaving(true);
    const data: Partial<Client> = { freq };
    if (!hideOrderDetails) {
      const cleanProducts: Record<string, number> = {};
      Object.entries(products).forEach(([key, val]) => {
        if (val > 0) cleanProducts[key] = val;
      });
      data.products = cleanProducts;
      data.notes = notes;
    }
    const dateChanged = needsDate && (startDate || '') !== (client.specificDate || '');
    const scheduleChanged = freq !== client.freq || dateChanged;
    const lastDelivery = getLastVisitDate(client);
    if (scheduleChanged && lastDelivery) {
      // Antes de reiniciar campos internos de agenda, promover cualquier
      // historial legado a la fecha canónica de entrega.
      (data as any).lastDeliveredAt = lastDelivery;
    }
    // Re-scheduling an active client (frequency or date actually changed)
    // clears any stale "completed" flag. Otherwise a re-scheduled order (e.g.
    // a weekly client moved to a one-time day) stays marked as delivered and
    // never shows in the route. Editing unrelated fields (phone, notes) must
    // NOT clear it, or a delivered one-time order pops back into today's route.
    if (freq !== 'on_demand') {
      if (freq !== client.freq || dateChanged) {
        (data as any).isCompleted = false;
        (data as any).completedAt = null;
      }
      // Saving an active frequency reactivates an ex-client; otherwise they'd
      // run in the route while still flagged "Inactivo" in the Directory.
      if (client.isInactive) (data as any).isInactive = false;
    }
    // Reset lastVisited when frequency changes so getNextVisitDate recalculates correctly
    if (freq !== client.freq && freq !== 'once') {
      (data as any).lastVisited = null;
      (data as any).doneFor = '';
    }
    // Reset lastVisited when date changes on a periodic client so it reappears on the new date
    if (needsDate && startDate && freq !== 'once' && client.specificDate !== startDate) {
      (data as any).lastVisited = null;
      (data as any).doneFor = '';
    }
    // Clear specificDate when changing FROM 'once' to a periodic frequency
    if (client.freq === 'once' && freq !== 'once') {
      data.specificDate = '';
    }
    // El bloque de fecha solo aplica si la fecha realmente CAMBIÓ en esta
    // edición (o el pedido es 'once', donde la fecha ES la agenda). startDate
    // se siembra desde client.specificDate al abrir el modal: sin este guard,
    // un ancla vieja movía el día de visita al guardar cualquier cosa (p. ej.
    // solo productos) y sacaba al cliente de su ruta.
    const dateActuallyChanged = (startDate || '') !== (client.specificDate || '');
    if (needsDate && startDate && (freq === 'once' || dateActuallyChanged)) {
      data.specificDate = startDate;
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const d = new Date(startDate + 'T12:00:00');
      const newDay = dayNames[d.getDay()];

      // Effective visit days: prefer the array, but fall back to legacy single visitDay
      // so older clients (without visitDays) can also be moved to a new day.
      const effectiveVisitDays = (client.visitDays && client.visitDays.length > 0)
        ? client.visitDays
        : (client.visitDay && client.visitDay !== 'Sin Asignar' ? [client.visitDay] : []);
      const isSingleDay = effectiveVisitDays.length === 1;
      // oldDay must be a real day name; fall back to the only entry in effectiveVisitDays
      // when visitDay is missing/invalid so listOrders cleanup doesn't break.
      const oldDay = (client.visitDay && client.visitDay !== 'Sin Asignar')
        ? client.visitDay
        : effectiveVisitDays[0];

      if (freq === 'once') {
        // For 'once' freq, update visitDay/visitDays to match the date
        data.visitDay = newDay;
        data.visitDays = [newDay];
      } else if (isSingleDay && newDay !== oldDay) {
        // For periodic clients with a single visit day, move to the new day
        data.visitDay = newDay;
        data.visitDays = [newDay];
      } else if (effectiveVisitDays.length === 0) {
        // Cliente de directorio pasado a frecuencia con solo una fecha: sin
        // esto quedaba freq periódica con visitDay 'Sin Asignar' — figuraba
        // "semanal" en el Directorio pero invisible en todas las rutas.
        data.visitDay = newDay;
        data.visitDays = [newDay];
      }

      // When the day changes, update listOrders so the client has a valid position on the new day.
      if (oldDay && newDay !== oldDay && (freq === 'once' || isSingleDay)) {
        const oldOrders = client.listOrders || {};
        const newOrders = { ...oldOrders };
        delete newOrders[oldDay];

        if (freq === 'once' && allClients && allClients.length > 0) {
          // 'once' clients moving to another day go to the TOP of the
          // destination day. Carrying the source-day index (e.g. position
          // 54) into a day with a different ordering makes the card hard
          // to find — placing it at the top makes it immediately visible.
          const destClients = allClients.filter(
            (c) =>
              c.id !== client.id &&
              c.freq !== 'on_demand' &&
              !c.isCompleted &&
              ((c.visitDays && c.visitDays.includes(newDay)) || c.visitDay === newDay),
          );
          let minOrder = 0;
          if (destClients.length > 0) {
            const orders = destClients.map((c) => {
              const o = c.listOrders?.[newDay] ?? c.listOrder ?? 0;
              // Ignore sentinel-like huge values that indicate "no order".
              return typeof o === 'number' && isFinite(o) && o < 100000 ? o : 0;
            });
            minOrder = Math.min(...orders);
          }
          newOrders[newDay] = minOrder - 1;
        } else {
          // Periodic single-day clients: keep the previous numeric position.
          // Their day mapping is stable across weeks, so the index is meaningful.
          const oldPos = oldOrders[oldDay] ?? client.listOrder ?? 0;
          newOrders[newDay] = oldPos;
        }

        (data as any).listOrders = newOrders;
      }
    } else if (!needsDate) {
      data.specificDate = '';
    }
    // Only persist client info fields if the user actually changed them.
    // Avoids overwriting `undefined` legacy fields with empty strings on
    // unrelated edits (e.g. just bumping product quantities from the list).
    if (name.trim() !== (client.name || '').trim()) data.name = name.trim();
    if (address.trim() !== (client.address || '').trim()) data.address = address.trim();
    if (phone.trim() !== (client.phone || '').trim()) data.phone = phone.trim();
    if (mapsLink.trim() !== (client.mapsLink || '').trim()) data.mapsLink = mapsLink.trim();
    try {
      await onSave(client.id, data);
      // Si el cliente tenía alarma y el guardado le cambió el día o la fecha,
      // reprogramar el trigger de notifee: hasta ahora quedaba apuntando al
      // día viejo aunque la campana siguiera encendida en el día nuevo.
      const savedDay = (data as any).visitDay as string | undefined;
      const savedDate = (data as any).specificDate as string | undefined;
      const dayMoved = savedDay !== undefined && savedDay !== client.visitDay;
      const dateMoved = savedDate !== undefined && savedDate !== (client.specificDate || '');
      if (client.alarm && (dayMoved || dateMoved)) {
        void scheduleClientAlarm(
          client.id,
          (data.name ?? client.name) || '',
          (data.address ?? client.address) || '',
          client.alarm,
          {
            targetDay: savedDay || client.visitDay,
            specificDate: freq === 'once' ? (savedDate || client.specificDate) : undefined,
          },
        );
      }
      onClose();
    } catch (e) {
      Alert.alert(t('error'), t('editModal.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const adjustQty = (productId: string, delta: number) => {
    setProducts((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }));
  };

  const handleDelete = () => {
    if (!onDelete || !client) return;
    Alert.alert(
      t('editModal.deleteTitle'),
      t('editModal.deleteMsg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('editModal.deleteConfirm'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await onDelete(client.id);
              onClose();
            } catch (e) {
              Alert.alert(t('error'), t('editModal.deleteError'));
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  // "Ya no es cliente": marca/desmarca al cliente como inactivo. Al marcarlo lo
  // pasa al directorio (on_demand, sin días) para que salga de todas las rutas;
  // se mantiene guardado y reaparece al reactivarlo.
  const handleToggleInactive = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const data: Partial<Client> = client.isInactive
        ? { isInactive: false }
        : { isInactive: true, freq: 'on_demand', visitDay: 'Sin Asignar', visitDays: [] };
      await onSave(client.id, data);
      onClose();
    } catch (e) {
      Alert.alert(t('error'), t('editModal.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {showClientInfo ? t('editModal.editClient') : (client.name || '').toUpperCase()}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={Platform.OS === 'android' ? { paddingBottom: 60 } : undefined}>
            {!showClientInfo && (
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => setInfoModalVisible(true)}
              >
                <Ionicons name="person-outline" size={18} color={colors.primary} />
                <Text style={styles.linkBtnText}>{t('editModal.editClientData')}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {showClientInfo && (
              <>
                <Text style={styles.sectionTitle}>{t('editModal.clientData')}</Text>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={name}
                    onChangeText={setName}
                    placeholder={t('editModal.namePlaceholder')}
                    placeholderTextColor={colors.textHint}
                  />
                  {name.length > 0 && (
                    <TouchableOpacity onPress={() => setName('')} style={{ padding: 10 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={address}
                    onChangeText={setAddress}
                    placeholder={t('editModal.addressPlaceholder')}
                    placeholderTextColor={colors.textHint}
                  />
                  {address.length > 0 && (
                    <TouchableOpacity onPress={() => setAddress('')} style={{ padding: 10 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={t('editModal.phonePlaceholder')}
                    placeholderTextColor={colors.textHint}
                    keyboardType="phone-pad"
                  />
                  {phone.length > 0 && (
                    <TouchableOpacity onPress={() => setPhone('')} style={{ padding: 10 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0 }}
                    value={mapsLink}
                    onChangeText={setMapsLink}
                    placeholder={t('editModal.mapsPlaceholder')}
                    placeholderTextColor={colors.textHint}
                    keyboardType="url"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {mapsLink.length > 0 && (
                    <TouchableOpacity onPress={() => setMapsLink('')} style={{ padding: 10 }}>
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            {!hideOrderDetails && (
              <>
                {/* Products */}
                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('editModal.products')}</Text>
                {catalogProducts.map((p) => (
                  <View key={p.id} style={styles.productRow}>
                    <ProductLabel
                      value={p.emoji}
                      label={p.label}
                      size={Math.round(18 * fontScale)}
                      style={styles.productLabel}
                    />
                    <View style={styles.qtyControls}>
                      <TouchableOpacity
                        onPress={() => adjustQty(p.id, -1)}
                        style={styles.qtyBtn}
                      >
                        <Text style={styles.qtyBtnText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyValue}>{products[p.id] || 0}</Text>
                      <TouchableOpacity
                        onPress={() => adjustQty(p.id, 1)}
                        style={[styles.qtyBtn, styles.qtyBtnPlus]}
                      >
                        <Text style={[styles.qtyBtnText, styles.qtyBtnPlusText]}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}

                {/* Notes */}
                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('editModal.notes')}</Text>
                <View style={[styles.notesInput, { position: 'relative' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0, textAlignVertical: 'top', minHeight: 70 }}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder={t('editModal.notesPlaceholder')}
                    placeholderTextColor={colors.textHint}
                    multiline
                    numberOfLines={3}
                  />
                  {notes.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setNotes('')}
                      style={{ position: 'absolute', top: 4, right: 4, padding: 10 }}
                    >
                      <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            {/* Frequency: inline when editing client info, otherwise a link to sub-modal */}
            {showClientInfo ? (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
                  {t('editModal.frequency')}
                </Text>
                <View style={styles.freqGrid}>
                  {FREQUENCIES.map((key) => (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setFreq(key)}
                      style={[
                        styles.freqChip,
                        freq === key && styles.freqChipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.freqChipText,
                          freq === key && styles.freqChipTextSelected,
                        ]}
                      >
                        {getFreqLabel(key)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {needsDate && (
                  <View style={{ marginTop: 16 }}>
                    <Text style={styles.sectionTitle}>
                      {freq === 'once' ? t('editModal.date') : t('editModal.startDate')}
                    </Text>
                    {startDate ? (
                      <View style={styles.selectedDateRow}>
                        <Text style={styles.selectedDateText}>
                          {formatDisplayDate(startDate)}
                        </Text>
                        <TouchableOpacity onPress={() => { setStartDate(''); setShowDatePicker(false); }}>
                          <Text style={styles.clearDateText}>{t('editModal.clearDate')}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={styles.dateHint}>
                        {t('editModal.dateHint')}
                      </Text>
                    )}
                    {Platform.OS === 'ios' ? (
                      <View style={styles.datePickerWrapper}>
                        <DateTimePicker
                          value={pickerDate}
                          mode="date"
                          display="inline"
                          onChange={onDateChange}
                          locale="es-ES"
                          style={styles.datePicker}
                          themeVariant={isDark ? 'dark' : 'light'}
                        />
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.dateBtn}
                          onPress={() => setShowDatePicker(true)}
                        >
                          <Text style={styles.dateBtnText}>
                            {startDate ? formatDisplayDate(startDate) : t('editModal.chooseDate')}
                          </Text>
                        </TouchableOpacity>
                        {showDatePicker && (
                          <DateTimePicker
                            value={pickerDate}
                            mode="date"
                            display="default"
                            onChange={onDateChange}
                            locale="es-ES"
                          />
                        )}
                      </>
                    )}
                  </View>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={[styles.linkBtn, { marginTop: 20 }]}
                onPress={() => setFreqModalVisible(true)}
              >
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={styles.linkBtnText}>
                  {getFreqLabel(freq)}
                  {needsDate && startDate ? ` · ${formatDisplayDate(startDate)}` : ''}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{t('editModal.save')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.inactiveToggleBtn, saving && { opacity: 0.6 }]}
              onPress={handleToggleInactive}
              disabled={saving}
            >
              <Text style={styles.inactiveToggleBtnText}>
                {client.isInactive ? t('editModal.reactivate') : t('editModal.markInactive')}
              </Text>
            </TouchableOpacity>
            {onRemoveFromDay && (
              <TouchableOpacity
                style={styles.removeFromDayBtn}
                onPress={() => {
                  onRemoveFromDay(client);
                  onClose();
                }}
              >
                <Text style={styles.removeFromDayBtnText}>{t('home.removeFromList')}</Text>
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                style={[styles.deleteBtn, deleting && { opacity: 0.5 }]}
                onPress={handleDelete}
                disabled={deleting}
              >
                <Text style={styles.deleteBtnText}>{t('editModal.deleteClient')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <ClientInfoEditModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
        name={name}
        address={address}
        phone={phone}
        mapsLink={mapsLink}
        setName={setName}
        setAddress={setAddress}
        setPhone={setPhone}
        setMapsLink={setMapsLink}
      />

      <FrequencyEditModal
        visible={freqModalVisible}
        onClose={() => setFreqModalVisible(false)}
        freq={freq}
        setFreq={setFreq}
        startDate={startDate}
        setStartDate={setStartDate}
        pickerDate={pickerDate}
        setPickerDate={setPickerDate}
      />
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: isTablet ? 'center' : 'flex-end',
    alignItems: 'center',
    paddingHorizontal: isTablet ? s(24) : s(8),
    paddingVertical: isTablet ? s(24) : 0,
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: s(20),
    borderTopRightRadius: s(20),
    borderBottomLeftRadius: isTablet ? s(20) : 0,
    borderBottomRightRadius: isTablet ? s(20) : 0,
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '85%',
    maxWidth: isTablet ? undefined : 600,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: s(16),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  closeBtn: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: s(18),
    color: colors.textMuted,
  },
  body: {
    padding: s(16),
  },
  sectionTitle: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: s(12),
  },
  fieldInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(16),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: s(10),
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: 1,
    borderBottomColor: colors.sectionBackground,
  },
  productLabel: {
    fontSize: s(16),
    color: colors.textSecondary,
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  qtyBtn: {
    width: s(32),
    height: s(32),
    borderRadius: s(8),
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnPlus: {
    backgroundColor: colors.primary,
  },
  qtyBtnText: {
    fontSize: s(20),
    fontWeight: '700',
    color: colors.textSecondary,
  },
  qtyBtnPlusText: {
    color: colors.textWhite,
  },
  qtyValue: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: s(24),
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(16),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    textAlignVertical: 'top',
    minHeight: s(80),
  },
  freqGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  freqChip: {
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: s(20),
    backgroundColor: colors.sectionBackground,
  },
  freqChipSelected: {
    backgroundColor: colors.primary,
  },
  freqChipText: {
    fontSize: s(15),
    fontWeight: '600',
    color: colors.textSecondary,
  },
  freqChipTextSelected: {
    color: colors.textWhite,
  },
  selectedDateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    padding: s(12),
    marginBottom: s(8),
  },
  selectedDateText: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.textPrimary,
  },
  clearDateText: {
    fontSize: s(15),
    color: colors.danger,
    fontWeight: '600',
  },
  dateHint: {
    fontSize: s(15),
    color: colors.textMuted,
    marginBottom: s(8),
  },
  datePicker: {
    height: 350,
  },
  datePickerWrapper: {
    alignSelf: 'center' as const,
    width: 330,
    overflow: 'hidden' as const,
    marginTop: s(4),
  },
  dateBtn: {
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    padding: s(14),
    alignItems: 'center',
  },
  dateBtnText: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.primary,
  },
  footer: {
    padding: s(16),
    paddingBottom: Platform.OS === 'android' ? s(32) : s(16),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    paddingVertical: s(14),
    paddingHorizontal: s(14),
  },
  linkBtnText: {
    flex: 1,
    fontSize: s(15),
    fontWeight: '600',
    color: colors.textPrimary,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
  },
  saveBtnText: {
    color: colors.textWhite,
    fontSize: s(18),
    fontWeight: '700',
  },
  deleteBtn: {
    marginTop: s(12),
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  deleteBtnText: {
    color: colors.danger,
    fontSize: s(16),
    fontWeight: '700',
  },
  removeFromDayBtn: {
    marginTop: s(12),
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
  },
  removeFromDayBtnText: {
    color: colors.textSecondary,
    fontSize: s(16),
    fontWeight: '600',
  },
  inactiveToggleBtn: {
    marginTop: s(12),
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  inactiveToggleBtnText: {
    color: colors.textSecondary,
    fontSize: s(16),
    fontWeight: '600',
  },
  });
};

export default EditClientModal;
