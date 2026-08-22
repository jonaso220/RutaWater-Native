import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { Client } from '../types';
import { normalizePhone } from '../utils/helpers';
import { formatMoney } from '../utils/format';
import { getDayLabel } from '../constants/products';
import { getLastActivityDate, getDaysSince } from '../utils/recency';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { useTranslation } from 'react-i18next';
import { WIDE_CONTENT_MAX_WIDTH } from '../constants/layout';
import { normalizeGoogleMapsLink } from '../utils/googleMapsLink';
import { getClientPhones } from '../utils/clientPhones';

const AVATAR_COLORS = ['#3B82F6','#22C55E','#A855F7','#F97316','#EC4899','#14B8A6','#6366F1','#EF4444'];
const ACTION_HIT_SLOP = { top: 3, bottom: 3, left: 3, right: 3 };

interface Props {
  client: Client;
  debtTotal: number;
  showRecency: boolean;
  effectiveLastActivityDate: Date | null;
  isAdmin: boolean;
  onSchedule: (client: Client) => void;
  onDebt: (client: Client) => void;
  onRelationship: (client: Client) => void;
  onEdit: (client: Client) => void;
}

const getFreqStyle = (freq: string, themeColors: ThemeColors) => {
  switch (freq) {
    case 'weekly': return { bg: themeColors.primaryLight, text: themeColors.primaryDark };
    case 'biweekly': return { bg: themeColors.successLighter, text: themeColors.successDark };
    case 'triweekly': return { bg: themeColors.warningAmberBg, text: themeColors.warningDarker };
    case 'monthly': return { bg: themeColors.dangerLight, text: themeColors.danger };
    case 'once': return { bg: themeColors.warningLightBg, text: themeColors.warningOrangeText };
    case 'on_demand': return { bg: themeColors.sectionBackground, text: themeColors.textMuted };
    default: return { bg: themeColors.sectionBackground, text: themeColors.textMuted };
  }
};

