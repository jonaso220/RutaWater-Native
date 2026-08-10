import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Client } from '../types';
import { useAllProducts } from '../stores/productCatalogStore';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { WIDE_CONTENT_MAX_WIDTH } from '../constants/layout';
import { calculateProductTotals } from '../utils/productCounter';

interface ProductCounterProps {
  clients: Client[];
  fontScale?: number;
}

const ProductCounter: React.FC<ProductCounterProps> = ({ clients, fontScale = 1 }) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = React.useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);
  // Existing scheduled quantities must remain in the truck load even after a
  // product is hidden from pickers.
  const products = useAllProducts();

  const totals = React.useMemo(
    () => calculateProductTotals(clients, products),
    [clients, products],
  );
  const displayProductIds = React.useMemo(() => {
    const knownIds = new Set(products.map((product) => product.id));
    return [
      ...products.map((product) => product.id),
      ...Object.keys(totals).filter((productId) => !knownIds.has(productId)).sort(),
    ];
  }, [products, totals]);
  const productsById = React.useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const hasAny = Object.values(totals).some((v) => v > 0);
  if (!hasAny) return null;

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {displayProductIds.map((productId) => {
          if (totals[productId] <= 0) return null;
          const product = productsById.get(productId);
          const isSoda = productId === 'soda';
          // Soda is delivered by the crate (6 sifones), so the crate count is the
          // number actually loaded onto the truck — show it big, sifones in parens.
          const bigValue = isSoda ? Math.ceil(totals[productId] / 6) : totals[productId];
          const bigLabel = isSoda
            ? t('productCounter.crate')
            : product?.short || `${t('productCounter.notInCatalog')} · ${productId.slice(-4)}`;
          return (
            <View key={productId} style={styles.item}>
              <Text style={styles.qty}>{bigValue}</Text>
              <Text style={[styles.label, !product && styles.missingLabel]}>{bigLabel}</Text>
              {isSoda && (
                <Text style={styles.crateLabel}>({totals[productId]} {product?.short})</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  wrapper: {
    backgroundColor: colors.primaryLighter,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight,
  },
  container: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
  content: {
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    gap: s(10),
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  qty: {
    fontSize: s(20),
    fontWeight: '800',
    color: colors.primary,
  },
  label: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.textMuted,
  },
  missingLabel: {
    color: colors.danger,
  },
  crateLabel: {
    fontSize: s(12),
    fontWeight: '500',
    color: colors.textHint,
  },
  });
};

export default React.memo(ProductCounter);
