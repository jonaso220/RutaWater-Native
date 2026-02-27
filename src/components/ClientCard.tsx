import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Client } from '../types';
import { PRODUCTS } from '../constants/products';
import { normalizePhone } from '../utils/helpers';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import PromptModal from './PromptModal';

const URL_REGEX = /(https?:\/\/[^\s]+)/;

const parseTextWithLinks = (text: string, linkColor: string) => {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (URL_REGEX.test(part)) {
      return (
        <Text
          key={i}
          style={{ color: linkColor, textDecorationLine: 'underline' }}
          onPress={() => Linking.openURL(part)}
        >
          {part}
        </Text>
      );
    }
    return part;
  });
};

interface ClientCardProps {
  client: Client;
  index: number;
  isAdmin: boolean;
  hasDebt?: boolean;
  hasPendingTransfer?: boolean;
  enCaminoMessage?: string;
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
  enCaminoMessage,
}) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [showPositionPrompt, setShowPositionPrompt] = useState(false);

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
    setShowPositionPrompt(true);
  };

  const sendEnCamino = () => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    const defaultMsg = 'Buenas 🚚. Ya estamos en camino, sos el/la siguiente en la lista de entrega. ¡Nos vemos en unos minutos!\n\nAquapura';
    const msg = encodeURIComponent(enCaminoMessage || defaultMsg);
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
        <PromptModal
          visible={showPositionPrompt}
          title="Cambiar posicion"
          message={`Posicion actual: ${index + 1}\nIngresa la nueva posicion:`}
          defaultValue={String(index + 1)}
          keyboardType="number-pad"
          onSubmit={(text) => {
            setShowPositionPrompt(false);
            const num = parseInt(text, 10);
            if (num > 0 && onChangePosition) {
              onChangePosition(num);
            }
          }}
          onCancel={() => setShowPositionPrompt(false)}
        />
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
          <Text style={styles.noteText}>
            {parseTextWithLinks(client.notes || '', colors.primary)}
          </Text>
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
      <PromptModal
        visible={showPositionPrompt}
        title="Cambiar posicion"
        message={`Posicion actual: ${index + 1}\nIngresa la nueva posicion:`}
        defaultValue={String(index + 1)}
        keyboardType="number-pad"
        onSubmit={(text) => {
          setShowPositionPrompt(false);
          const num = parseInt(text, 10);
          if (num > 0 && onChangePosition) {
            onChangePosition(num);
          }
        }}
        onCancel={() => setShowPositionPrompt(false)}
      />
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

const getStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
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
      borderLeftColor: colors.warningYellow,
      backgroundColor: colors.warningAmberBg,
    },
    cardOnce: {
      borderLeftWidth: 4,
      borderLeftColor: colors.warning,
      backgroundColor: colors.warningLightBg,
    },
    cardStarred: {
      borderLeftWidth: 4,
      borderLeftColor: colors.warningAmber,
      backgroundColor: colors.warningAmberBg,
    },
    orderBadge: {
      width: 36,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      borderRightWidth: 1,
      borderRightColor: colors.sectionBackground,
    },
    orderText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textMuted,
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
      fontSize: 13,
      fontWeight: '800',
      color: colors.warningDarker,
      textTransform: 'uppercase',
    },
    noteText: {
      fontSize: 16,
      color: colors.textSecondary,
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
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    badgesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
    },
    debtBadge: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.danger,
      backgroundColor: colors.dangerLight,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: 'hidden',
    },
    transferBadge: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.successDark,
      backgroundColor: colors.successLighter,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: 'hidden',
    },
    alarmBadge: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.warningDark,
      backgroundColor: colors.warningAmberBg,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: 'hidden',
    },
    clientAddress: {
      fontSize: 14,
      color: colors.textMuted,
    },
    addressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    mapsPinIcon: {
      fontSize: 16,
    },
    clientAddressLink: {
      fontSize: 14,
      color: colors.primary,
      flex: 1,
    },
    productsRow: {
      backgroundColor: colors.sectionBackground,
      borderRadius: 8,
      padding: 6,
      marginTop: 2,
    },
    productsText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    notesText: {
      fontSize: 13,
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    freqRow: {
      marginTop: 2,
    },
    badge: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      backgroundColor: colors.sectionBackground,
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
      borderTopColor: colors.sectionBackground,
    },
    actionBtnDark: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionBtnIcon: {
      fontSize: 18,
    },
    enCaminoBtn: {
      flex: 1,
      height: 36,
      borderRadius: 8,
      backgroundColor: colors.successBright,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
    },
    enCaminoText: {
      color: colors.textWhite,
      fontSize: 16,
      fontWeight: '700',
    },
    doneButton: {
      height: 36,
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    doneButtonText: {
      color: colors.textWhite,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default React.memo(ClientCard);
