import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { Client } from '../types';
import { useAllProducts } from '../stores/productCatalogStore';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { WIDE_CONTENT_MAX_WIDTH } from '../constants/layout';
import { calculateProductTotals } from '../utils/productCounter';

interface ProductCounterProps {
  clients: Client[];
  /** Fecha de esos clientes ("hoy", "mañana", "mié 30"): la barra suma la primera fecha de la lista. */
  whenLabel: string;
  fontScale?: number;
  compact?: boolean;
}

const ProductCounter: React.FC<ProductCounterProps> = ({ clients, whenLabel, fontScale = 1, compact = false }) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = React.useMemo(() => getStyles(colors, fontScale, compact), [colors, fontScale, compact]);
  const s = (v: number) => Math.round(v * fontScale);
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
      <View style={styles.row}>
      {/* Título en dos líneas chicas a la izquierda: no suma altura a la barra
          y queda fijo mientras los productos se deslizan. */}
      <View
        style={styles.title}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${t('productCounter.title')} ${whenLabel}`}
      >
        <MaterialCommunityIcons name="truck-delivery-outline" size={s(compact ? 15 : 17)} color={colors.primary} />
        <View>
          <Text style={styles.titleText} numberOfLines={1}>{t('productCounter.title')}</Text>
          <Text style={styles.whenText} numberOfLines={1}>{whenLabel}</Text>
        </View>
      </View>
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
            ? t('productCounter.crate', { count: bigValue })
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
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1, compact = false) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  wrapper: {
    backgroundColor: colors.primaryLighter,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight,
  },
  row: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    marginLeft: s(12),
    paddingRight: s(8),
    borderRightWidth: 1,
    borderRightColor: colors.primaryLight,
  },
  titleText: {
    fontSize: s(11),
    lineHeight: s(13),
    fontWeight: '700',
    color: colors.primary,
  },
  whenText: {
    fontSize: s(11),
    lineHeight: s(13),
    fontWeight: '500',
    color: colors.textMuted,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingLeft: s(8),
    paddingRight: s(12),
    paddingVertical: s(compact ? 4 : 10),
    gap: s(8),
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    paddingHorizontal: s(10),
    paddingVertical: s(compact ? 3 : 6),
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  qty: {
    fontSize: s(compact ? 17 : 20),
    fontWeight: '800',
    color: colors.primary,
  },
  label: {
    fontSize: s(compact ? 14 : 16),
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
