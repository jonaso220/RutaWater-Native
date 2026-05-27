import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { UndoEntry } from '../hooks/useUndoQueue';

interface UndoBannerProps {
  queue: UndoEntry[];
  selectedDay: string;
  onUndo: () => void;
}

/**
 * Floating banner that surfaces the most recent mark-done plus a "+N"
 * counter when there are queued undos. Tapping "deshacer" reverts the
 * most recent entry.
 *
 * When the most recent entry came from a different day-tab than the one
 * currently selected, the banner appends the source day in parentheses
 * so the user knows which client is being undone.
 */
const UndoBanner: React.FC<UndoBannerProps> = ({ queue, selectedDay, onUndo }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);

  if (queue.length === 0) return null;

  const top = queue[queue.length - 1];
  const otherDay = top.sectionDay !== selectedDay ? ` (${top.sectionDay})` : '';
  const extra = queue.length > 1 ? ` +${queue.length - 1}` : '';

  return (
    <View style={styles.undoBanner}>
      <Text style={styles.undoBannerText} numberOfLines={1}>
        {t('home.clientCompleted', { name: top.client.name })}{otherDay}{extra}
      </Text>
      <TouchableOpacity onPress={onUndo} style={styles.undoButton}>
        <Text style={styles.undoButtonText}>{t('home.undo')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    undoBanner: {
      position: 'absolute',
      bottom: 20,
      left: 16,
      right: 16,
      backgroundColor: colors.textPrimary,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
      zIndex: 999,
    },
    undoBannerText: {
      color: colors.background,
      fontSize: s(15),
      fontWeight: '600',
      flex: 1,
      marginRight: 12,
    },
    undoButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
    },
    undoButtonText: {
      color: colors.textWhite,
      fontSize: s(14),
      fontWeight: '700',
    },
  });
};

export default UndoBanner;
