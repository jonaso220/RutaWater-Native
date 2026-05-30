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
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getModalWidth } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';
import {
  useAllProducts,
  useProductCatalogStore,
} from '../stores/productCatalogStore';

interface ProductCatalogModalProps {
  visible: boolean;
  onClose: () => void;
}

// Curated icons grouped by category, relevant to a water / delivery business.
// Users can also type any emoji from the keyboard in the picker's free field.
const EMOJI_CATEGORIES: { key: string; emojis: string[] }[] = [
  { key: 'water', emojis: ['💧', '🚰', '🫧', '💦', '🪣', '🧊', '❄️', '🌊'] },
  { key: 'drinks', emojis: ['🥤', '🧃', '🍶', '🥛', '🧉', '☕', '🧋', '🍷', '🍺', '🍹', '🫗', '🧴'] },
  { key: 'containers', emojis: ['📦', '🫙', '🛢️', '🥫', '🧼', '🧯', '🪥', '🧰'] },
  { key: 'energy', emojis: ['🔌', '⚡', '🔋', '🔥', '⛽', '🪫', '💡'] },
  { key: 'other', emojis: ['🌿', '🍃', '🌱', '🪴', '🏠', '🏢', '🚚', '🛒', '💰', '⭐', '✅', '🔧', '📌', '🏷️'] },
];

const NEW_TARGET = '__new__';

