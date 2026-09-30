import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import ModalOverlay from './ModalOverlay';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { getModalWidth } from '../utils/helpers';

interface WelcomeModalProps {
  visible: boolean;
  /** Cierra la bienvenida sin acción (Saltar / ✕). */
  onClose: () => void;
  /** Último paso: el usuario quiere cargar su primer cliente. */
  onAddFirstClient: () => void;
}

const SLIDES = [
  { key: 'days', icon: 'calendar-outline' },
  { key: 'done', icon: 'checkmark-circle-outline' },
  { key: 'ai', icon: 'sparkles-outline' },
  { key: 'directory', icon: 'people-outline' },
] as const;

/**
 * Bienvenida de la primera vez: explica cómo está organizada la app (días,
 * Listo/frecuencia, Pedido IA y Directorio) antes de que el usuario vea
 * Inicio vacío.
 */
const WelcomeModal: React.FC<WelcomeModalProps> = ({ visible, onClose, onAddFirstClient }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const { width: windowWidth } = useWindowDimensions();
  const modalWidth = getModalWidth(windowWidth);
  const styles = useMemo(
    () => getStyles(colors, fontScale, modalWidth),
    [colors, fontScale, modalWidth],
  );
  const [index, setIndex] = useState(0);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const close = () => {
    setIndex(0);
    onClose();
  };

  const finish = () => {
    setIndex(0);
    onAddFirstClient();
  };

  return (
    <ModalOverlay visible={visible} onClose={close} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>{t('onboarding.eyebrow')}</Text>
            {!isLast && (
              <TouchableOpacity
                onPress={close}
                accessibilityRole="button"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.iconCircle}>
            <Ionicons name={slide.icon} size={Math.round(34 * fontScale)} color={colors.primary} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {t(`onboarding.${slide.key}Title`)}
          </Text>
          <Text style={styles.body}>{t(`onboarding.${slide.key}Body`)}</Text>

          <View style={styles.dots} accessibilityLabel={t('onboarding.step', { current: index + 1, total: SLIDES.length })}>
            {SLIDES.map((s, i) => (
              <View key={s.key} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>

          {isLast ? (
            <>
              <TouchableOpacity style={styles.primaryBtn} onPress={finish} accessibilityRole="button">
                <Text style={styles.primaryBtnText}>{t('home.gettingStartedAddClient')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={close} accessibilityRole="button">
                <Text style={styles.secondaryBtnText}>{t('onboarding.explore')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.navRow}>
              {index > 0 ? (
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setIndex(index - 1)}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryBtnText}>{t('back')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.primaryBtn, styles.nextBtn]}
                onPress={() => setIndex(index + 1)}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>{t('onboarding.next')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, scale: number, modalWidth?: number) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: s(20),
    },
    card: {
      width: modalWidth ?? '100%',
      maxWidth: 460,
      backgroundColor: colors.card,
      borderRadius: s(20),
      padding: s(22),
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: s(18),
    },
    eyebrow: {
      fontSize: s(12),
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.primary,
    },
    skipText: {
      fontSize: s(14),
      fontWeight: '600',
      color: colors.textMuted,
    },
    iconCircle: {
      width: s(68),
      height: s(68),
      borderRadius: s(34),
      backgroundColor: colors.primaryLighter,
      borderWidth: 1,
      borderColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: s(16),
    },
    title: {
      fontSize: s(21),
      fontWeight: '800',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: s(10),
    },
    body: {
      fontSize: s(15),
      lineHeight: s(22),
      color: colors.textSecondary,
      textAlign: 'center',
      minHeight: s(88),
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: s(6),
      marginVertical: s(18),
    },
    dot: {
      width: s(7),
      height: s(7),
      borderRadius: s(4),
      backgroundColor: colors.cardBorder,
    },
    dotActive: {
      width: s(20),
      backgroundColor: colors.primary,
    },
    navRow: {
      flexDirection: 'row',
      gap: s(10),
    },
    nextBtn: {
      flex: 1,
    },
    backBtn: {
      flex: 1,
      paddingVertical: s(14),
      borderRadius: s(12),
      backgroundColor: colors.sectionBackground,
      alignItems: 'center',
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: s(14),
      borderRadius: s(12),
      alignItems: 'center',
    },
    primaryBtnText: {
      color: colors.textWhite,
      fontSize: s(16),
      fontWeight: '700',
    },
    secondaryBtn: {
      marginTop: s(10),
      paddingVertical: s(12),
      alignItems: 'center',
    },
    secondaryBtnText: {
      color: colors.textSecondary,
      fontSize: s(15),
      fontWeight: '600',
    },
  });
};

export default React.memo(WelcomeModal);
