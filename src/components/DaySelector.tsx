import React, { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { ScrollView as GHScrollView, TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import { ALL_DAYS } from '../constants/products';
import { getTodayDayName } from '../utils/helpers';
import { ThemeColors } from '../theme/colors';

interface DaySelectorProps {
  selectedDay: string;
  dayCounts: Record<string, number>;
  isWide: boolean;
  colors: ThemeColors;
  fontScale: number;
  onSelectDay: (day: string) => void;
}

// Horizontal day chips at the top of HomeScreen. Memoized so it doesn't
// re-render when the client list changes — only when the day counts,
// selection, theme, or layout actually do. Uses gesture-handler
// ScrollView/TouchableOpacity to avoid touch conflicts on Android.
const DaySelector = React.memo<DaySelectorProps>(({
  selectedDay,
  dayCounts,
  isWide,
  colors,
  fontScale,
  onSelectDay,
}) => {
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);
  const todayName = useMemo(() => getTodayDayName(), []);

  return (
    <GHScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.daySelector}
      contentContainerStyle={styles.daySelectorContent}
    >
      {ALL_DAYS.map((day) => {
        const isToday = day === todayName;
        const isSelected = day === selectedDay;
        const count = dayCounts[day] || 0;

        return (
          <GHTouchableOpacity
            key={day}
            onPress={() => onSelectDay(day)}
            style={[
              styles.dayChip,
              isSelected && styles.dayChipSelected,
              isToday && !isSelected && styles.dayChipToday,
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.dayChipText,
                isSelected && styles.dayChipTextSelected,
              ]}
            >
              {isWide ? day : day.slice(0, 3)}
            </Text>
            <Text
              style={[
                styles.dayCount,
                isSelected && styles.dayCountSelected,
              ]}
            >
              {count}
            </Text>
          </GHTouchableOpacity>
        );
      })}
    </GHScrollView>
  );
});

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    daySelector: {
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    daySelectorContent: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      flexGrow: 1,
    },
    dayChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.sectionBackground,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginRight: 8,
    },
    dayChipSelected: {
      backgroundColor: colors.primary,
    },
    dayChipToday: {
      borderWidth: 1.5,
      borderColor: colors.primary,
    },
    dayChipText: {
      fontSize: s(16),
      fontWeight: '600',
      color: colors.textSecondary,
    },
    dayChipTextSelected: {
      color: colors.textWhite,
    },
    dayCount: {
      fontSize: s(13),
      fontWeight: '700',
      color: colors.textMuted,
      backgroundColor: colors.cardBorder,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 8,
      overflow: 'hidden',
    },
    dayCountSelected: {
      color: colors.primary,
      backgroundColor: colors.primaryLight,
    },
  });
};

export default DaySelector;
