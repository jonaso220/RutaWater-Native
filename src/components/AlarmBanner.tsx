import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { AlarmData } from '../hooks/useAlarmChecker';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface Props {
  alarm: AlarmData | null;
  onDismiss: () => void;
}

const AlarmBanner: React.FC<Props> = ({ alarm, onDismiss }) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  if (!alarm) return null;

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.bellContainer}>
            <Text style={styles.bellIcon}>🔔</Text>
          </View>
          <Text style={styles.time}>{alarm.time}</Text>
          <Text style={styles.label}>Recordatorio de Visita</Text>
          <View style={styles.clientBox}>
            <Text style={styles.clientName}>{alarm.name}</Text>
            {alarm.address ? (
              <Text style={styles.clientAddress}>📍 {alarm.address}</Text>
            ) : null}
          </View>
          <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={styles.dismissText}>¡Entendido!</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderTopWidth: 6,
    borderTopColor: '#FACC15',
  },
  bellContainer: {
    backgroundColor: '#FACC15',
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -52,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  bellIcon: {
    fontSize: 30,
  },
  time: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FACC15',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  clientBox: {
    backgroundColor: colors.sectionBackground,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  clientName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  clientAddress: {
    fontSize: 14,
    color: colors.textMuted,
  },
  dismissBtn: {
    backgroundColor: '#FACC15',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default React.memo(AlarmBanner);
