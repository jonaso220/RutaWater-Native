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
    mapsLink: string,
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
  const [mapsLink, setMapsLink] = useState('');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Record<string, number>>({});
  const [destination, setDestination] = useState<Destination>('day');
  const [saving, setSaving] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const parseOrderText = (text: string) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    let parsedName = '';
    let parsedAddress = '';
    let parsedPhone = '';
    let parsedMapsLink = '';
    const parsedProducts: Record<string, number> = {};
    const noteParts: string[] = [];

    let inProductSection = false;

    for (const line of lines) {
      // Skip header
      if (/^pedido de cliente/i.test(line)) continue;

      // Name
      if (/^nombre\s*:/i.test(line)) {
        parsedName = line.replace(/^nombre\s*:\s*/i, '').trim();
        inProductSection = false;
        continue;
      }

      // Address (Dirección / Direccion)
      if (/^direcci[oó]n\s*:/i.test(line)) {
        parsedAddress = line.replace(/^direcci[oó]n\s*:\s*/i, '').trim();
        inProductSection = false;
        continue;
      }

      // Esquina - append to address
      if (/^esquina\s*:/i.test(line)) {
        const esquina = line.replace(/^esquina\s*:\s*/i, '').trim();
        if (esquina) {
          parsedAddress = parsedAddress ? `${parsedAddress} esq. ${esquina}` : esquina;
        }
        inProductSection = false;
        continue;
      }

      // Phone (Teléfono / Telefono)
      if (/^tel[eé]fono\s*:/i.test(line)) {
        parsedPhone = line.replace(/^tel[eé]fono\s*:\s*/i, '').trim();
        inProductSection = false;
        continue;
      }

      // URL (Google Maps link)
      if (/https?:\/\//.test(line)) {
        const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          parsedMapsLink = urlMatch[1];
        }
        inProductSection = false;
        continue;
      }

      // Product section header
      if (/^producto\s*:/i.test(line)) {
        inProductSection = true;
        continue;
      }

      // Detalle line
      if (/^detalle\s*:/i.test(line)) {
        const detail = line.replace(/^detalle\s*:\s*/i, '').trim();
        if (detail) {
          noteParts.push(detail);
        }
        continue;
      }

      // Parse product lines: "Bidon: 20Lts 2" or "Bidon: 12Lts 1" or "Soda: 0"
      if (inProductSection) {
        const bidonMatch = line.match(/^bid[oó]n\s*:\s*(\d+)\s*(?:lts?|litros?)?\s+(\d+)/i);
        if (bidonMatch) {
          const liters = parseInt(bidonMatch[1], 10);
          const qty = parseInt(bidonMatch[2], 10);
          if (qty > 0) {
            if (liters === 20) parsedProducts.b20 = (parsedProducts.b20 || 0) + qty;
            else if (liters === 12) parsedProducts.b12 = (parsedProducts.b12 || 0) + qty;
            else if (liters === 6) parsedProducts.b6 = (parsedProducts.b6 || 0) + qty;
          }
          continue;
        }

        const sodaMatch = line.match(/^soda\s*:\s*(\d+)/i);
        if (sodaMatch) {
          const qty = parseInt(sodaMatch[1], 10);
          if (qty > 0) parsedProducts.soda = qty;
          continue;
        }

        const bombitaMatch = line.match(/^bombita\s*:\s*(\d+)/i);
        if (bombitaMatch) {
          const qty = parseInt(bombitaMatch[1], 10);
          if (qty > 0) parsedProducts.bombita = qty;
          continue;
        }

        const dispElecNewMatch = line.match(/^disp(?:ensador)?\s*(?:elec(?:trico|\.)?)\s*(?:nuevo)\s*:\s*(\d+)/i);
        if (dispElecNewMatch) {
          const qty = parseInt(dispElecNewMatch[1], 10);
          if (qty > 0) parsedProducts.disp_elec_new = qty;
          continue;
        }

        const dispElecChgMatch = line.match(/^disp(?:ensador)?\s*(?:elec(?:trico|\.)?)\s*(?:cambio)\s*:\s*(\d+)/i);
        if (dispElecChgMatch) {
          const qty = parseInt(dispElecChgMatch[1], 10);
          if (qty > 0) parsedProducts.disp_elec_chg = qty;
          continue;
        }

        const dispNatMatch = line.match(/^disp(?:ensador)?\s*(?:natural|nat\.?)\s*:\s*(\d+)/i);
        if (dispNatMatch) {
          const qty = parseInt(dispNatMatch[1], 10);
          if (qty > 0) parsedProducts.disp_nat = qty;
          continue;
        }
      }
    }

    // Apply parsed values
    if (parsedName) setName(parsedName);
    if (parsedAddress) setAddress(parsedAddress);
    if (parsedPhone) setPhone(parsedPhone);
    if (parsedMapsLink) setMapsLink(parsedMapsLink);
    if (Object.keys(parsedProducts).length > 0) setProducts(parsedProducts);
    if (noteParts.length > 0) setNotes(noteParts.join('\n'));
  };

  const handlePasteOrder = () => {
    if (!pasteText.trim()) {
      setShowPasteModal(false);
      return;
    }
    parseOrderText(pasteText);
    setPasteText('');
    setShowPasteModal(false);
  };

  const resetForm = () => {
    setName('');
    setAddress('');
    setPhone('');
    setMapsLink('');
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
      await onSave(name.trim(), address.trim(), phone.trim(), targetDay, products, notes.trim(), mapsLink.trim());
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
            <TouchableOpacity onPress={() => setShowPasteModal(true)} style={styles.pasteBtn}>
              <Text style={styles.pasteBtnText}>📋 Pegar Pedido</Text>
            </TouchableOpacity>
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

            {/* Maps Link */}
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>URL Google Maps</Text>
            <TextInput
              style={styles.textInput}
              value={mapsLink}
              onChangeText={setMapsLink}
              placeholder="https://maps.app.goo.gl/..."
              placeholderTextColor="#9CA3AF"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
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

      {/* Paste Order Modal */}
      <Modal visible={showPasteModal} animationType="fade" transparent>
        <View style={styles.pasteOverlay}>
          <View style={styles.pasteModal}>
            <Text style={styles.pasteModalTitle}>Pegar Pedido</Text>
            <Text style={styles.pasteModalHint}>
              Pega el texto del pedido y se completaran los campos automaticamente
            </Text>
            <TextInput
              style={styles.pasteInput}
              value={pasteText}
              onChangeText={setPasteText}
              placeholder="Pegar texto del pedido aqui..."
              placeholderTextColor="#9CA3AF"
              multiline
              autoFocus
            />
            <View style={styles.pasteActions}>
              <TouchableOpacity
                style={styles.pasteCancelBtn}
                onPress={() => { setPasteText(''); setShowPasteModal(false); }}
              >
                <Text style={styles.pasteCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pasteConfirmBtn} onPress={handlePasteOrder}>
                <Text style={styles.pasteConfirmText}>Procesar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  pasteBtn: {
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  pasteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16A34A',
  },
  pasteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pasteModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
  },
  pasteModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  pasteModalHint: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  pasteInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    textAlignVertical: 'top',
    minHeight: 200,
    maxHeight: 300,
  },
  pasteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  pasteCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  pasteCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  pasteConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563EB',
  },
  pasteConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default AddClientModal;
