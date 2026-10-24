import React, { useRef, useState, useMemo } from 'react';
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
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { ProductLabel } from './ProductIcon';
import { ALL_DAYS, RecurringFrequency, getDayLabel } from '../constants/products';
import { useProducts } from '../stores/productCatalogStore';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useTranslation } from 'react-i18next';
import { getModalWidth } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { isClientLimitError } from '../services/clientCreation';
import ClientBillingInfoEditor from './ClientBillingInfoEditor';
import {
  ClientBillingInfo,
  isValidClientEmail,
  sanitizeClientBillingInfo,
} from '../utils/clientBillingInfo';

interface AddClientModalProps {
  visible: boolean;
  day?: string;
  onSave: (
    name: string,
    address: string,
    phone: string,
    day: string,
    products: Record<string, number>,
    notes: string,
    mapsLink: string,
    billing: ClientBillingInfo,
    freq: RecurringFrequency,
  ) => Promise<void>;
  onClose: () => void;
}

type Destination = 'day' | 'directory';

// Un pedido de una sola vez necesita fecha y va primero en la lista; ese
// flujo ya existe en "+ Visita" del Directorio, así que acá sólo se ofrecen
// las frecuencias recurrentes.
const RECURRING_FREQUENCIES: RecurringFrequency[] = ['weekly', 'biweekly', 'triweekly', 'monthly'];

