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
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth);

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

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: isTablet ? 'center' : 'flex-end',
      alignItems: 'center',
      paddingHorizontal: isTablet ? 24 : 8,
      paddingVertical: isTablet ? 24 : 0,
    },
    modal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderBottomLeftRadius: isTablet ? 20 : 0,
      borderBottomRightRadius: isTablet ? 20 : 0,
      maxHeight: Platform.OS === 'android' ? '100%' : '90%',
      maxWidth: isTablet ? undefined : 600,
      alignSelf: 'center',
      width: isTablet ? modalWidth : '100%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeBtnText: { fontSize: 18, color: colors.textMuted },
    body: { padding: 16 },
    subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 14 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
    },
    rowHidden: { opacity: 0.45 },
    reorderCol: { width: 24, alignItems: 'center', justifyContent: 'center' },
    reorderBtn: { paddingVertical: 1 },
    emojiTouch: {
      width: 36,
      height: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sectionBackground,
    },
    emoji: { fontSize: 22, textAlign: 'center' },
    nameInput: {
      flex: 1,
      fontSize: 16,
      color: colors.textPrimary,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: colors.inputBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    iconBtn: { padding: 6 },
    addTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginTop: 22,
      marginBottom: 10,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    emojiInput: {
      width: 48,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inputBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    emojiInputText: { fontSize: 22 },
    addNameInput: {
      flex: 1,
      fontSize: 16,
      color: colors.textPrimary,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: colors.inputBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    shortInput: {
      width: 72,
      fontSize: 15,
      textAlign: 'center',
      color: colors.textPrimary,
      paddingVertical: 8,
      backgroundColor: colors.inputBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 12,
    },
    addBtnDisabled: { opacity: 0.5 },
    addBtnText: { color: colors.textWhite, fontSize: 16, fontWeight: '700' },
    footer: {
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    doneBtn: {
      backgroundColor: colors.sectionBackground,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    doneBtnText: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    pickerBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    pickerCard: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    pickerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    pickerScroll: { maxHeight: 320 },
    pickerCategory: { marginBottom: 10 },
    pickerCatTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    emojiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    emojiChoice: {
      width: 44,
      height: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sectionBackground,
    },
    emojiChoiceText: { fontSize: 24 },
    pickerInput: {
      marginTop: 14,
      fontSize: 16,
      color: colors.textPrimary,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.inputBackground,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
  });

export default ProductCatalogModal;
