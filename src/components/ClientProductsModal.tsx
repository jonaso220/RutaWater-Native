import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Client } from '../types';
import { useProducts } from '../stores/productCatalogStore';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { getModalWidth } from '../utils/helpers';
import ModalOverlay from './ModalOverlay';
import { ProductLabel } from './ProductIcon';

interface ClientProductsModalProps {
  visible: boolean;
  client: Client | null;
  onSave: (clientId: string, data: Partial<Client>) => Promise<boolean>;
  onClose: () => void;
}

const ClientProductsModal: React.FC<ClientProductsModalProps> = ({
  visible,
  client,
  onSave,
  onClose,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const { fontScale } = useLayout();
  const productsCatalog = useProducts();
  const styles = useMemo(
    () => getStyles(colors, width >= 600, getModalWidth(width), fontScale),
    [colors, fontScale, width],
  );
  const [products, setProducts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!visible || !client) return;
    const nextProducts: Record<string, number> = {};
    Object.entries(client.products || {}).forEach(([id, quantity]) => {
      nextProducts[id] = parseInt(String(quantity || 0), 10) || 0;
    });
    productsCatalog.forEach((product) => {
      if (nextProducts[product.id] === undefined) nextProducts[product.id] = 0;
    });
    setProducts(nextProducts);
    setSaving(false);
    savingRef.current = false;
  }, [client?.id, productsCatalog, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!client) return null;

  const adjustQuantity = (productId: string, delta: number) => {
    setProducts((current) => ({
      ...current,
      [productId]: Math.max(0, (current[productId] || 0) + delta),
    }));
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const cleanProducts: Record<string, number> = {};
    Object.entries(products).forEach(([id, quantity]) => {
      if (quantity > 0) cleanProducts[id] = quantity;
    });
    let saved = false;
    try {
      saved = await onSave(client.id, { products: cleanProducts });
    } catch {
      saved = false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (!saved) {
      Alert.alert(t('error'), t('clientProductsModal.saveError'));
      return;
    }
    onClose();
  };

  const requestClose = () => {
    if (!savingRef.current) onClose();
  };

  return (
    <ModalOverlay visible={visible} onClose={requestClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>{t('editModal.products')}</Text>
              <Text style={styles.title} numberOfLines={1}>{client.name}</Text>
            </View>
            <TouchableOpacity
              onPress={requestClose}
              disabled={saving}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {productsCatalog.map((product) => (
              <View key={product.id} style={styles.productRow}>
                <ProductLabel
                  value={product.emoji}
                  label={product.label}
                  size={Math.round(18 * fontScale)}
                  style={styles.productLabel}
                  containerStyle={styles.productLabelContainer}
                />
                <View style={styles.quantityControls}>
                  <TouchableOpacity
                    onPress={() => adjustQuantity(product.id, -1)}
                    disabled={saving}
                    style={styles.quantityButton}
                    accessibilityRole="button"
                    accessibilityLabel={`${product.label}: -1`}
                  >
                    <Ionicons name="remove" size={19} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={styles.quantityValue}>{products[product.id] || 0}</Text>
                  <TouchableOpacity
                    onPress={() => adjustQuantity(product.id, 1)}
                    disabled={saving}
                    style={[styles.quantityButton, styles.quantityButtonAdd]}
                    accessibilityRole="button"
                    accessibilityLabel={`${product.label}: +1`}
                  >
                    <Ionicons name="add" size={19} color={colors.textWhite} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t('clientProductsModal.save')}
            >
              <Text style={styles.saveButtonText}>{t('clientProductsModal.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth: number | undefined, scale: number) => {
  const s = (value: number) => Math.round(value * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.overlay,
      padding: s(16),
    },
    modal: {
      width: modalWidth || '100%',
      maxHeight: isTablet ? '82%' : '88%',
      backgroundColor: colors.modalBackground,
      borderRadius: s(20),
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: s(16),
      paddingVertical: s(14),
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerCopy: { flex: 1 },
    eyebrow: {
      color: colors.primary,
      fontSize: s(12),
      fontWeight: '800',
      textTransform: 'uppercase',
      marginBottom: s(2),
    },
    title: {
      color: colors.textPrimary,
      fontSize: s(18),
      fontWeight: '800',
    },
    closeButton: {
      width: s(34),
      height: s(34),
      borderRadius: s(17),
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.sectionBackground,
    },
    body: { paddingHorizontal: s(16) },
    productRow: {
      minHeight: s(54),
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
      gap: s(12),
    },
    productLabelContainer: {
      flex: 1,
      minWidth: 0,
    },
    productLabel: {
      flexShrink: 1,
      fontSize: s(15),
      color: colors.textSecondary,
    },
    quantityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      gap: s(10),
    },
    quantityButton: {
      width: s(34),
      height: s(34),
      borderRadius: s(10),
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.sectionBackground,
    },
    quantityButtonAdd: { backgroundColor: colors.primary },
    quantityValue: {
      minWidth: s(24),
      textAlign: 'center',
      color: colors.textPrimary,
      fontSize: s(17),
      fontWeight: '800',
    },
    footer: {
      padding: s(16),
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    saveButton: {
      minHeight: s(48),
      borderRadius: s(12),
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.primary,
    },
    saveButtonText: {
      color: colors.textWhite,
      fontSize: s(16),
      fontWeight: '800',
    },
    buttonDisabled: { opacity: 0.6 },
  });
};

export default ClientProductsModal;