const DirectoryClientCard = ({
  client: item,
  debtTotal,
  showRecency,
  effectiveLastActivityDate,
  isAdmin,
  onSchedule,
  onDebt,
  onRelationship,
  onEdit,
}: Props) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { fontScale, width } = useLayout();
  const wideLayout = width >= 900;
  const styles = React.useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);

  const sendWhatsApp = (client: Client) => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorWhatsApp'));
    });
  };

  const openMaps = (client: Client) => {
    if (client.lat && client.lng) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`,
      ).catch(() => {
        Alert.alert(t('error'), t('directory.errorMaps'));
      });
    } else if (client.mapsLink) {
      const mapsLink = normalizeGoogleMapsLink(client.mapsLink);
      if (!mapsLink) {
        Alert.alert(t('error'), t('directory.errorMapsLink'));
        return;
      }
      Linking.openURL(mapsLink).catch(() => {
        Alert.alert(t('error'), t('directory.errorMapsLink'));
      });
    }
  };

  const callClient = (client: Client) => {
    if (!client.phone) return;
    Linking.openURL(`tel:${client.phone}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorCall'));
    });
  };

  const getFreqLabel = (freq: string): string => {
    return t('freq.' + freq, { defaultValue: freq || '' });
  };

  const getRecencyBadge = (client: Client): { label: string; bgColor: string; textColor: string } => {
    const ownDate = getLastActivityDate(client);
    const lastDate = effectiveLastActivityDate;
    // La fecha efectiva vino de un familiar (no del cliente): lo marcamos con 👪 para
    // que se entienda por qué aparece como visitado recientemente.
    const fromFamily = !!lastDate && (!ownDate || lastDate.getTime() > ownDate.getTime());
    const fam = fromFamily ? ' 👪' : '';
    const days = getDaysSince(lastDate);

    // Mismos valores que antes pero vía tokens del theme (cada par claro/oscuro
    // coincide exactamente con el token en ambas paletas).
    if (days === null) {
      return {
        label: t('directory.noHistory'),
        bgColor: colors.cardBorder,
        textColor: colors.textMuted,
      };
    }

    if (days <= 7) {
      return {
        label: (days === 0 ? t('directory.today') : t('directory.daysAgo', { count: days })) + fam,
        bgColor: colors.successLighter,
        textColor: isDark ? colors.successAccent : colors.successDark,
      };
    }

    if (days <= 21) {
      return {
        label: t('directory.daysAgo', { count: days }) + fam,
        bgColor: colors.warningAmberBg,
        textColor: isDark ? colors.warningAmber : colors.warningDark,
      };
    }

    if (days <= 45) {
      return {
        label: t('directory.daysAgo', { count: days }) + fam,
        bgColor: colors.warningLightBg,
        textColor: colors.warningOrangeText,
      };
    }

    return {
      label: t('directory.daysAgo', { count: days }) + fam,
      bgColor: colors.dangerLight,
      textColor: isDark ? colors.dangerBright : colors.danger,
    };
  };

  const hasRelationships = !!(item.relationships && Object.keys(item.relationships).length > 0);
  const relationshipCount = Object.keys(item.relationships || {}).length;
  const isOnDemand = item.freq === 'on_demand' || !item.visitDays?.length;
  const hasLocation = !!(item.lat && item.lng) || !!item.mapsLink;
  const avatarColor = AVATAR_COLORS[(item.name || '').charCodeAt(0) % AVATAR_COLORS.length];
  const initial = (item.name || '?').charAt(0).toUpperCase();
  const freqStyle = getFreqStyle(item.freq, colors);
  const recencyBadge = showRecency ? getRecencyBadge(item) : null;
  const scheduleAction = isOnDemand ? t('directory.schedule') : t('directory.addVisit');
  const additionalPhoneCount = Math.max(0, getClientPhones(item).length - 1);

  return (
    <View style={[styles.card, debtTotal > 0 && styles.cardDebt]}>
      <View style={[styles.cardContent, wideLayout && styles.cardContentWide]}>
        <View style={styles.infoColumn}>
        {/* HEADER: Avatar + Name + Phone */}
        <View style={styles.headerRow}>
          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.headerInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.clientName} numberOfLines={1}>
                {(item.name || '').toUpperCase()}
              </Text>
              {item.phone ? (
                <View style={styles.clientPhoneRow}>
                  <Text style={styles.clientPhone}>{item.phone}</Text>
                  {additionalPhoneCount > 0 && (
                    <Text style={styles.additionalPhoneBadge}>
                      {t('clientPhones.additionalCount', { count: additionalPhoneCount })}
                    </Text>
                  )}
                </View>
              ) : null}
            </View>
            {item.address ? (
              hasLocation ? (
                <TouchableOpacity
                  onPress={() => openMaps(item)}
                  activeOpacity={0.6}
                  style={styles.addressLinkBox}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  accessibilityRole="link"
                  accessibilityLabel={`${t('clientCard.openMaps')}: ${item.name}. ${item.address}`}
                >
                  <Ionicons name="location-sharp" size={14} color={colors.primary} />
                  <Text style={styles.addressLinkText} numberOfLines={wideLayout ? 1 : 3}>{item.address}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.clientAddress} numberOfLines={wideLayout ? 1 : 3}>
                  <Ionicons name="location-sharp" size={13} /> {item.address}
                </Text>
              )
            ) : hasLocation ? (
              <TouchableOpacity
                onPress={() => openMaps(item)}
                activeOpacity={0.6}
                style={styles.addressLinkBox}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityRole="link"
                accessibilityLabel={`${t('clientCard.openMaps')}: ${item.name}`}
              >
                <Ionicons name="location-sharp" size={14} color={colors.primary} />
                <Text style={styles.addressLinkText} numberOfLines={1}>{t('directory.viewLocation')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* RECENCY BADGE (only in Recurrencia mode) */}
        {recencyBadge && (
          <View style={styles.recencyRow}>
            <Text style={[
              styles.recencyBadge,
              { backgroundColor: recencyBadge.bgColor, color: recencyBadge.textColor },
            ]}>
              {recencyBadge.label}
            </Text>
          </View>
        )}

        {/* BADGES: Freq + Days + Debt */}
        <View style={styles.badgesRow}>
          {item.isInactive && (
            <Text style={styles.inactiveBadge}>{t('directory.inactiveBadge')}</Text>
          )}
          <Text style={[styles.freqBadge, { backgroundColor: freqStyle.bg, color: freqStyle.text }]}>
            {getFreqLabel(item.freq)}
          </Text>
          {item.visitDays && item.visitDays.length > 0 && (
            <Text style={styles.daysBadge}>
              {item.visitDays.map((d) => getDayLabel(d).slice(0, 3)).join(', ')}
            </Text>
          )}
          {debtTotal > 0 && (
            <TouchableOpacity
              onPress={() => onDebt(item)}
              accessibilityRole="button"
              accessibilityLabel={`${t('clientCard.manageDebt')}: ${item.name}. ${formatMoney(debtTotal)}`}
            >
              <Text style={styles.debtBadge}><Ionicons name="cash" size={12} /> {formatMoney(debtTotal)}</Text>
            </TouchableOpacity>
          )}
          {hasRelationships && (
            <TouchableOpacity
              onPress={() => onRelationship(item)}
              accessibilityRole="button"
              accessibilityLabel={`${t('clientCard.manageFamily')}: ${item.name}. ${t('relationships.badge')}: ${relationshipCount}`}
            >
              <Text style={styles.familyBadge}><Ionicons name="people" size={12} /> {t('relationships.badge')} · {relationshipCount}</Text>
            </TouchableOpacity>
          )}
        </View>
        </View>

        {/* ACTION BUTTONS */}
        <View style={[styles.actionsRow, wideLayout && styles.actionsRowWide]}>
          <View style={[styles.actionButtonsGroup, wideLayout && styles.actionButtonsGroupWide]}>
            {item.phone ? (
              <TouchableOpacity
                onPress={() => callClient(item)}
                style={styles.actionBtn}
                hitSlop={ACTION_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`${t('clientCard.call')}: ${item.name}`}
              >
                <Text style={styles.actionBtnEmoji}>📞</Text>
              </TouchableOpacity>
            ) : null}
            {item.phone ? (
              <TouchableOpacity
                onPress={() => sendWhatsApp(item)}
                style={styles.actionBtn}
                hitSlop={ACTION_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`${t('clientCard.whatsapp')}: ${item.name}`}
              >
                <Text style={styles.actionBtnEmoji}>💬</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => onDebt(item)}
              style={styles.actionBtn}
              hitSlop={ACTION_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`${t(debtTotal > 0 ? 'clientCard.manageDebt' : 'clientCard.addDebt')}: ${item.name}`}
            >
              <Text style={styles.actionBtnEmoji}>{debtTotal > 0 ? '💰' : '💵'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onRelationship(item)}
              style={styles.actionBtn}
              hitSlop={ACTION_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`${t('clientCard.manageFamily')}: ${item.name}`}
            >
              <Text style={styles.actionBtnEmoji}>{hasRelationships ? '👨‍👩‍👧' : '👥'}</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity
                onPress={() => onEdit(item)}
                style={styles.actionBtn}
                hitSlop={ACTION_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`${t('clientCard.editClient')}: ${item.name}`}
              >
                <Text style={styles.actionBtnEmoji}>✏️</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.scheduleButton, wideLayout && styles.scheduleButtonWide]}
            onPress={() => onSchedule(item)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${scheduleAction}: ${item.name}`}
          >
            <Text style={styles.scheduleButtonText}>
              {scheduleAction}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: s(16),
    padding: s(12),
    marginBottom: s(10),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
  },
  cardDebt: {
    borderLeftWidth: 5,
    borderLeftColor: colors.danger,
  },
  cardContent: {
    gap: s(6),
  },
  cardContentWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: s(14),
  },
  infoColumn: {
    flex: 1,
    minWidth: 0,
    gap: s(6),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  avatar: {
    width: s(42),
    height: s(42),
    borderRadius: s(21),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  avatarText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: s(8),
  },
  clientName: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    letterSpacing: 0.2,
  },
  clientPhone: {
    fontSize: s(11),
    color: colors.textMuted,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  clientPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  additionalPhoneBadge: {
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    color: colors.primaryText,
    fontSize: 11,
    fontWeight: '800',
  },
  clientAddress: {
    fontSize: s(12),
    color: colors.textMuted,
    marginTop: s(3),
    opacity: 0.85,
  },
  addressLinkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: s(8),
    paddingVertical: s(6),
    paddingHorizontal: s(10),
    marginTop: s(4),
    minHeight: 44,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  addressLinkText: {
    fontSize: s(13),
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: s(6),
    marginTop: s(2),
  },
  freqBadge: {
    fontSize: s(10),
    fontWeight: '700',
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: s(12),
    overflow: 'hidden',
  },
  inactiveBadge: {
    fontSize: s(10),
    fontWeight: '700',
    color: colors.textWhite,
    backgroundColor: colors.textMuted,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: s(12),
    overflow: 'hidden',
  },
  daysBadge: {
    fontSize: s(11),
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: s(12),
    overflow: 'hidden',
  },
  debtBadge: {
    fontSize: s(10),
    fontWeight: '700',
    color: colors.danger,
    backgroundColor: colors.dangerLight,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: s(12),
    overflow: 'hidden',
  },
  familyBadge: {
    fontSize: s(10),
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: s(12),
    overflow: 'hidden',
  },
  recencyRow: {
    flexDirection: 'row',
    marginTop: s(2),
  },
  recencyBadge: {
    fontSize: s(11),
    fontWeight: '700',
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: s(12),
    overflow: 'hidden',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(8),
    marginTop: s(8),
    paddingTop: s(8),
    borderTopWidth: 1,
    borderTopColor: colors.sectionBackground,
  },
  actionsRowWide: {
    width: s(300),
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    marginTop: 0,
    paddingTop: 0,
    paddingLeft: s(14),
    borderTopWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: colors.sectionBackground,
  },
  actionButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    paddingHorizontal: s(6),
    paddingVertical: s(3),
  },
  actionButtonsGroupWide: {
    width: '100%',
    justifyContent: 'space-between',
  },
  actionBtn: {
    width: s(38),
    height: s(38),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: s(8),
  },
  actionBtnEmoji: {
    fontSize: s(18),
  },
  scheduleButton: {
    backgroundColor: colors.primaryLight,
    minHeight: s(44),
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: s(8),
    justifyContent: 'center',
  },
  scheduleButtonWide: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: s(10),
  },
  scheduleButtonText: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.primaryText,
  },
});
};

export default React.memo(DirectoryClientCard);
