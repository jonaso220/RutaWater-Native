import React, { useMemo } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { useLayout } from '../hooks/useLayout';
import { useProfileStore } from '../stores/profileStore';

/**
 * Chip del header del Inicio que muestra el reparto activo y abre el gestor de
 * repartos al tocarlo (para cambiar rápido sin entrar a Ajustes).
 */
const ProfileSwitcherButton: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { fontScale } = useLayout();
  const styles = useMemo(() => getStyles(fontScale), [fontScale]);
  const iconSize = Math.round(14 * fontScale);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const setSwitcherVisible = useProfileStore((s) => s.setSwitcherVisible);

  // Se muestra siempre: da contexto (en qué reparto estás) y abre el gestor para
  // crear/cambiar de reparto.
  const name = activeProfile?.name || t('settings.defaultPrimaryProfile');
  const shown = name.length > 14 ? name.slice(0, 13) + '…' : name;

  return (
    <TouchableOpacity
      onPress={() => setSwitcherVisible(true)}
      style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.18)' }]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={t('settings.switchProfile')}
    >
      <Ionicons name="git-branch" size={iconSize} color={colors.headerText} style={{ marginRight: 4 }} />
      <Text style={[styles.text, { color: colors.headerText }]} numberOfLines={1}>
        {shown}
      </Text>
      <Ionicons name="chevron-down" size={iconSize} color={colors.headerText} style={{ marginLeft: 2 }} />
    </TouchableOpacity>
  );
};

const getStyles = (scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: s(10),
      paddingVertical: s(5),
      borderRadius: s(14),
      marginRight: 12,
      maxWidth: s(160),
    },
    text: { fontSize: s(14), fontWeight: '600' },
  });
};

export default ProfileSwitcherButton;