const AddClientModal: React.FC<AddClientModalProps> = ({
  visible,
  day = '',
  onSave,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = useMemo(
    () => getStyles(colors, isTablet, modalWidth, fontScale),
    [colors, isTablet, modalWidth, fontScale],
  );

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  const [notes, setNotes] = useState('');
  const [billing, setBilling] = useState<ClientBillingInfo>(sanitizeClientBillingInfo(null));
  const [products, setProducts] = useState<Record<string, number>>({});
  const [destination, setDestination] = useState<Destination>(day ? 'day' : 'directory');
  const [selectedDay, setSelectedDay] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('weekly');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollToMoreRef = useRef(false);
  const catalogProducts = useProducts();

  const isDirectoryMode = !day;

  const resetForm = () => {
    setName('');
    setAddress('');
    setPhone('');
    setMapsLink('');
    setNotes('');
    setBilling(sanitizeClientBillingInfo(null));
    setShowMoreDetails(false);
    setProducts({});
    setDestination(isDirectoryMode ? 'directory' : 'day');
    setSelectedDay('');
    setFrequency('weekly');
    savingRef.current = false;
    setSaving(false);
  };

  const handleClose = () => {
    if (savingRef.current) return;
    resetForm();
    onClose();
  };

  const adjustQty = (productId: string, delta: number) => {
    setProducts((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }));
  };

  const handleSave = async () => {
    // A fast double-tap can fire twice before the disabled state re-renders,
    // creating the client twice in Firestore.
    if (savingRef.current) return;
    if (!name.trim()) {
      Alert.alert(t('error'), t('addModal.nameRequired'));
      return;
    }
    if (!isValidClientEmail(billing.email)) {
      setShowMoreDetails(true);
      Alert.alert(t('error'), t('clientBilling.invalidEmail'));
      return;
    }
    if (isDirectoryMode && destination === 'day' && !selectedDay) {
      Alert.alert(t('error'), t('addModal.dayRequired'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      let targetDay = '';
      if (isDirectoryMode) {
        targetDay = destination === 'directory' ? '' : selectedDay;
      } else {
        targetDay = destination === 'directory' ? '' : day;
      }
      await onSave(
        name.trim(),
        address.trim(),
        phone.trim(),
        targetDay,
        products,
        notes.trim(),
        mapsLink.trim(),
        sanitizeClientBillingInfo(billing),
        frequency,
      );
      resetForm();
      onClose();
    } catch (e) {
      Alert.alert(
        isClientLimitError(e) ? t('home.limitReached') : t('error'),
        isClientLimitError(e)
          ? t('home.limitMessage', { limit: FREE_CLIENT_LIMIT })
          : t('addModal.saveError'),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <ModalOverlay visible={visible} onClose={handleClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{t('addModal.title')}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              // Al desplegar "Más datos", mostrar los campos que aparecieron abajo.
              if (scrollToMoreRef.current) {
                scrollToMoreRef.current = false;
                scrollRef.current?.scrollToEnd({ animated: true });
              }
            }}
          >
            {/* Destination toggle */}
            <Text style={styles.sectionTitle}>{t('addModal.destination')}</Text>
            {isDirectoryMode ? (
              <>
                <View style={styles.destRow}>
                  <TouchableOpacity
                    style={[styles.destChip, destination === 'directory' && styles.destChipDirectory]}
                    onPress={() => { setDestination('directory'); setSelectedDay(''); }}
                  >
                    <Text style={[styles.destChipText, destination === 'directory' && styles.destChipTextDirectory]}>
                      {t('addModal.directoryOnly')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.destChip, destination === 'day' && styles.destChipSelected]}
                    onPress={() => setDestination('day')}
                  >
                    <Text style={[styles.destChipText, destination === 'day' && styles.destChipTextSelected]}>
                      {t('addModal.scheduleToDay')}
                    </Text>
                  </TouchableOpacity>
                </View>
                {destination === 'day' && (
                  <View style={styles.dayChipsRow}>
                    {ALL_DAYS.map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.dayChip, selectedDay === d && styles.dayChipSelected]}
                        onPress={() => setSelectedDay(d)}
                      >
                        <Text style={[styles.dayChipText, selectedDay === d && styles.dayChipTextSelected]}>
                          {getDayLabel(d).slice(0, 3)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.destRow}>
                <TouchableOpacity
                  style={[styles.destChip, destination === 'day' && styles.destChipSelected]}
                  onPress={() => setDestination('day')}
                >
                  <Text style={[styles.destChipText, destination === 'day' && styles.destChipTextSelected]}>
                    {getDayLabel(day)}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.destChip, destination === 'directory' && styles.destChipDirectory]}
                  onPress={() => setDestination('directory')}
                >
                  <Text style={[styles.destChipText, destination === 'directory' && styles.destChipTextDirectory]}>
                    {t('addModal.directoryOnly')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Frequency: agendar a un día es siempre recurrente, que se vea. */}
            {destination === 'day' ? (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('addModal.frequency')}</Text>
                <View style={styles.dayChipsRow}>
                  {RECURRING_FREQUENCIES.map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[styles.dayChip, frequency === f && styles.dayChipSelected]}
                      onPress={() => setFrequency(f)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: frequency === f }}
                    >
                      <Text style={[styles.dayChipText, frequency === f && styles.dayChipTextSelected]}>
                        {t(`freq.${f}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hintText}>{t('addModal.frequencyHint')}</Text>
              </>
            ) : (
              <Text style={styles.hintText}>{t('addModal.directoryHint')}</Text>
            )}

            {/* Name */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('addModal.name')}</Text>
            <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 17, color: colors.textPrimary, padding: 0 }}
                value={name}
                onChangeText={setName}
                placeholder={t('addModal.namePlaceholder')}
                placeholderTextColor={colors.textHint}
                autoCapitalize="words"
              />
              {name.length > 0 && (
                <TouchableOpacity onPress={() => setName('')} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Address */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('addModal.address')}</Text>
            <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 17, color: colors.textPrimary, padding: 0 }}
                value={address}
                onChangeText={setAddress}
                placeholder={t('addModal.addressPlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              {address.length > 0 && (
                <TouchableOpacity onPress={() => setAddress('')} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Phone */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('addModal.phone')}</Text>
            <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 17, color: colors.textPrimary, padding: 0 }}
                value={phone}
                onChangeText={setPhone}
                placeholder={t('addModal.phonePlaceholder')}
                placeholderTextColor={colors.textHint}
                keyboardType="phone-pad"
              />
              {phone.length > 0 && (
                <TouchableOpacity onPress={() => setPhone('')} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Products */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('addModal.products')}</Text>
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
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('addModal.notes')}</Text>
            <View style={[styles.notesInput, { position: 'relative' }]}>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.textPrimary, padding: 0, textAlignVertical: 'top', minHeight: 70 }}
                value={notes}
                onChangeText={setNotes}
                placeholder={t('addModal.notesPlaceholder')}
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

            {/* Datos que se usan poco: plegados para que Productos quede a mano. */}
            <TouchableOpacity
              style={styles.moreToggle}
              onPress={() => {
                scrollToMoreRef.current = !showMoreDetails;
                setShowMoreDetails((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: showMoreDetails }}
            >
              <Ionicons
                name={showMoreDetails ? 'chevron-down' : 'chevron-forward'}
                size={Math.round(16 * fontScale)}
                color={colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.moreToggleTitle}>{t('addModal.moreDetails')}</Text>
                {!showMoreDetails && (
                  <Text style={styles.moreToggleHint}>{t('addModal.moreDetailsHint')}</Text>
                )}
              </View>
            </TouchableOpacity>
            {showMoreDetails && (
              <View style={styles.moreBody}>
                {/* Maps Link */}
                <Text style={[styles.sectionTitle, { marginTop: 12 }]}>{t('addModal.mapsUrl')}</Text>
                <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center' }]}>
                  <TextInput
                    style={{ flex: 1, fontSize: 17, color: colors.textPrimary, padding: 0 }}
                    value={mapsLink}
                    onChangeText={setMapsLink}
                    placeholder="https://maps.app.goo.gl/..."
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
                <Text style={styles.hintText}>{t('addModal.mapsHelp')}</Text>

                {/* Billing (optional) */}
                <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('clientBilling.title')}</Text>
                <ClientBillingInfoEditor value={billing} onChange={setBilling} />
              </View>
            )}
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving
                  ? t('addModal.saving')
                  : destination === 'directory'
                    ? t('addModal.saveToDirectory')
                    : isDirectoryMode
                      ? (selectedDay
                        ? t('addModal.scheduleIn', { day: selectedDay, every: t(`addModal.every.${frequency}`) })
                        : t('addModal.selectDay'))
                      : t('addModal.addTo', { day, every: t(`addModal.every.${frequency}`) })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

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
    maxHeight: Platform.OS === 'android' ? '100%' : '90%',
    maxWidth: isTablet ? undefined : 600,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
    overflow: 'hidden' as const,
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
    fontSize: s(20),
    fontWeight: '700',
    color: colors.textPrimary,
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
    marginBottom: s(8),
  },
  destRow: {
    flexDirection: 'row',
    gap: s(8),
  },
  destChip: {
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    borderRadius: s(10),
    backgroundColor: colors.sectionBackground,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  destChipSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  destChipDirectory: {
    backgroundColor: colors.warningLightBg,
    borderColor: colors.warning,
  },
  destChipText: {
    fontSize: s(15),
    fontWeight: '600',
    color: colors.textSecondary,
  },
  destChipTextSelected: {
    color: colors.primaryDark,
  },
  destChipTextDirectory: {
    color: colors.warningOrangeText,
  },
  dayChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
    marginTop: s(10),
  },
  dayChip: {
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    borderRadius: s(20),
    backgroundColor: colors.sectionBackground,
  },
  dayChipSelected: {
    backgroundColor: colors.primary,
  },
  dayChipText: {
    fontSize: s(15),
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayChipTextSelected: {
    color: colors.textWhite,
  },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginTop: s(16),
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderRadius: s(10),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.cardBorder,
  },
  moreToggleTitle: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textSecondary,
  },
  moreToggleHint: {
    fontSize: s(12),
    color: colors.textMuted,
    marginTop: s(2),
  },
  moreBody: {
    marginBottom: s(16),
  },
  hintText: {
    fontSize: s(13),
    lineHeight: s(18),
    color: colors.textMuted,
    marginTop: s(8),
  },
  textInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(17),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
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
  footer: {
    padding: s(16),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: colors.textWhite,
    fontSize: s(18),
    fontWeight: '700',
  },
  });
};

export default React.memo(AddClientModal);
