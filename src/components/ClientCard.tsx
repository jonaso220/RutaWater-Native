import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Client } from '../types';
import { useAllProducts } from '../stores/productCatalogStore';
import { normalizePhone } from '../utils/helpers';
import { formatShortDate } from '../utils/format';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import PromptModal from './PromptModal';
import ModalOverlay from './ModalOverlay';
import { ProductIcon } from './ProductIcon';
import { getFreqLabel } from '../constants/products';
import { WIDE_CONTENT_MAX_WIDTH } from '../constants/layout';

const URL_REGEX = /(https?:\/\/[^\s]+)/;

const formatClientName = (name: string) => name
  .trim()
  .toLocaleLowerCase()
  .replace(/(^|[\s'-])\S/g, (letter) => letter.toLocaleUpperCase());

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
  hasRelationships?: boolean;
  enCaminoMessage?: string;
  onMarkDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDebt?: () => void;
  onToggleStar?: () => void;
  onTransfer?: () => void;
  onAlarm?: () => void;
  onRelationships?: () => void;
  onChangePosition?: (newPosition: number) => void;
  fontScale?: number;
  wideLayout?: boolean;
}

const ClientCard: React.FC<ClientCardProps> = ({
  client,
  index,
  isAdmin,
  hasDebt,
  hasPendingTransfer,
  hasRelationships,
  onMarkDone,
  onEdit,
  onDelete,
  onDebt,
  onToggleStar,
  onTransfer,
  onAlarm,
  onRelationships,
  onChangePosition,
  enCaminoMessage,
  fontScale = 1,
  wideLayout = false,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const s = (v: number) => Math.round(v * fontScale);
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);
  const [showPositionPrompt, setShowPositionPrompt] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const allProducts = useAllProducts();
  const relationshipCount = Object.keys(client.relationships || {}).length;

  const productList = React.useMemo(() => {
    if (!client.products) return [] as { id: string; qty: number; emoji: string; short: string }[];
    return Object.keys(client.products)
      .filter((k) => parseInt(String(client.products[k] || 0), 10) > 0)
      .map((k) => {
        const p = allProducts.find((prod) => prod.id === k);
        return {
          id: k,
          qty: parseInt(String(client.products[k]), 10),
          emoji: p?.emoji || '📦',
          short: p?.short || k,
        };
      });
  }, [client.products, allProducts]);

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

  const runMenuAction = (action?: () => void) => {
    setShowActionsMenu(false);
    action?.();
  };

  const actionsMenu = (
    <ModalOverlay
      visible={showActionsMenu}
      onClose={() => setShowActionsMenu(false)}
      animationType="fade"
    >
      <View style={styles.menuOverlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setShowActionsMenu(false)}
          accessibilityRole="button"
          accessibilityLabel={t('close')}
        />
        <View style={styles.menuSheet}>
          <View style={styles.menuHandle} />
          <View style={styles.menuHeader}>
            <View style={styles.menuHeaderText}>
              <Text style={styles.menuTitle}>{formatClientName(client.name || '')}</Text>
              <Text style={styles.menuSubtitle}>{t('clientCard.moreActions')}</Text>
            </View>
            <TouchableOpacity
              style={styles.menuCloseButton}
              onPress={() => setShowActionsMenu(false)}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
            >
              <Ionicons name="close" size={s(20)} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.menuItems}>
            {onDebt && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => runMenuAction(onDebt)}
                accessibilityRole="button"
                accessibilityLabel={hasDebt ? t('clientCard.manageDebt') : t('clientCard.addDebt')}
              >
                <View style={[styles.menuItemIcon, hasDebt && styles.menuItemIconDanger]}>
                  <Ionicons name="cash-outline" size={s(20)} color={hasDebt ? colors.danger : colors.textSecondary} />
                </View>
                <Text style={styles.menuItemText}>
                  {hasDebt ? t('clientCard.manageDebt') : t('clientCard.addDebt')}
                </Text>
                <Ionicons name="chevron-forward" size={s(18)} color={colors.textHint} />
              </TouchableOpacity>
            )}
            {onTransfer && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => runMenuAction(onTransfer)}
                accessibilityRole="button"
                accessibilityLabel={t('clientCard.manageTransfer')}
              >
                <View style={[styles.menuItemIcon, hasPendingTransfer && styles.menuItemIconSuccess]}>
                  <Ionicons name="swap-horizontal-outline" size={s(20)} color={hasPendingTransfer ? colors.successText : colors.textSecondary} />
                </View>
                <Text style={styles.menuItemText}>{t('clientCard.manageTransfer')}</Text>
                <Ionicons name="chevron-forward" size={s(18)} color={colors.textHint} />
              </TouchableOpacity>
            )}
            {onAlarm && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => runMenuAction(onAlarm)}
                accessibilityRole="button"
                accessibilityLabel={t('clientCard.manageAlarm')}
              >
                <View style={[styles.menuItemIcon, client.alarm && styles.menuItemIconWarning]}>
                  <Ionicons name="notifications-outline" size={s(20)} color={client.alarm ? colors.warningDark : colors.textSecondary} />
                </View>
                <Text style={styles.menuItemText}>{t('clientCard.manageAlarm')}</Text>
                <Ionicons name="chevron-forward" size={s(18)} color={colors.textHint} />
              </TouchableOpacity>
            )}
            {onRelationships && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => runMenuAction(onRelationships)}
                accessibilityRole="button"
                accessibilityLabel={t('clientCard.manageFamily')}
              >
                <View style={[styles.menuItemIcon, hasRelationships && styles.menuItemIconPrimary]}>
                  <Ionicons name="people-outline" size={s(20)} color={hasRelationships ? colors.primary : colors.textSecondary} />
                </View>
                <Text style={styles.menuItemText}>{t('clientCard.manageFamily')}</Text>
                <Ionicons name="chevron-forward" size={s(18)} color={colors.textHint} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => runMenuAction(onEdit)}
              accessibilityRole="button"
              accessibilityLabel={t('clientCard.editClient')}
            >
              <View style={styles.menuItemIcon}>
                <Ionicons name="create-outline" size={s(20)} color={colors.textSecondary} />
              </View>
              <Text style={styles.menuItemText}>{t('clientCard.editClient')}</Text>
              <Ionicons name="chevron-forward" size={s(18)} color={colors.textHint} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ModalOverlay>
  );

  // --- NOTE CARD ---
  if (client.isNote) {
    const noteScheduleLabel = client.freq === 'once'
      ? (client.specificDate || t('clientCard.onceLabel'))
      : getFreqLabel(client.freq);
    const noteDoneBtn = (
      <TouchableOpacity style={[styles.doneButton, wideLayout && styles.doneButtonWide]} onPress={onMarkDone}>
        <Text style={styles.doneButtonText}><Ionicons name="checkmark" size={s(15)} /> {t('done')}</Text>
      </TouchableOpacity>
    );
    return (
      <View style={[styles.card, styles.noteCard, wideLayout && styles.cardWide]}>
        <PromptModal
          visible={showPositionPrompt}
          title={t('clientCard.changePosition')}
          message={t('clientCard.currentPosition', { pos: index + 1 })}
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
        <View style={[styles.cardBody, wideLayout && styles.cardBodyWide]}>
          <View style={styles.headerRow}>
            <Text style={styles.noteLabel}><Ionicons name="document-text" size={s(13)} /> {t('clientCard.note')}</Text>
            <View style={styles.actions}>
              <TouchableOpacity onPress={onEdit} style={styles.iconBtn}>
                <Ionicons name="pencil" size={s(16)} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
                <Ionicons name="trash" size={s(16)} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.noteText}>
            {parseTextWithLinks(client.notes || '', colors.primary)}
          </Text>
          {wideLayout ? (
            <View style={styles.freqRow}>
              <Text style={styles.badge}>{noteScheduleLabel}</Text>
            </View>
          ) : (
            <View style={styles.actionBar}>
              <Text style={styles.badge}>{noteScheduleLabel}</Text>
              <View style={{ flex: 1 }} />
              {noteDoneBtn}
            </View>
          )}
        </View>
        {wideLayout && <View style={styles.rightPanel}>{noteDoneBtn}</View>}
      </View>
    );
  }

  // --- CLIENT CARD ---
  return (
    <View
      style={[
        styles.card,
        wideLayout && styles.cardWide,
        client.isStarred && styles.cardStarred,
        (client.freq === 'once') && styles.cardOnce,
      ]}
    >
      <PromptModal
        visible={showPositionPrompt}
        title={t('clientCard.changePosition')}
        message={t('clientCard.currentPosition', { pos: index + 1 })}
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
      {showActionsMenu && actionsMenu}
      <View style={[styles.cardBody, wideLayout && styles.cardBodyWide]}>
        {/* Client identity and high-priority controls */}
        <View style={styles.clientHeader}>
          <TouchableOpacity
            style={styles.orderCircle}
            onPress={handleOrderTap}
            activeOpacity={onChangePosition ? 0.65 : 1}
            accessibilityRole="button"
            accessibilityLabel={t('clientCard.position', { position: index + 1 })}
          >
            <Text style={styles.orderCircleText}>{index + 1}</Text>
          </TouchableOpacity>

          <Text style={styles.clientName} numberOfLines={1}>
            {formatClientName(client.name || '')}
          </Text>

          {onToggleStar && (
            <TouchableOpacity
              onPress={onToggleStar}
              style={[styles.headerIconButton, client.isStarred && styles.headerIconButtonStarred]}
              accessibilityRole="button"
              accessibilityLabel={client.isStarred ? t('clientCard.removeFavorite') : t('clientCard.addFavorite')}
            >
              <Ionicons
                name={client.isStarred ? 'star' : 'star-outline'}
                size={s(20)}
                color={client.isStarred ? colors.warningAmber : colors.textMuted}
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => setShowActionsMenu(true)}
            style={styles.headerIconButton}
            accessibilityRole="button"
            accessibilityLabel={t('clientCard.moreActions')}
          >
            <Ionicons name="ellipsis-horizontal" size={s(21)} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Only active states remain visible and actionable. */}
        <View style={styles.badgesRow}>
          {hasDebt && (
            <TouchableOpacity onPress={onDebt} style={[styles.statusBadge, styles.debtBadge]}>
              <Ionicons name="cash-outline" size={s(13)} color={colors.danger} />
              <Text style={[styles.statusBadgeText, styles.debtBadgeText]}>{t('clientCard.debt')}</Text>
            </TouchableOpacity>
          )}
          {hasPendingTransfer && onTransfer && (
            <TouchableOpacity onPress={onTransfer} style={[styles.statusBadge, styles.transferBadge]}>
              <MaterialCommunityIcons name="bank-transfer" size={s(14)} color={colors.successText} />
              <Text style={[styles.statusBadgeText, styles.transferBadgeText]}>{t('clientCard.transfer')}</Text>
            </TouchableOpacity>
          )}
          {client.alarm && onAlarm ? (
            <TouchableOpacity onPress={onAlarm} style={[styles.statusBadge, styles.alarmBadge]}>
              <Ionicons name="notifications-outline" size={s(13)} color={colors.warningDark} />
              <Text style={[styles.statusBadgeText, styles.alarmBadgeText]} numberOfLines={1}>{client.alarm}</Text>
            </TouchableOpacity>
          ) : null}
          {hasRelationships && onRelationships && (
            <TouchableOpacity onPress={onRelationships} style={[styles.statusBadge, styles.familyBadge]}>
              <Ionicons name="people-outline" size={s(13)} color={colors.primaryText} />
              <Text style={[styles.statusBadgeText, styles.familyBadgeText]}>{t('relationships.badge')} · {relationshipCount}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Address with location button */}
        {client.address ? (
          hasLocation ? (
            <TouchableOpacity
              onPress={openMaps}
              style={styles.addressButton}
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="location-sharp" size={s(18)} color={colors.primary} />
              <Text style={styles.clientAddressLink} numberOfLines={1}>{client.address}</Text>
              <Ionicons name="chevron-forward" size={s(16)} color={colors.textHint} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onEdit} style={styles.addressRow} activeOpacity={0.6}>
              <Ionicons name="location-outline" size={s(16)} color={colors.textHint} />
              <Text style={styles.clientAddress}>{client.address}</Text>
            </TouchableOpacity>
          )
        ) : null}

        {/* Products */}
        {productList.length > 0 ? (
          <View style={styles.productsRow}>
            {productList.map((p) => (
              <View key={p.id} style={styles.productChip}>
                <ProductIcon value={p.emoji} size={s(15)} style={styles.productEmoji} />
                <Text style={styles.productQty}>{p.qty}</Text>
                <Text style={styles.productShort}>{p.short}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Notes */}
        {client.notes ? (
          <View style={styles.notesRow}>
            <Ionicons name="document-text" size={s(14)} color={colors.warningDark} />
            <Text style={styles.notesText} numberOfLines={3}>{parseTextWithLinks(client.notes, colors.primary)}</Text>
          </View>
        ) : null}

        {/* Freq badge */}
        <View style={styles.freqRow}>
          <Text style={[styles.badge, client.freq === 'once' && styles.badgeOnce]}>
            {client.freq === 'once'
              ? (client.specificDate ? t('clientCard.onceWithDate', { date: formatShortDate(client.specificDate) }) : t('clientCard.onceLabel'))
              : t(`freq.${client.freq}`)}
          </Text>
        </View>

        {/* Action bar (narrow phones): Call | Camera | En camino | Listo below */}
        {!wideLayout && (
          <View style={styles.actionBar}>
            {client.phone ? (
              <>
                <TouchableOpacity
                  onPress={callClient}
                  style={styles.actionBtnDark}
                  accessibilityRole="button"
                  accessibilityLabel={t('clientCard.call')}
                >
                  <Ionicons name="call-outline" size={s(19)} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openWhatsAppCamera}
                  style={styles.actionBtnDark}
                  accessibilityRole="button"
                  accessibilityLabel={t('clientCard.whatsapp')}
                >
                  <Ionicons name="logo-whatsapp" size={s(20)} color={colors.successMedium} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={sendEnCamino}
                  style={styles.enCaminoBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('clientCard.onTheWay')}
                >
                  <Ionicons name="navigate-outline" size={s(15)} color={colors.successText} />
                  <Text style={styles.enCaminoText}>{t('clientCard.onTheWay')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity onPress={onEdit} style={styles.addPhoneBtn} activeOpacity={0.6}>
                <Ionicons name="call-outline" size={s(14)} color={colors.textHint} />
                <Text style={styles.addPhoneText}>{t('clientCard.addPhone')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.doneButton}
              onPress={onMarkDone}
              accessibilityRole="button"
              accessibilityLabel={t('done')}
            >
              <Ionicons name="checkmark" size={s(17)} color={colors.textWhite} />
              <Text style={styles.doneButtonText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {/* Action panel (wide screens): stacked on the right so the card stays short */}
      {wideLayout && (
        <View style={styles.rightPanel}>
          {client.phone ? (
            <>
              <View style={styles.wideIconRow}>
                <TouchableOpacity onPress={callClient} style={styles.actionBtnDarkWide}>
                  <Ionicons name="call-outline" size={s(18)} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={openWhatsAppCamera} style={styles.actionBtnDarkWide}>
                  <Ionicons name="logo-whatsapp" size={s(19)} color={colors.successMedium} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={sendEnCamino} style={styles.enCaminoBtnWide} activeOpacity={0.7}>
                <Ionicons name="navigate-outline" size={s(15)} color={colors.successText} />
                <Text style={styles.enCaminoText}>{t('clientCard.onTheWay')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={onEdit} style={styles.addPhoneBtnWide} activeOpacity={0.6}>
              <Ionicons name="call-outline" size={s(14)} color={colors.textHint} />
              <Text style={styles.addPhoneText}>{t('clientCard.addPhone')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.doneButtonWide} onPress={onMarkDone}>
            <Ionicons name="checkmark" size={s(17)} color={colors.textWhite} />
            <Text style={styles.doneButtonText}>{t('done')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: s(16),
      marginBottom: s(10),
      flexDirection: 'row',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.cardBorder,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
      elevation: 2,
      maxWidth: 800,
      width: '100%',
      alignSelf: 'center',
    },
    noteCard: {
      borderLeftWidth: 4,
      borderLeftColor: colors.warningYellow,
    },
    cardOnce: {
      borderLeftWidth: 4,
      borderLeftColor: colors.warning,
    },
    cardStarred: {
      borderLeftWidth: 4,
      borderLeftColor: colors.warningAmber,
    },
    orderBadge: {
      width: s(36),
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      borderRightWidth: 1,
      borderRightColor: colors.sectionBackground,
    },
    orderText: {
      fontSize: s(14),
      fontWeight: '700',
      color: colors.textMuted,
    },
    cardBody: {
      flex: 1,
      padding: s(12),
      gap: s(6),
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    noteLabel: {
      fontSize: s(13),
      fontWeight: '800',
      color: colors.warningDarker,
      textTransform: 'uppercase',
    },
    noteText: {
      fontSize: s(16),
      color: colors.textSecondary,
      lineHeight: s(20),
    },
    clientHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(8),
      minHeight: s(36),
    },
    orderCircle: {
      width: s(30),
      height: s(30),
      borderRadius: s(15),
      backgroundColor: colors.sectionBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    orderCircleText: {
      fontSize: s(13),
      fontWeight: '800',
      color: colors.textSecondary,
    },
    headerIconButton: {
      width: s(34),
      height: s(34),
      borderRadius: s(10),
      backgroundColor: colors.sectionBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerIconButtonStarred: {
      backgroundColor: colors.warningAmberBg,
      borderColor: colors.warningAmberBorder,
    },
    actions: {
      flexDirection: 'row',
      gap: s(6),
    },
    iconBtn: {
      padding: s(6),
      borderRadius: s(6),
    },
    clientName: {
      flex: 1,
      fontSize: s(17),
      fontWeight: '800',
      color: colors.textPrimary,
    },
    badgesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s(6),
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(4),
      minHeight: s(26),
      paddingHorizontal: s(8),
      borderRadius: s(8),
      borderWidth: 1,
    },
    statusBadgeText: {
      fontSize: s(12),
      fontWeight: '700',
    },
    debtBadge: {
      backgroundColor: colors.dangerLight,
      borderColor: colors.dangerBorder,
    },
    debtBadgeText: {
      color: colors.danger,
    },
    transferBadge: {
      backgroundColor: colors.successLighter,
      borderColor: colors.successBorder,
    },
    transferBadgeText: {
      color: colors.successText,
    },
    alarmBadge: {
      backgroundColor: colors.warningAmberBg,
      borderColor: colors.warningAmberBorder,
      maxWidth: '100%',
    },
    alarmBadgeText: {
      color: colors.warningDark,
      flexShrink: 1,
    },
    familyBadge: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primaryBorder,
    },
    familyBadgeText: {
      color: colors.primaryText,
    },
    clientAddress: {
      fontSize: s(14),
      color: colors.textMuted,
    },
    addressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(4),
    },
    addressButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(6),
      backgroundColor: colors.sectionBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: s(12),
      paddingVertical: s(9),
      paddingHorizontal: s(10),
      marginTop: s(2),
      alignSelf: 'flex-start',
      maxWidth: '100%',
    },
    mapsPinIcon: {
      fontSize: s(16),
    },
    clientAddressLink: {
      fontSize: s(14),
      fontWeight: '600',
      color: colors.textPrimary,
      flex: 1,
    },
    productsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s(6),
      marginTop: s(4),
    },
    productChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      paddingVertical: s(4),
      paddingHorizontal: s(10),
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      gap: s(4),
    },
    productEmoji: {
      fontSize: s(14),
    },
    productQty: {
      fontSize: s(13),
      fontWeight: '800',
      color: colors.primary,
    },
    productShort: {
      fontSize: s(12),
      fontWeight: '600',
      color: colors.textSecondary,
    },
    notesRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: s(6),
      backgroundColor: colors.sectionBackground,
      borderRadius: s(10),
      padding: s(8),
      marginTop: s(2),
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    notesText: {
      flex: 1,
      fontSize: s(13),
      color: colors.textSecondary,
      fontWeight: '500',
      lineHeight: s(18),
    },
    freqRow: {
      marginTop: s(2),
    },
    badge: {
      fontSize: s(12),
      fontWeight: '700',
      color: colors.textMuted,
      backgroundColor: colors.sectionBackground,
      paddingHorizontal: s(8),
      paddingVertical: s(3),
      borderRadius: s(6),
      overflow: 'hidden',
      alignSelf: 'flex-start',
    },
    badgeOnce: {
      color: colors.warning,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.warning,
      paddingHorizontal: s(10),
      paddingVertical: s(4),
      borderRadius: s(20),
    },
    actionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(7),
      marginTop: s(8),
      paddingTop: s(10),
      borderTopWidth: 1,
      borderTopColor: colors.sectionBackground,
    },
    actionBtnDark: {
      width: s(40),
      height: s(40),
      borderRadius: s(11),
      backgroundColor: colors.sectionBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionBtnIcon: {
      fontSize: s(18),
    },
    enCaminoBtn: {
      flex: 1.2,
      height: s(40),
      borderRadius: s(11),
      backgroundColor: colors.successLighter,
      borderWidth: 1,
      borderColor: colors.successBorder,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: s(4),
    },
    enCaminoText: {
      color: colors.successText,
      fontSize: s(13),
      fontWeight: '700',
    },
    addPhoneBtn: {
      flex: 1,
      height: s(36),
      borderRadius: s(8),
      backgroundColor: colors.sectionBackground,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: s(4),
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderStyle: 'dashed',
    },
    addPhoneText: {
      fontSize: s(13),
      color: colors.textHint,
      fontWeight: '600',
    },
    doneButton: {
      flex: 0.9,
      height: s(40),
      backgroundColor: colors.primary,
      paddingHorizontal: s(10),
      borderRadius: s(11),
      flexDirection: 'row',
      gap: s(4),
      justifyContent: 'center',
      alignItems: 'center',
    },
    doneButtonText: {
      color: colors.textWhite,
      fontSize: s(15),
      fontWeight: '700',
    },
    menuOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlay,
      padding: s(16),
      paddingBottom: s(24),
    },
    menuSheet: {
      width: '100%',
      maxWidth: s(440),
      alignSelf: 'center',
      backgroundColor: colors.modalBackground,
      borderRadius: s(20),
      padding: s(14),
      borderWidth: 1,
      borderColor: colors.cardBorder,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: 0.16,
      shadowRadius: 14,
      elevation: 12,
    },
    menuHandle: {
      width: s(38),
      height: s(4),
      borderRadius: s(2),
      backgroundColor: colors.cardBorder,
      alignSelf: 'center',
      marginBottom: s(10),
    },
    menuHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: s(10),
      paddingHorizontal: s(2),
    },
    menuHeaderText: {
      flex: 1,
    },
    menuTitle: {
      color: colors.textPrimary,
      fontSize: s(17),
      fontWeight: '800',
    },
    menuSubtitle: {
      color: colors.textMuted,
      fontSize: s(12),
      marginTop: s(2),
    },
    menuCloseButton: {
      width: s(34),
      height: s(34),
      borderRadius: s(17),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    menuItems: {
      gap: s(4),
    },
    menuItem: {
      minHeight: s(52),
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(10),
      paddingHorizontal: s(8),
      borderRadius: s(12),
    },
    menuItemIcon: {
      width: s(36),
      height: s(36),
      borderRadius: s(10),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    menuItemIconDanger: {
      backgroundColor: colors.dangerLight,
    },
    menuItemIconSuccess: {
      backgroundColor: colors.successLighter,
    },
    menuItemIconWarning: {
      backgroundColor: colors.warningAmberBg,
    },
    menuItemIconPrimary: {
      backgroundColor: colors.primaryLight,
    },
    menuItemText: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: s(15),
      fontWeight: '600',
    },
    // --- Wide-screen (Mac/iPad) horizontal layout ---
    // Wider card so a single full-width row uses the extra space; the action
    // buttons move into a right-hand panel (rightPanel) instead of a bottom bar,
    // which also keeps the card short ("más fina").
    cardWide: {
      maxWidth: WIDE_CONTENT_MAX_WIDTH,
    },
    cardBodyWide: {
      paddingVertical: s(12),
      justifyContent: 'center',
    },
    rightPanel: {
      width: s(210),
      paddingVertical: s(10),
      paddingHorizontal: s(10),
      justifyContent: 'center',
      gap: s(6),
      borderLeftWidth: 1,
      borderLeftColor: colors.sectionBackground,
    },
    wideIconRow: {
      flexDirection: 'row',
      gap: s(6),
    },
    actionBtnDarkWide: {
      flex: 1,
      height: s(40),
      borderRadius: s(8),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    enCaminoBtnWide: {
      height: s(40),
      borderRadius: s(10),
      backgroundColor: colors.successLighter,
      borderWidth: 1,
      borderColor: colors.successBorder,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: s(4),
    },
    doneButtonWide: {
      height: s(40),
      backgroundColor: colors.primary,
      borderRadius: s(10),
      flexDirection: 'row',
      gap: s(4),
      justifyContent: 'center',
      alignItems: 'center',
    },
    addPhoneBtnWide: {
      height: s(40),
      borderRadius: s(8),
      backgroundColor: colors.sectionBackground,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: s(4),
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderStyle: 'dashed',
    },
  });
};

export default React.memo(ClientCard);