const ProductCatalogModal: React.FC<ProductCatalogModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);

  const allProducts = useAllProducts();
  const hidden = useProductCatalogStore((s) => s.hidden);
  const customProducts = useProductCatalogStore((s) => s.customProducts);
  const renameProduct = useProductCatalogStore((s) => s.renameProduct);
  const setProductEmoji = useProductCatalogStore((s) => s.setProductEmoji);
  const setProductHidden = useProductCatalogStore((s) => s.setProductHidden);
  const addProduct = useProductCatalogStore((s) => s.addProduct);
  const removeCustomProduct = useProductCatalogStore((s) => s.removeCustomProduct);
  const moveProduct = useProductCatalogStore((s) => s.moveProduct);

  const [newEmoji, setNewEmoji] = useState('');
  const [newName, setNewName] = useState('');
  const [newShort, setNewShort] = useState('');
  // Which product's emoji is being edited: a product id, NEW_TARGET, or null.
  const [emojiTarget, setEmojiTarget] = useState<string | null>(null);
  const [emojiDraft, setEmojiDraft] = useState('');

  const isCustom = (id: string) => customProducts.some((c) => c.id === id);

  const pickEmoji = (emoji: string) => {
    const value = emoji.trim();
    if (!value) return;
    if (emojiTarget === NEW_TARGET) {
      setNewEmoji(value);
    } else if (emojiTarget) {
      setProductEmoji(emojiTarget, value);
    }
    setEmojiTarget(null);
    setEmojiDraft('');
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    addProduct({ label: newName, emoji: newEmoji, short: newShort });
    setNewEmoji('');
    setNewName('');
    setNewShort('');
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert(t('settings.deleteProductTitle'), t('settings.deleteProductMsg', { name }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => removeCustomProduct(id) },
    ]);
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('settings.productsTitle')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.subtitle}>{t('settings.productsSubtitle')}</Text>

            {allProducts.map((p, index) => {
              const isHidden = hidden.includes(p.id);
              const isFirst = index === 0;
              const isLast = index === allProducts.length - 1;
              return (
                <View key={p.id} style={[styles.row, isHidden && styles.rowHidden]}>
                  <View style={styles.reorderCol}>
                    <TouchableOpacity
                      onPress={() => moveProduct(p.id, -1)}
                      disabled={isFirst}
                      style={styles.reorderBtn}
                      accessibilityLabel="Subir"
                    >
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={isFirst ? colors.textDisabled : colors.textMuted}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveProduct(p.id, 1)}
                      disabled={isLast}
                      style={styles.reorderBtn}
                      accessibilityLabel="Bajar"
                    >
                      <Ionicons
                        name="chevron-down"
                        size={18}
                        color={isLast ? colors.textDisabled : colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => setEmojiTarget(p.id)}
                    style={styles.emojiTouch}
                    accessibilityLabel={t('settings.productEmojiHint')}
                  >
                    <Text style={styles.emoji}>{p.emoji}</Text>
                  </TouchableOpacity>
                  <TextInput
                    // Remount when the stored label changes so the uncontrolled
                    // input always reflects the persisted value after a rename.
                    key={`${p.id}-${p.label}`}
                    style={styles.nameInput}
                    defaultValue={p.label}
                    placeholder={t('settings.productNamePlaceholder')}
                    placeholderTextColor={colors.textHint}
                    onEndEditing={(e) => renameProduct(p.id, e.nativeEvent.text)}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    onPress={() => setProductHidden(p.id, !isHidden)}
                    style={styles.iconBtn}
                    accessibilityLabel={isHidden ? t('settings.showProduct') : t('settings.hideProduct')}
                  >
                    <Ionicons
                      name={isHidden ? 'eye-off-outline' : 'eye-outline'}
                      size={22}
                      color={isHidden ? colors.textHint : colors.primary}
                    />
                  </TouchableOpacity>
                  {isCustom(p.id) && (
                    <TouchableOpacity
                      onPress={() => handleDelete(p.id, p.label)}
                      style={styles.iconBtn}
                      accessibilityLabel={t('delete')}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {/* Add new product */}
            <Text style={styles.addTitle}>{t('settings.addProductTitle')}</Text>
            <View style={styles.addRow}>
              <TouchableOpacity
                style={styles.emojiInput}
                onPress={() => setEmojiTarget(NEW_TARGET)}
                accessibilityLabel={t('settings.productEmojiHint')}
              >
                <Text style={styles.emojiInputText}>{newEmoji || '📦'}</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.addNameInput}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('settings.productNamePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              <TextInput
                style={styles.shortInput}
                value={newShort}
                onChangeText={setNewShort}
                placeholder={t('settings.productShortPlaceholder')}
                placeholderTextColor={colors.textHint}
                maxLength={12}
              />
            </View>
            <TouchableOpacity
              onPress={handleAdd}
              style={[styles.addBtn, !newName.trim() && styles.addBtnDisabled]}
              disabled={!newName.trim()}
            >
              <Ionicons name="add" size={18} color={colors.textWhite} />
              <Text style={styles.addBtnText}>{t('settings.addProductBtn')}</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>

          {/* Emoji picker overlay */}
          {emojiTarget !== null && (
            <View style={styles.pickerBackdrop}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => {
                  setEmojiTarget(null);
                  setEmojiDraft('');
                }}
              />
              <View style={styles.pickerCard}>
                <Text style={styles.pickerTitle}>{t('settings.chooseEmoji')}</Text>
                <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
                  {EMOJI_CATEGORIES.map((cat) => (
                    <View key={cat.key} style={styles.pickerCategory}>
                      <Text style={styles.pickerCatTitle}>{t(`settings.emojiCat.${cat.key}`)}</Text>
                      <View style={styles.emojiGrid}>
                        {cat.emojis.map((e) => (
                          <TouchableOpacity
                            key={e}
                            style={styles.emojiChoice}
                            onPress={() => pickEmoji(e)}
                          >
                            <Text style={styles.emojiChoiceText}>{e}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}
                </ScrollView>
                <TextInput
                  style={styles.pickerInput}
                  value={emojiDraft}
                  onChangeText={setEmojiDraft}
                  placeholder={t('settings.typeEmoji')}
                  placeholderTextColor={colors.textHint}
                  maxLength={4}
                  onSubmitEditing={() => pickEmoji(emojiDraft)}
                  returnKeyType="done"
                />
              </View>
            </View>
          )}
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
      alignSelf: 'center',
      width: isTablet ? modalWidth : '100%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: s(16),
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: { fontSize: s(20), fontWeight: '700', color: colors.textPrimary },
    closeBtn: {
      width: s(32),
      height: s(32),
      borderRadius: s(16),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeBtnText: { fontSize: s(18), color: colors.textMuted },
    body: { padding: s(16) },
    subtitle: { fontSize: s(14), color: colors.textMuted, marginBottom: s(14) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: s(6),
      gap: s(8),
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
    },
    rowHidden: { opacity: 0.45 },
    reorderCol: { width: s(24), alignItems: 'center', justifyContent: 'center' },
    reorderBtn: { paddingVertical: s(1) },
    emojiTouch: {
      width: s(36),
      height: s(36),
      borderRadius: s(8),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sectionBackground,
    },
    emoji: { fontSize: s(22), textAlign: 'center' },
    nameInput: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    iconBtn: { padding: s(6) },
    addTitle: {
      fontSize: s(15),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginTop: s(22),
      marginBottom: s(10),
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: s(8) },
    emojiInput: {
      width: s(48),
      height: s(44),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    emojiInputText: { fontSize: s(22) },
    addNameInput: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    shortInput: {
      width: s(72),
      fontSize: s(15),
      textAlign: 'center',
      color: colors.textPrimary,
      paddingVertical: s(8),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(6),
      backgroundColor: colors.primary,
      paddingVertical: s(12),
      borderRadius: s(10),
      marginTop: s(12),
    },
    addBtnDisabled: { opacity: 0.5 },
    addBtnText: { color: colors.textWhite, fontSize: s(16), fontWeight: '700' },
    footer: {
      padding: s(16),
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    doneBtn: {
      backgroundColor: colors.sectionBackground,
      paddingVertical: s(14),
      borderRadius: s(12),
      alignItems: 'center',
    },
    doneBtnText: { color: colors.textPrimary, fontSize: s(17), fontWeight: '700' },
    pickerBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: s(24),
    },
    pickerCard: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.card,
      borderRadius: s(16),
      padding: s(16),
    },
    pickerTitle: {
      fontSize: s(16),
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: s(8),
    },
    pickerScroll: { maxHeight: 320 },
    pickerCategory: { marginBottom: s(10) },
    pickerCatTitle: {
      fontSize: s(12),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: s(6),
    },
    emojiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s(6),
    },
    emojiChoice: {
      width: s(44),
      height: s(44),
      borderRadius: s(10),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sectionBackground,
    },
    emojiChoiceText: { fontSize: s(24) },
    pickerInput: {
      marginTop: s(14),
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(10),
      paddingHorizontal: s(12),
      backgroundColor: colors.inputBackground,
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
  });
};

export default ProductCatalogModal;
