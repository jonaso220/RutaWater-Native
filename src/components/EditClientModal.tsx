import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';
import { FREQUENCY_LABELS, Frequency } from '../constants/products';

interface EditClientModalProps {
  visible: boolean;
  client: Client | null;
  onSave: (clientId: string, data: Partial<Client>) => void;
  onClose: () => void;
}

const EditClientModal: React.FC<EditClientModalProps> = ({
  visible,
  client,
  onSave,
  onClose,
}) => {
  const [products, setProducts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [freq, setFreq] = useState<Frequency>('weekly');

  useEffect(() => {
    if (client) {
      // Initialize products from client data
      const prods: Record<string, number> = {};
      PRODUCTS.forEach((p) => {
        prods[p.id] = parseInt(String(client.products?.[p.id] || 0), 10);
      });
      setProducts(prods);
      setNotes(client.notes || '');
      setFreq(client.freq || 'weekly');
    }
  }, [client]);

  if (!client) return null;

  const handleSave = () => {
    const cleanProducts: Record<string, number> = {};
    Object.entries(products).forEach(([key, val]) => {
      if (val > 0) cleanProducts[key] = val;
    });
    onSave(client.id, {
      products: cleanProducts,
      notes,
      freq,
    });
    onClose();
  };

  const adjustQty = (productId: string, delta: number) => {
    setProducts((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {(client.name || '').toUpperCase()}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Products */}
            <Text style={styles.sectionTitle}>Productos</Text>
            {PRODUCTS.map((p) => (
              <View key={p.id} style={styles.productRow}>
                <Text style={styles.productLabel}>
                  {p.icon} {p.label}
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
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Notas</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Notas del cliente..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
            />

            {/* Frequency */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
              Frecuencia
            </Text>
            <View style={styles.freqGrid}>
              {(Object.entries(FREQUENCY_LABELS) as [Frequency, string][]).map(
                ([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setFreq(key)}
                    style={[
                      styles.freqChip,
                      freq === key && styles.freqChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.freqChipText,
                        freq === key && styles.freqChipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                ),
              )}
            </View>
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: '#6B7280',
  },
  body: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  productLabel: {
    fontSize: 14,
    color: '#374151',
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
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnPlus: {
    backgroundColor: '#2563EB',
  },
  qtyBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
  },
  qtyBtnPlusText: {
    color: '#FFFFFF',
  },
  qtyValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    minWidth: 24,
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    textAlignVertical: 'top',
    minHeight: 80,
  },
  freqGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  freqChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  freqChipSelected: {
    backgroundColor: '#2563EB',
  },
  freqChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  freqChipTextSelected: {
    color: '#FFFFFF',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  saveBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default EditClientModal;
