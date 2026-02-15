import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Client } from '../types';

interface ProductCounterProps {
  clients: Client[];
}

const COUNTER_PRODUCTS = [
  { id: 'b20', label: '20L', icon: '💧' },
  { id: 'b12', label: '12L', icon: '💧' },
  { id: 'b6', label: '6L', icon: '💧' },
  { id: 'soda', label: 'Soda', icon: '🍾' },
  { id: 'bombita', label: 'Bomb', icon: '🖐️' },
];

const ProductCounter: React.FC<ProductCounterProps> = ({ clients }) => {
  const totals = React.useMemo(() => {
    const result: Record<string, number> = {};
    COUNTER_PRODUCTS.forEach((p) => {
      result[p.id] = 0;
    });
    clients.forEach((c) => {
      if (!c.products) return;
      COUNTER_PRODUCTS.forEach((p) => {
        const qty = parseInt(String(c.products[p.id] || 0), 10);
        if (qty > 0) result[p.id] += qty;
      });
    });
    return result;
  }, [clients]);

  const hasAny = Object.values(totals).some((v) => v > 0);
  if (!hasAny) return null;

  return (
    <View style={styles.container}>
      {COUNTER_PRODUCTS.map((p) =>
        totals[p.id] > 0 ? (
          <View key={p.id} style={styles.item}>
            <Text style={styles.qty}>{totals[p.id]}</Text>
            <Text style={styles.label}>{p.label}</Text>
          </View>
        ) : null,
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
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
