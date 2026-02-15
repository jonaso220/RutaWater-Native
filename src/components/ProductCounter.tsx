import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';

interface ProductCounterProps {
  clients: Client[];
}

const ProductCounter: React.FC<ProductCounterProps> = ({ clients }) => {
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

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: '#EFF6FF',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
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
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  qty: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2563EB',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
  },
});

export default React.memo(ProductCounter);
