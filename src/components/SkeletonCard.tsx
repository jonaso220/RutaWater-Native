import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Easing } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

// Placeholder card shaped roughly like a Directory client card, with a
// subtle opacity pulse. Used while the clients list is still loading from
// Firestore — much nicer than a plain spinner for the first-paint moment.
const SkeletonCard: React.FC = () => {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const block = { backgroundColor: colors.sectionBackground };

  return (
    <Animated.View style={[styles.card, { opacity: pulse, borderColor: colors.divider }]}>
      <View style={styles.headerRow}>
        <View style={[styles.avatar, block]} />
        <View style={styles.headerInfo}>
          <View style={[styles.line, styles.lineWide, block]} />
          <View style={[styles.line, styles.lineNarrow, block]} />
        </View>
      </View>
      <View style={styles.badgeRow}>
        <View style={[styles.badge, block]} />
        <View style={[styles.badge, styles.badgeShort, block]} />
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  line: {
    height: 12,
    borderRadius: 6,
    marginBottom: 6,
  },
  lineWide: {
    width: '70%',
  },
  lineNarrow: {
    width: '45%',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    height: 18,
    width: 60,
    borderRadius: 9,
  },
  badgeShort: {
    width: 40,
  },
});

export default SkeletonCard;
