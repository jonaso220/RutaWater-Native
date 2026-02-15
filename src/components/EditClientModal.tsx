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
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface EditClientModalProps {
  visible: boolean;
  client: Client | null;
  onSave: (clientId: string, data: Partial<Client>) => void;
  onClose: () => void;
  showClientInfo?: boolean;
}

const EditClientModal: React.FC<EditClientModalProps> = ({
  visible,
  client,
  onSave,
  onClose,
  showClientInfo = false,
}) => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  const [products, setProducts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [freq, setFreq] = useState<Frequency>('weekly');

  useEffect(() => {
    if (client) {
      setName(client.name || '');
      setAddress(client.address || '');
      setPhone(client.phone || '');
      setMapsLink(client.mapsLink || '');
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
    const data: Partial<Client> = {
      products: cleanProducts,
      notes,
      freq,
    };
    if (showClientInfo) {
      data.name = name.trim();
      data.address = address.trim();
      data.phone = phone.trim();
      data.mapsLink = mapsLink.trim();
    }
    onSave(client.id, data);
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
              {showClientInfo ? 'Editar Cliente' : (client.name || '').toUpperCase()}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {showClientInfo && (
              <>
                <Text style={styles.sectionTitle}>Datos del cliente</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={name}
                  onChangeText={setName}
                  placeholder="Nombre"
                  placeholderTextColor={colors.textHint}
                />
                <TextInput
                  style={styles.fieldInput}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Direccion"
                  placeholderTextColor={colors.textHint}
                />
                <TextInput
                  style={styles.fieldInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Telefono"
                  placeholderTextColor={colors.textHint}
                  keyboardType="phone-pad"
                />
                <TextInput
                  style={styles.fieldInput}
                  value={mapsLink}
                  onChangeText={setMapsLink}
                  placeholder="URL Google Maps"
                  placeholderTextColor={colors.textHint}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            )}

            {/* Products */}
            <Text style={[styles.sectionTitle, showClientInfo && { marginTop: 20 }]}>Productos</Text>
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
              placeholderTextColor={colors.textHint}
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

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.card,
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
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: colors.textMuted,
  },
  body: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  fieldInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: 10,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.sectionBackground,
  },
  productLabel: {
    fontSize: 14,
    color: colors.textSecondary,
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
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnPlus: {
    backgroundColor: colors.primary,
  },
  qtyBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  qtyBtnPlusText: {
    color: colors.textWhite,
  },
  qtyValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
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
    backgroundColor: colors.sectionBackground,
  },
  freqChipSelected: {
    backgroundColor: colors.primary,
  },
  freqChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  freqChipTextSelected: {
    color: colors.textWhite,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: colors.textWhite,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default EditClientModal;
