import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ModalOverlay from './ModalOverlay';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';

interface CalendarModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Read-only month calendar. Opens on the current month with today highlighted,
 * and lets the user page through other months with the arrows. Week starts on
 * Monday to match the app's day tabs (Lunes…Domingo).
 */
const CalendarModal: React.FC<CalendarModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);

  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Each time it opens, snap back to the current month positioned on today.
  useEffect(() => {
    if (visible) {
      const now = new Date();
      setView({ year: now.getFullYear(), month: now.getMonth() });
    }
  }, [visible]);

  const monthNames = t('monthNames', { returnObjects: true }) as string[];
  const dayNamesRaw = t('dayNames', { returnObjects: true }) as string[]; // Sunday-first

  // Monday-first short weekday labels (Lun, Mar, Mié, …, Dom).
  const weekHeader = useMemo(() => {
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.map((i) => (dayNamesRaw[i] || '').slice(0, 3));
  }, [dayNamesRaw]);

  // Build the month grid (Monday-first), padded with nulls to full weeks.
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const offset = (first.getDay() + 6) % 7; // leading blanks before day 1
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < offset; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [view]);

  const now = new Date();
  const isCurrentMonth =
    view.year === now.getFullYear() && view.month === now.getMonth();
  const todayDate = now.getDate();

  const goPrev = () =>
    setView((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 },
    );
  const goNext = () =>
    setView((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 },
    );
  const goToday = () => {
    const n = new Date();
    setView({ year: n.getFullYear(), month: n.getMonth() });
  };

  const s = (v: number) => Math.round(v * fontScale);

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="fade">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.dialog} activeOpacity={1} onPress={() => {}}>
          {/* Header: ‹  Mes Año  › */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={goPrev}
              style={styles.navBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={s(24)} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {monthNames[view.month]} {view.year}
            </Text>
            <TouchableOpacity
              onPress={goNext}
              style={styles.navBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-forward" size={s(24)} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Weekday header */}
          <View style={styles.weekRow}>
            {weekHeader.map((w, i) => (
              <Text key={i} style={[styles.weekday, i === 6 && styles.sundayLabel]}>
                {w}
              </Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {cells.map((d, i) => {
              const isToday = isCurrentMonth && d === todayDate;
              const isSunday = i % 7 === 6;
              return (
                <View key={i} style={styles.cell}>
                  {d ? (
                    <View style={[styles.dayCircle, isToday && styles.todayCircle]}>
                      <Text
                        style={[
                          styles.dayText,
                          isSunday && styles.sundayText,
                          isToday && styles.todayText,
                        ]}
                      >
                        {d}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            {!isCurrentMonth ? (
              <TouchableOpacity onPress={goToday} style={styles.todayBtn} activeOpacity={0.7}>
                <Ionicons name="today-outline" size={s(15)} color={colors.primary} />
                <Text style={styles.todayBtnText}>{t('home.today')}</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Text style={styles.closeText}>{t('close')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: s(24),
    },
    dialog: {
      backgroundColor: colors.card,
      borderRadius: s(16),
      padding: s(16),
      width: '100%',
      maxWidth: s(380),
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: s(12),
    },
    navBtn: {
      width: s(36),
      height: s(36),
      borderRadius: s(8),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: s(18),
      fontWeight: '800',
      color: colors.textPrimary,
      textTransform: 'capitalize',
    },
    weekRow: {
      flexDirection: 'row',
      marginBottom: s(6),
    },
    weekday: {
      flex: 1,
      textAlign: 'center',
      fontSize: s(12),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
    },
    sundayLabel: {
      color: colors.danger,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: s(2),
    },
    dayCircle: {
      width: s(34),
      height: s(34),
      borderRadius: s(17),
      justifyContent: 'center',
      alignItems: 'center',
    },
    todayCircle: {
      backgroundColor: colors.primary,
    },
    dayText: {
      fontSize: s(15),
      fontWeight: '600',
      color: colors.textPrimary,
    },
    sundayText: {
      color: colors.danger,
    },
    todayText: {
      color: colors.textWhite,
      fontWeight: '800',
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: s(14),
    },
    todayBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(5),
      paddingVertical: s(8),
      paddingHorizontal: s(12),
      borderRadius: s(8),
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
    },
    todayBtnText: {
      fontSize: s(14),
      fontWeight: '700',
      color: colors.primary,
    },
    closeBtn: {
      paddingVertical: s(8),
      paddingHorizontal: s(16),
      borderRadius: s(8),
      backgroundColor: colors.sectionBackground,
    },
    closeText: {
      fontSize: s(15),
      fontWeight: '700',
      color: colors.textMuted,
    },
  });
};

export default CalendarModal;
