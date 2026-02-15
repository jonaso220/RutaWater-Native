import React, { useState } from 'react';
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
  Alert,
} from 'react-native';
import { PRODUCTS } from '../constants/products';

interface AddClientModalProps {
  visible: boolean;
  day: string;
  onSave: (
    name: string,
    address: string,
    phone: string,
    day: string,
    products: Record<string, number>,
    notes: string,
  ) => Promise<void>;
  onClose: () => void;
}

type Destination = 'day' | 'directory';

const AddClientModal: React.FC<AddClientModalProps> = ({
  visible,
  day,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Record<string, number>>({});
  const [destination, setDestination] = useState<Destination>('day');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName('');
    setAddress('');
    setPhone('');
    setNotes('');
    setProducts({});
    setDestination('day');
    setSaving(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const adjustQty = (productId: string, delta: number) => {
    setProducts((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre del cliente es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      const targetDay = destination === 'directory' ? '' : day;
      await onSave(name.trim(), address.trim(), phone.trim(), targetDay, products, notes.trim());
      resetForm();
      onClose();
    } catch (e) {
      Alert.alert('Error', 'No se pudo guardar el cliente.');
    } finally {
      setSaving(false);
    }
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
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Nuevo Cliente</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Destination toggle */}
            <Text style={styles.sectionTitle}>Destino</Text>
            <View style={styles.destRow}>
              <TouchableOpacity
                style={[styles.destChip, destination === 'day' && styles.destChipSelected]}
                onPress={() => setDestination('day')}
              >
                <Text style={[styles.destChipText, destination === 'day' && styles.destChipTextSelected]}>
                  {day}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.destChip, destination === 'directory' && styles.destChipDirectory]}
                onPress={() => setDestination('directory')}
              >
                <Text style={[styles.destChipText, destination === 'directory' && styles.destChipTextDirectory]}>
                  Solo Directorio
                </Text>
              </TouchableOpacity>
            </View>

            {/* Name */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Nombre *</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="Nombre del cliente"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
            />

            {/* Address */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Direccion</Text>
            <TextInput
              style={styles.textInput}
              value={address}
              onChangeText={setAddress}
              placeholder="Direccion"
              placeholderTextColor="#9CA3AF"
            />

            {/* Phone */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Telefono</Text>
            <TextInput
              style={styles.textInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="Telefono"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
            />

            {/* Products */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Productos</Text>
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
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving
                  ? 'Guardando...'
                  : destination === 'directory'
                    ? 'Agregar al Directorio'
                    : `Agregar a ${day}`}
              </Text>
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
    maxHeight: '90%',
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
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
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
    marginBottom: 8,
  },
  destRow: {
    flexDirection: 'row',
    gap: 8,
  },
  destChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  destChipSelected: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  destChipDirectory: {
    backgroundColor: '#FFF7ED',
    borderColor: '#F97316',
  },
  destChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  destChipTextSelected: {
    color: '#1D4ED8',
  },
  destChipTextDirectory: {
    color: '#EA580C',
  },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
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
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default AddClientModal;
