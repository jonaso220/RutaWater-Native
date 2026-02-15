import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';
import { normalizePhone } from '../utils/helpers';

interface ClientCardProps {
  client: Client;
  index: number;
  isAdmin: boolean;
  hasDebt?: boolean;
  hasPendingTransfer?: boolean;
  onMarkDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDebt?: () => void;
  onToggleStar?: () => void;
  onTransfer?: () => void;
  onAlarm?: () => void;
  onChangePosition?: (newPosition: number) => void;
}

const ClientCard: React.FC<ClientCardProps> = ({
  client,
  index,
  isAdmin,
  hasDebt,
  hasPendingTransfer,
  onMarkDone,
  onEdit,
  onDelete,
  onDebt,
  onToggleStar,
  onTransfer,
  onAlarm,
  onChangePosition,
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

  const handleOrderTap = () => {
    if (!onChangePosition) return;
    Alert.prompt?.(
      'Cambiar posicion',
      `Posicion actual: ${index + 1}\nIngresa la nueva posicion:`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mover',
          onPress: (text?: string) => {
            const num = parseInt(text || '', 10);
            if (num > 0) {
              onChangePosition(num);
            }
          },
        },
      ],
      'plain-text',
      String(index + 1),
      'number-pad',
    );
  };

  const sendEnCamino = () => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    const msg = encodeURIComponent(
      'Buenas 🚚. Ya estamos en camino, sos el/la siguiente en la lista de entrega. ¡Nos vemos en unos minutos!\n\nAquapura',
    );
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}&text=${msg}`);
  };

  const openWhatsAppCamera = () => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
  };

  const callClient = () => {
    if (!client.phone) return;
    Linking.openURL(`tel:${client.phone}`);
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

  const hasLocation = !!(client.lat && client.lng) || !!client.mapsLink;

  // --- NOTE CARD ---
  if (client.isNote) {
    return (
      <View style={[styles.card, styles.noteCard]}>
        <TouchableOpacity style={styles.orderBadge} onPress={handleOrderTap} activeOpacity={0.6}>
          <Text style={styles.orderText}>{index + 1}</Text>
        </TouchableOpacity>
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
          <View style={styles.actionBar}>
            <Text style={styles.badge}>{client.specificDate || 'Una vez'}</Text>
            <View style={{ flex: 1 }} />
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
        client.isStarred && styles.cardStarred,
        (client.freq === 'once') && styles.cardOnce,
      ]}
    >
      <TouchableOpacity style={styles.orderBadge} onPress={handleOrderTap} activeOpacity={0.6}>
        <Text style={styles.orderText}>{index + 1}</Text>
      </TouchableOpacity>
      <View style={styles.cardBody}>
        {/* Toolbar */}
        <View style={styles.toolbar}>
          {onToggleStar && (
            <TouchableOpacity onPress={onToggleStar} style={styles.iconBtn}>
              <Text>{client.isStarred ? '⭐' : '☆'}</Text>
            </TouchableOpacity>
          )}
          {onDebt && (
            <TouchableOpacity onPress={onDebt} style={styles.iconBtn}>
              <Text>{hasDebt ? '🔴' : '💰'}</Text>
            </TouchableOpacity>
          )}
          {onTransfer && (
            <TouchableOpacity onPress={onTransfer} style={styles.iconBtn}>
              <Text>{hasPendingTransfer ? '🟢' : '🏦'}</Text>
            </TouchableOpacity>
          )}
          {onAlarm && (
            <TouchableOpacity onPress={onAlarm} style={styles.iconBtn}>
              <Text>{client.alarm ? '🔔' : '🔕'}</Text>
            </TouchableOpacity>
          )}
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

        {/* Badges row */}
        <View style={styles.badgesRow}>
          {hasDebt && (
            <TouchableOpacity onPress={onDebt}>
              <Text style={styles.debtBadge}>💰 Deuda</Text>
            </TouchableOpacity>
          )}
          {hasPendingTransfer && (
            <Text style={styles.transferBadge}>🏦 Transferencia</Text>
          )}
          {client.alarm ? (
            <Text style={styles.alarmBadge}>🔔 {client.alarm}</Text>
          ) : null}
        </View>

        {/* Address with location button */}
        {hasLocation ? (
          <TouchableOpacity onPress={openMaps} style={styles.addressRow} activeOpacity={0.6}>
            <Text style={styles.mapsPinIcon}>📍</Text>
            <Text style={styles.clientAddressLink}>{client.address}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.clientAddress}>{client.address}</Text>
        )}

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

        {/* Freq badge */}
        <View style={styles.freqRow}>
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
        </View>

        {/* Action bar: Call | Camera | En camino | Listo */}
        <View style={styles.actionBar}>
          {client.phone ? (
            <>
              <TouchableOpacity onPress={callClient} style={styles.actionBtnDark}>
                <Text style={styles.actionBtnIcon}>📞</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openWhatsAppCamera} style={styles.actionBtnDark}>
                <Text style={styles.actionBtnIcon}>📷</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={sendEnCamino} style={styles.enCaminoBtn} activeOpacity={0.7}>
                <Text style={styles.enCaminoText}>💬 En camino</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ flex: 1 }} />
          )}
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
  cardStarred: {
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  orderBadge: {
    width: 36,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#F3F4F6',
  },
  orderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  cardBody: {
    flex: 1,
    padding: 10,
    gap: 4,
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
    flexWrap: 'wrap',
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    padding: 4,
    borderRadius: 6,
  },
  clientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  debtBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  transferBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  alarmBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D97706',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  clientAddress: {
    fontSize: 12,
    color: '#6B7280',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mapsPinIcon: {
    fontSize: 14,
  },
  clientAddressLink: {
    fontSize: 12,
    color: '#2563EB',
    flex: 1,
  },
  productsRow: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 6,
    marginTop: 2,
  },
  productsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
  },
  notesText: {
    fontSize: 11,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  freqRow: {
    marginTop: 2,
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
    alignSelf: 'flex-start',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  actionBtnDark: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnIcon: {
    fontSize: 16,
  },
  enCaminoBtn: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#22C55E',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  enCaminoText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  doneButton: {
    height: 36,
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default React.memo(ClientCard);
