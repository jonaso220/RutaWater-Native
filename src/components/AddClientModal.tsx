import React, { useState } from 'react';
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
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { PRODUCTS, ALL_DAYS } from '../constants/products';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useTranslation } from 'react-i18next';

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
  ) => Promise<void>;
  onClose: () => void;
}

type Destination = 'day' | 'directory';

const AddClientModal: React.FC<AddClientModalProps> = ({
  visible,
  day = '',
  onSave,
  onClose,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = getStyles(colors);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Record<string, number>>({});
  const [destination, setDestination] = useState<Destination>(day ? 'day' : 'directory');
  const [selectedDay, setSelectedDay] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const isDirectoryMode = !day;

  // Detect if text is the simple "Name - Address - Link" format
  const isSimpleFormat = (text: string): boolean => {
    const trimmed = text.trim();
    // Single line (or single meaningful line) with dash separators
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 2) return false;
    // Must have at least one " - " separator
    const singleLine = lines.join(' ');
    return singleLine.includes(' - ') && !(/^(pedido|nombre|direcci[oó]n|tel[eé]fono|producto)\s*:/im.test(trimmed));
  };

  // Parse simple format: "Name - Address - Link" or "Name - Address"
  const parseSimpleFormat = (text: string) => {
    const singleLine = text.trim().split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    const parts = singleLine.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);

    let parsedName = '';
    let parsedAddress = '';
    let parsedMapsLink = '';

    // Extract URL from any part
    for (let i = parts.length - 1; i >= 0; i--) {
      const urlMatch = parts[i].match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        parsedMapsLink = urlMatch[1];
        // Remove the URL from the part; if the part is only the URL, remove it entirely
        const remainder = parts[i].replace(urlMatch[1], '').trim();
        if (remainder) {
          parts[i] = remainder;
        } else {
          parts.splice(i, 1);
        }
        break;
      }
    }

    // First part = name, rest = address
    if (parts.length >= 2) {
      parsedName = parts[0];
      parsedAddress = parts.slice(1).join(' - ');
    } else if (parts.length === 1) {
      parsedName = parts[0];
    }

    if (parsedName) setName(parsedName);
    if (parsedAddress) setAddress(parsedAddress);
    if (parsedMapsLink) setMapsLink(parsedMapsLink);
  };

  const parseOrderText = (text: string) => {
    // Try simple format first: "Name - Address - Link"
    if (isSimpleFormat(text)) {
      parseSimpleFormat(text);
      return;
    }

    // Full order format with labeled fields
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    let parsedName = '';
    let parsedAddress = '';
    let parsedPhone = '';
    let parsedMapsLink = '';
    const parsedProducts: Record<string, number> = {};
    const noteParts: string[] = [];

    let inProductSection = false;

    for (const line of lines) {
      // Skip header
      if (/^pedido de cliente/i.test(line)) continue;

      // Name
      if (/^nombre\s*:/i.test(line)) {
        parsedName = line.replace(/^nombre\s*:\s*/i, '').trim();
        inProductSection = false;
        continue;
      }

      // Address (Dirección / Direccion)
      if (/^direcci[oó]n\s*:/i.test(line)) {
        parsedAddress = line.replace(/^direcci[oó]n\s*:\s*/i, '').trim();
        inProductSection = false;
        continue;
      }

      // Esquina - append to address
      if (/^esquina\s*:/i.test(line)) {
        const esquina = line.replace(/^esquina\s*:\s*/i, '').trim();
        if (esquina) {
          parsedAddress = parsedAddress ? `${parsedAddress} esq. ${esquina}` : esquina;
        }
        inProductSection = false;
        continue;
      }

      // Phone (Teléfono / Telefono)
      if (/^tel[eé]fono\s*:/i.test(line)) {
        parsedPhone = line.replace(/^tel[eé]fono\s*:\s*/i, '').trim();
        inProductSection = false;
        continue;
      }

      // URL (Google Maps link)
      if (/https?:\/\//.test(line)) {
        const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          parsedMapsLink = urlMatch[1];
        }
        inProductSection = false;
        continue;
      }

      // Product section header
      if (/^producto\s*:/i.test(line)) {
        inProductSection = true;
        continue;
      }

      // Detalle line
      if (/^detalle\s*:/i.test(line)) {
        const detail = line.replace(/^detalle\s*:\s*/i, '').trim();
        if (detail) {
          noteParts.push(detail);
        }
        continue;
      }

      // Parse product lines: "Bidon: 20Lts 2" or "Bidon: 12Lts 1" or "Soda: 0"
      if (inProductSection) {
        const bidonMatch = line.match(/^bid[oó]n\s*:\s*(\d+)\s*(?:lts?|litros?)?\s+(\d+)/i);
        if (bidonMatch) {
          const liters = parseInt(bidonMatch[1], 10);
          const qty = parseInt(bidonMatch[2], 10);
          if (qty > 0) {
            if (liters === 20) parsedProducts.b20 = (parsedProducts.b20 || 0) + qty;
            else if (liters === 12) parsedProducts.b12 = (parsedProducts.b12 || 0) + qty;
            else if (liters === 6) parsedProducts.b6 = (parsedProducts.b6 || 0) + qty;
          }
          continue;
        }

        const sodaMatch = line.match(/^soda\s*:\s*(\d+)/i);
        if (sodaMatch) {
          const qty = parseInt(sodaMatch[1], 10);
          if (qty > 0) parsedProducts.soda = qty;
          continue;
        }

        const bombitaMatch = line.match(/^bombita\s*:\s*(\d+)/i);
        if (bombitaMatch) {
          const qty = parseInt(bombitaMatch[1], 10);
          if (qty > 0) parsedProducts.bombita = qty;
          continue;
        }

        const dispElecNewMatch = line.match(/^disp(?:ensador)?\s*(?:elec(?:trico|\.)?)\s*(?:nuevo)\s*:\s*(\d+)/i);
        if (dispElecNewMatch) {
          const qty = parseInt(dispElecNewMatch[1], 10);
          if (qty > 0) parsedProducts.disp_elec_new = qty;
          continue;
        }

        const dispElecChgMatch = line.match(/^disp(?:ensador)?\s*(?:elec(?:trico|\.)?)\s*(?:cambio)\s*:\s*(\d+)/i);
        if (dispElecChgMatch) {
          const qty = parseInt(dispElecChgMatch[1], 10);
          if (qty > 0) parsedProducts.disp_elec_chg = qty;
          continue;
        }

        const dispNatMatch = line.match(/^disp(?:ensador)?\s*(?:natural|nat\.?)\s*:\s*(\d+)/i);
        if (dispNatMatch) {
          const qty = parseInt(dispNatMatch[1], 10);
          if (qty > 0) parsedProducts.disp_nat = qty;
          continue;
        }
      }
    }

    // Apply parsed values
    if (parsedName) setName(parsedName);
    if (parsedAddress) setAddress(parsedAddress);
    if (parsedPhone) setPhone(parsedPhone);
    if (parsedMapsLink) setMapsLink(parsedMapsLink);
    if (Object.keys(parsedProducts).length > 0) setProducts(parsedProducts);
    if (noteParts.length > 0) setNotes(noteParts.join('\n'));
  };

  const handlePasteOrder = () => {
    Keyboard.dismiss();
    if (!pasteText.trim()) {
      setShowPasteModal(false);
      return;
    }
    parseOrderText(pasteText);
    setPasteText('');
    setShowPasteModal(false);
  };

  const resetForm = () => {
    setName('');
    setAddress('');
    setPhone('');
    setMapsLink('');
    setNotes('');
    setProducts({});
    setDestination(isDirectoryMode ? 'directory' : 'day');
    setSelectedDay('');
    setSaving(false);
  };

  const handleClose = () => {
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
    if (!name.trim()) {
      Alert.alert(t('error'), t('addModal.nameRequired'));
      return;
    }
    if (isDirectoryMode && destination === 'day' && !selectedDay) {
      Alert.alert(t('error'), t('addModal.dayRequired'));
      return;
    }
    setSaving(true);
    try {
      let targetDay = '';
      if (isDirectoryMode) {
        targetDay = destination === 'directory' ? '' : selectedDay;
      } else {
        targetDay = destination === 'directory' ? '' : day;
      }
      await onSave(name.trim(), address.trim(), phone.trim(), targetDay, products, notes.trim(), mapsLink.trim());
      resetForm();
      onClose();
    } catch (e) {
      Alert.alert(t('error'), t('addModal.saveError'));
    } finally {
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
            <TouchableOpacity onPress={() => setShowPasteModal(true)} style={styles.pasteBtn}>
              <Text style={styles.pasteBtnText}><Ionicons name="clipboard" size={14} /> {t('addModal.pasteOrder')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
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
                          {d.slice(0, 3)}
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
                    {day}
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
                <TouchableOpacity onPress={() => setName('')} style={{ padding: 4 }}>
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
                <TouchableOpacity onPress={() => setAddress('')} style={{ padding: 4 }}>
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
                <TouchableOpacity onPress={() => setPhone('')} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Maps Link */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>{t('addModal.mapsUrl')}</Text>
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
                <TouchableOpacity onPress={() => setMapsLink('')} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Products */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('addModal.products')}</Text>
            {PRODUCTS.map((p) => (
              <View key={p.id} style={styles.productRow}>
                <Text style={styles.productLabel}>
                  {p.emoji} {p.label}
                </Text>
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
                  style={{ position: 'absolute', top: 8, right: 8, padding: 4 }}
                >
                  <Text style={{ fontSize: 16, color: colors.textHint }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
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
                      ? (selectedDay ? t('addModal.scheduleIn', { day: selectedDay }) : t('addModal.selectDay'))
                      : t('addModal.addTo', { day })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Paste Order Modal */}
      <ModalOverlay visible={showPasteModal} onClose={() => { Keyboard.dismiss(); setPasteText(''); setShowPasteModal(false); }} animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.pasteOverlay}
        >
          <View style={styles.pasteDialog}>
            <Text style={styles.pasteModalTitle}><Ionicons name="clipboard" size={18} /> {t('addModal.pasteOrder')}</Text>
            <Text style={styles.pasteModalHint}>
              {t('addModal.pasteHint')}
            </Text>
            <TextInput
              style={styles.pasteInput}
              value={pasteText}
              onChangeText={setPasteText}
              placeholder={t('addModal.pastePlaceholder')}
              placeholderTextColor={colors.textHint}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.pasteButtons}>
              <TouchableOpacity
                style={styles.pasteCancelBtn}
                onPress={() => { Keyboard.dismiss(); setPasteText(''); setShowPasteModal(false); }}
              >
                <Text style={styles.pasteCancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pasteConfirmBtn, !pasteText.trim() && { opacity: 0.4 }]}
                onPress={handlePasteOrder}
                disabled={!pasteText.trim()}
              >
                <Text style={styles.pasteConfirmText}>{t('addModal.process')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </ModalOverlay>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Platform.OS === 'android' ? '100%' : '90%',
    maxWidth: 600,
    alignSelf: 'center' as const,
    width: '100%' as const,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: colors.textMuted,
  },
  body: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  destRow: {
    flexDirection: 'row',
    gap: 8,
  },
  destChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
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
    fontSize: 15,
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
    gap: 8,
    marginTop: 10,
  },
  dayChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.sectionBackground,
  },
  dayChipSelected: {
    backgroundColor: colors.primary,
  },
  dayChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayChipTextSelected: {
    color: colors.textWhite,
  },
  textInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 17,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.sectionBackground,
  },
  productLabel: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnPlus: {
    backgroundColor: colors.primary,
  },
  qtyBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  qtyBtnPlusText: {
    color: colors.textWhite,
  },
  qtyValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
  },
  pasteBtn: {
    backgroundColor: colors.successBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  pasteBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.successMedium,
  },
  pasteOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  pasteDialog: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    maxWidth: 500,
    alignSelf: 'center' as const,
    width: '100%' as const,
  },
  pasteModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  pasteModalHint: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 14,
  },
  pasteInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 150,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  pasteButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  pasteCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.sectionBackground,
    alignItems: 'center',
  },
  pasteCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  pasteConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  pasteConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textWhite,
  },
});

export default AddClientModal;
