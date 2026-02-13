import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';
import { normalizePhone } from '../utils/helpers';

interface ClientCardProps {
  client: Client;
  index: number;
  isAdmin: boolean;
  onMarkDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const ClientCard: React.FC<ClientCardProps> = ({
  client,
  index,
  isAdmin,
  onMarkDone,
  onEdit,
  onDelete,
}) => {
  const productSummary = React.useMemo(() => {
    if (!client.products) return '';
    return Object.keys(client.products)
      .filter((k) => parseInt(String(client.products[k] || 0), 10) > 0)
      .map((k) => {
        const p = PRODUCTS.find((prod) => prod.id === k);
        return `${client.products[k]}x ${p ? p.short : k}`;
      })
      .join(', ');
  }, [client.products]);

  const sendWhatsApp = () => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    const msg = encodeURIComponent(
      'Buenas 🚚. Ya estamos en camino, sos el/la siguiente en la lista de entrega. ¡Nos vemos en unos minutos!\n\nAquapura',
    );
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${msg}`);
  };

  const openMaps = () => {
    if (client.lat && client.lng) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`,
      );
    } else if (client.mapsLink) {
      Linking.openURL(client.mapsLink);
    }
  };

  // --- NOTE CARD ---
  if (client.isNote) {
    return (
      <View style={[styles.card, styles.noteCard]}>
        <View style={styles.orderBadge}>
          <Text style={styles.orderText}>{index + 1}</Text>
        </View>
        <View style={styles.cardBody}>
          <View style={styles.headerRow}>
            <Text style={styles.noteLabel}>📝 NOTA</Text>
            <View style={styles.actions}>
              <TouchableOpacity onPress={onEdit} style={styles.iconBtn}>
                <Text>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
                <Text>🗑️</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.noteText}>{client.notes}</Text>
          <View style={styles.footerRow}>
            <Text style={styles.badge}>{client.specificDate || 'Una vez'}</Text>
            <TouchableOpacity style={styles.doneButton} onPress={onMarkDone}>
              <Text style={styles.doneButtonText}>✓ Listo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // --- CLIENT CARD ---
  return (
    <View
      style={[
        styles.card,
        (client.freq === 'once' || client.isStarred) && styles.cardOnce,
      ]}
    >
      <View style={styles.orderBadge}>
        <Text style={styles.orderText}>{index + 1}</Text>
      </View>
      <View style={styles.cardBody}>
        {/* Toolbar */}
        <View style={styles.toolbar}>
          <TouchableOpacity onPress={sendWhatsApp} style={styles.iconBtn}>
            <Text>💬</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openMaps} style={styles.iconBtn}>
            <Text>📍</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onEdit} style={styles.iconBtn}>
            <Text>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
            <Text>🗑️</Text>
          </TouchableOpacity>
        </View>

        {/* Client info */}
        <Text style={styles.clientName}>
          {(client.name || '').toUpperCase()}
        </Text>
        <Text style={styles.clientAddress}>{client.address}</Text>

        {/* Products */}
        {productSummary ? (
          <View style={styles.productsRow}>
            <Text style={styles.productsText}>📦 {productSummary}</Text>
          </View>
        ) : null}

        {/* Notes */}
        {client.notes ? (
          <Text style={styles.notesText}>💬 {client.notes}</Text>
        ) : null}

        {/* Footer */}
        <View style={styles.footerRow}>
          <Text style={styles.badge}>
            {client.freq === 'once'
              ? client.specificDate || 'Una vez'
              : client.freq === 'weekly'
                ? 'Semanal'
                : client.freq === 'biweekly'
                  ? 'Quincenal'
                  : client.freq === 'triweekly'
                    ? 'Cada 3 sem'
                    : 'Mensual'}
          </Text>
          <TouchableOpacity style={styles.doneButton} onPress={onMarkDone}>
            <Text style={styles.doneButtonText}>✓ Listo</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  noteCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#FBBF24',
    backgroundColor: '#FFFBEB',
  },
  cardOnce: {
    borderLeftWidth: 4,
    borderLeftColor: '#F97316',
    backgroundColor: '#FFF7ED',
  },
  orderBadge: {
    width: 40,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#F3F4F6',
  },
  orderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
  },
  cardBody: {
    flex: 1,
    padding: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
    textTransform: 'uppercase',
  },
  noteText: {
    fontSize: 14,
    color: '#1F2937',
    lineHeight: 20,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 6,
  },
  clientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  clientAddress: {
    fontSize: 12,
    color: '#6B7280',
  },
  productsRow: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  productsText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  notesText: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  doneButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default React.memo(ClientCard);
