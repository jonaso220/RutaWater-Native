import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface ProductCounterProps {
  clients: Client[];
}

const ProductCounter: React.FC<ProductCounterProps> = ({ clients }) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = getStyles(colors);

  const totals = React.useMemo(() => {
    const result: Record<string, number> = {};
    PRODUCTS.forEach((p) => {
      result[p.id] = 0;
    });
    clients.forEach((c) => {
      if (!c.products) return;
      PRODUCTS.forEach((p) => {
        const qty = parseInt(String(c.products[p.id] || 0), 10);
        if (qty > 0) result[p.id] += qty;
      });
    });
    return result;
  }, [clients]);

  const hasAny = Object.values(totals).some((v) => v > 0);
  if (!hasAny) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {PRODUCTS.map((p) => {
        if (totals[p.id] <= 0) return null;
        const isSoda = p.id === 'soda';
        // Soda is delivered by the crate (6 sifones), so the crate count is the
        // number actually loaded onto the truck — show it big, sifones in parens.
        const bigValue = isSoda ? Math.ceil(totals[p.id] / 6) : totals[p.id];
        const bigLabel = isSoda ? t('productCounter.crate') : p.short;
        return (
          <View key={p.id} style={styles.item}>
            <Text style={styles.qty}>{bigValue}</Text>
            <Text style={styles.label}>{bigLabel}</Text>
            {isSoda && (
              <Text style={styles.crateLabel}>({totals[p.id]} {p.short})</Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.primaryLighter,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight,
  },
  content: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  qty: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primary,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  crateLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textHint,
  },
});

export default React.memo(ProductCounter);
