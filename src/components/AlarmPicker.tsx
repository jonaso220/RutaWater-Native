import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { Client } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { useClientsStore } from '../stores/clientsStore';
import { hapticLight } from '../utils/haptics';
import {
  getAlarmPermissionIssue,
  openExactAlarmPermissionSettings,
} from '../services/notifications';
import ModalOverlay from './ModalOverlay';

interface AlarmPickerProps {
  // The client to set an alarm for. `null` keeps the picker hidden.
  client: Client | null;
  // The visit day the alarm should be scheduled for (used by the
  // scheduler to resolve "next Wednesday at 09:00" etc.).
  selectedDay: string;
  // Called when the picker closes for any reason (cancel, save, dismiss).
  onClose: () => void;
}

const formatAlarmFireDate = (d: Date, t: (k: string) => string): string => {
  const dayNames = [t('days.domingo'), t('days.lunes'), t('days.martes'), t('days.miercoles'), t('days.jueves'), t('days.viernes'), t('days.sabado')];
  const monthNames = [t('months.ene'), t('months.feb'), t('months.mar'), t('months.abr'), t('months.may'), t('months.jun'), t('months.jul'), t('months.ago'), t('months.sep'), t('months.oct'), t('months.nov'), t('months.dic')];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((targetStart.getTime() - todayStart.getTime()) / 86400000);
  const base = `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
  if (diffDays === 0) return `${t('home.today')} (${base})`;
  if (diffDays === 1) return `${t('home.tomorrow')} (${base})`;
  return base;
};

/**
 * Time-picker modal for setting a visit alarm on a client.
 *
 * Renders nothing when `client` is null. When mounted with a client:
 * - Android: shows the native time picker (no surrounding chrome).
 * - iOS: shows a centered modal with a spinner picker + Cancel/Save buttons.
 *
 * On save, calls saveAlarm from the clients store and surfaces an Alert
 * with the exact day+time the alarm will fire — important because the
 * scheduler may push the alarm to next week if the chosen time has
 * already passed today.
 */
const AlarmPicker: React.FC<AlarmPickerProps> = ({ client, selectedDay, onClose }) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { fontScale } = useLayout();
  const styles = useMemo(() => getStyles(colors, fontScale), [colors, fontScale]);
  const saveAlarm = useClientsStore((s) => s.saveAlarm);

  const [alarmTime, setAlarmTime] = useState(new Date());
  const savingRef = useRef(false);

  // Each time a new client opens the picker, reset the default time to
  // the next half-hour from now. Keying on client.id makes this idempotent
  // when the same client triggers the picker multiple times in a row.
  useEffect(() => {
    if (client) {
      const now = new Date();
      now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
      setAlarmTime(now);
    }
  }, [client?.id]);

  const showAlarmConfirm = (d: Date) => {
    const when = formatAlarmFireDate(d, t);
    const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    hapticLight();
    Alert.alert(t('home.alarmScheduled'), t('home.alarmScheduledMsg', { when, time }));
  };

  const submit = async (time: Date) => {
    if (!client || savingRef.current) return;
    savingRef.current = true;
    const hours = time.getHours().toString().padStart(2, '0');
    const minutes = time.getMinutes().toString().padStart(2, '0');
    const target = client;
    try {
      onClose();
      const fireAt = await saveAlarm(target.id, `${hours}:${minutes}`, selectedDay);
      if (fireAt) {
        showAlarmConfirm(fireAt);
      } else {
        const permissionIssue = Platform.OS === 'android'
          ? await getAlarmPermissionIssue().catch(() => null)
          : null;
        if (permissionIssue === 'exact-alarm') {
          Alert.alert(
            t('home.exactAlarmPermissionTitle'),
            t('home.exactAlarmPermissionMsg'),
            [
              { text: t('cancel'), style: 'cancel' },
              {
                text: t('home.openAlarmSettings'),
                onPress: () => void openExactAlarmPermissionSettings(),
              },
            ],
          );
          return;
        }
        // Permiso de notificaciones denegado o fallo al programar: avisar en vez
        // de dejar al usuario creyendo que la alarma quedó puesta.
        Alert.alert(t('error'), t('home.alarmFailed'));
      }
    } finally {
      savingRef.current = false;
    }
  };

  if (!client) return null;

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        value={alarmTime}
        mode="time"
        display="default"
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          if (event.type === 'set' && date) {
            submit(date);
          } else {
            onClose();
          }
        }}
      />
    );
  }

  return (
    <ModalOverlay visible onClose={onClose} animationType="fade">
      <View style={styles.alarmOverlay}>
        <View style={styles.alarmModal}>
          <Text style={styles.alarmTitle}>{t('home.selectTime')}</Text>
          <DateTimePicker
            value={alarmTime}
            mode="time"
            display="spinner"
            onChange={(_event: DateTimePickerEvent, date?: Date) => {
              if (date) setAlarmTime(date);
            }}
            locale="es-ES"
            themeVariant={isDark ? 'dark' : 'light'}
            style={{ height: 150 }}
          />
          <View style={styles.alarmActions}>
            <TouchableOpacity style={styles.alarmCancelBtn} onPress={onClose}>
              <Text style={styles.alarmCancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.alarmSaveBtn} onPress={() => submit(alarmTime)}>
              <Text style={styles.alarmSaveText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    alarmOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    alarmModal: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 20,
      maxWidth: 400,
      alignSelf: 'center',
      width: '100%',
    },
    alarmTitle: {
      fontSize: s(20),
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
    },
    alarmActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 12,
    },
    alarmCancelBtn: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.sectionBackground,
    },
    alarmCancelText: {
      fontSize: s(17),
      fontWeight: '600',
      color: colors.textMuted,
    },
    alarmSaveBtn: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primary,
    },
    alarmSaveText: {
      fontSize: s(17),
      fontWeight: '700',
      color: colors.textWhite,
    },
  });
};

export default AlarmPicker;
