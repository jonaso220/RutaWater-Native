import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getModalWidth } from '../utils/helpers';
import { useProfileStore } from '../stores/profileStore';
import { useAuthContext } from '../context/AuthContext';

interface ProfileShareModalProps {
  visible: boolean;
  profileId: string | null;
  onClose: () => void;
}

const ProfileShareModal: React.FC<ProfileShareModalProps> = ({ visible, profileId, onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth);

  const profile = useProfileStore((s) => s.profiles.find((p) => p.id === profileId) || null);
  const removeMember = useProfileStore((s) => s.removeMember);
  const leaveProfile = useProfileStore((s) => s.leaveProfile);

  if (!profile) return null;

  const myUid = user?.uid || '';
  const isOwner = !!profile.isOwner;
  const memberEntries = Object.entries(profile.members || {});

  const handleRemove = (uid: string, name: string) => {
    Alert.alert(t('settings.removeMemberTitle'), t('settings.removeProfileMemberMsg', { name }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('settings.removeMember'), style: 'destructive', onPress: () => removeMember(profile.id, uid) },
    ]);
  };

  const handleLeave = () => {
    Alert.alert(t('settings.leaveProfileTitle'), t('settings.leaveProfileMsg', { name: profile.name }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settings.leaveProfileAction'),
        style: 'destructive',
        onPress: () => {
          leaveProfile(profile.id);
          onClose();
        },
      },
    ]);
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {profile.name}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body}>
            {/* Code */}
            <Text style={styles.sectionTitle}>{t('settings.shareProfileTitle')}</Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeText}>{profile.code || '—'}</Text>
            </View>
            <Text style={styles.hint}>{t('settings.profileCodeHint')}</Text>

            {/* Members */}
            <Text style={[styles.sectionTitle, { marginTop: 22 }]}>
              {t('settings.members')} ({memberEntries.length})
            </Text>
            {memberEntries.map(([uid, m]) => {
              const label = m.name || m.email || uid;
              const isSelf = uid === myUid;
              return (
                <View key={uid} style={styles.memberRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>
                      {label} {isSelf ? t('settings.youSuffix') : ''}
                    </Text>
                    <Text style={styles.memberRole}>
                      {m.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleMember')}
                    </Text>
                  </View>
                  {isOwner && !isSelf && (
                    <TouchableOpacity onPress={() => handleRemove(uid, label)} style={styles.removeBtn}>
                      <Ionicons name="close-circle" size={22} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {/* Leave (members only) */}
            {!isOwner && (
              <TouchableOpacity onPress={handleLeave} style={styles.leaveBtn}>
                <Ionicons name="exit-outline" size={18} color={colors.danger} />
                <Text style={styles.leaveBtnText}>{t('settings.leaveProfileAction')}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: isTablet ? 'center' : 'flex-end',
      alignItems: 'center',
      paddingHorizontal: isTablet ? 24 : 8,
      paddingVertical: isTablet ? 24 : 0,
    },
    modal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderBottomLeftRadius: isTablet ? 20 : 0,
      borderBottomRightRadius: isTablet ? 20 : 0,
      maxHeight: '85%',
      maxWidth: isTablet ? undefined : 600,
      alignSelf: 'center',
      width: isTablet ? modalWidth : '100%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, flex: 1 },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeBtnText: { fontSize: 18, color: colors.textMuted },
    body: { padding: 16 },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    codeBox: {
      backgroundColor: colors.primaryLighter,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primaryInactiveBorder,
    },
    codeText: {
      fontSize: 30,
      fontWeight: '800',
      letterSpacing: 4,
      color: colors.primaryDark,
    },
    hint: { fontSize: 13, color: colors.textHint, marginTop: 8 },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
    },
    memberName: { fontSize: 16, color: colors.textPrimary, fontWeight: '500' },
    memberRole: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    removeBtn: { padding: 4 },
    leaveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 20,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    leaveBtnText: { color: colors.danger, fontSize: 15, fontWeight: '700' },
    footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.cardBorder },
    doneBtn: {
      backgroundColor: colors.sectionBackground,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    doneBtnText: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  });

export default ProfileShareModal;
