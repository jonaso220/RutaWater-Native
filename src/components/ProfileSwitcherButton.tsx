import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { useProfileStore } from '../stores/profileStore';

/**
 * Chip del header del Inicio que muestra el reparto activo y abre el gestor de
 * repartos al tocarlo (para cambiar rápido sin entrar a Ajustes).
 */
const ProfileSwitcherButton: React.FC = () => {
  const { colors } = useTheme();
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const setSwitcherVisible = useProfileStore((s) => s.setSwitcherVisible);

  // Se muestra siempre: da contexto (en qué reparto estás) y abre el gestor para
  // crear/cambiar de reparto.
  const name = activeProfile?.name || 'Reparto 1';
  const shown = name.length > 14 ? name.slice(0, 13) + '…' : name;

  return (
    <TouchableOpacity
      onPress={() => setSwitcherVisible(true)}
      style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.18)' }]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="git-branch" size={14} color={colors.headerText} style={{ marginRight: 4 }} />
      <Text style={[styles.text, { color: colors.headerText }]} numberOfLines={1}>
        {shown}
      </Text>
      <Ionicons name="chevron-down" size={14} color={colors.headerText} style={{ marginLeft: 2 }} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 12,
    maxWidth: 160,
  },
  text: { fontSize: 14, fontWeight: '600' },
});

export default ProfileSwitcherButton;
