import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface ProductCounterProps {
  clients: Client[];
}

const ProductCounter: React.FC<ProductCounterProps> = ({ clients }) => {
  const { colors, isDark } = useTheme();
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
      {PRODUCTS.map((p) =>
        totals[p.id] > 0 ? (
          <View key={p.id} style={styles.item}>
            <Text style={styles.qty}>{totals[p.id]}</Text>
            <Text style={styles.label}>{p.short}</Text>
          </View>
        ) : null,
      )}
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  qty: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
});

export default React.memo(ProductCounter);
