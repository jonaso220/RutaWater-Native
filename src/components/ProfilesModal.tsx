import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { getModalWidth } from '../utils/helpers';
import { useLayout } from '../hooks/useLayout';
import { useProfileStore } from '../stores/profileStore';
import { useAuthContext } from '../context/AuthContext';

interface ProfilesModalProps {
  visible: boolean;
  onClose: () => void;
  // 'manage' (Ajustes): renombrar / borrar / compartir.
  // 'quick' (chip del Inicio): solo cambiar de reparto + crear + unirme.
  mode?: 'manage' | 'quick';
}

const ProfilesModal: React.FC<ProfilesModalProps> = ({ visible, onClose, mode = 'manage' }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { width: windowWidth } = useWindowDimensions();
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);

  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const setActiveProfile = useProfileStore((s) => s.setActiveProfile);
  const createProfile = useProfileStore((s) => s.createProfile);
  const renameProfile = useProfileStore((s) => s.renameProfile);
  const deleteProfile = useProfileStore((s) => s.deleteProfile);
  const joinProfile = useProfileStore((s) => s.joinProfile);
  const removeMember = useProfileStore((s) => s.removeMember);
  const leaveProfile = useProfileStore((s) => s.leaveProfile);

  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [shareProfileId, setShareProfileId] = useState<string | null>(null);

  const myUid = user?.uid || '';
  // Panel de compartir embebido (NO un segundo Modal: en iOS apilar modales
  // nativos deja la presentación trabada).
  const shareProfile = profiles.find((p) => p.id === shareProfileId) || null;

  const handleCreate = () => {
    if (!newName.trim()) return;
    createProfile(newName);
    setNewName('');
  };

  const handleSwitch = (id: string) => {
    if (id !== activeProfileId) setActiveProfile(id);
    onClose();
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert(t('settings.deleteProfileTitle'), t('settings.deleteProfileMsg', { name }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => deleteProfile(id) },
    ]);
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    const res = await joinProfile(joinCode);
    setJoinCode('');
    const msgKey =
      res === 'ok'
        ? 'settings.joinOk'
        : res === 'not_found'
        ? 'settings.joinNotFound'
        : res === 'already'
        ? 'settings.joinAlready'
        : 'settings.joinProfileError';
    Alert.alert(res === 'ok' ? t('done') : t('error'), t(msgKey));
  };

  const handleRemoveMember = (uid: string, name: string) => {
    if (!shareProfile) return;
    Alert.alert(t('settings.removeMemberTitle'), t('settings.removeProfileMemberMsg', { name }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settings.removeMember'),
        style: 'destructive',
        onPress: () => removeMember(shareProfile.id, uid),
      },
    ]);
  };

  const handleLeave = () => {
    if (!shareProfile) return;
    const id = shareProfile.id;
    Alert.alert(t('settings.leaveProfileTitle'), t('settings.leaveProfileMsg', { name: shareProfile.name }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settings.leaveProfileAction'),
        style: 'destructive',
        onPress: () => {
          leaveProfile(id);
          setShareProfileId(null);
        },
      },
    ]);
  };

  const memberEntries = shareProfile ? Object.entries(shareProfile.members || {}) : [];

  return (
    <ModalOverlay visible={visible} onClose={onClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('settings.profilesTitle')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.subtitle}>{t('settings.profilesSubtitle')}</Text>

            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              // Quick mode (chip del Inicio): cada reparto es un botón para cambiar.
              if (mode === 'quick') {
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => handleSwitch(p.id)}
                    style={[styles.quickRow, isActive && styles.quickRowActive]}
                  >
                    <Ionicons
                      name={isActive ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={isActive ? colors.primary : colors.textHint}
                    />
                    <Text style={[styles.quickName, isActive && styles.quickNameActive]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {isActive && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }
              return (
                <View key={p.id} style={[styles.row, isActive && styles.rowActive]}>
                  <TouchableOpacity
                    onPress={() => handleSwitch(p.id)}
                    style={styles.radio}
                    accessibilityLabel={t('settings.switchProfile')}
                  >
                    <Ionicons
                      name={isActive ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={isActive ? colors.primary : colors.textHint}
                    />
                  </TouchableOpacity>
                  <TextInput
                    key={`${p.id}-${p.name}`}
                    style={[styles.nameInput, !(p.isPrimary || p.isOwner) && styles.nameInputLocked]}
                    defaultValue={p.name}
                    editable={p.isPrimary || !!p.isOwner}
                    placeholder={t('settings.newProfilePlaceholder')}
                    placeholderTextColor={colors.textHint}
                    onEndEditing={(e) => renameProfile(p.id, e.nativeEvent.text)}
                    returnKeyType="done"
                  />
                  {!p.isPrimary && (
                    <TouchableOpacity
                      onPress={() => setShareProfileId(p.id)}
                      style={styles.iconBtn}
                      accessibilityLabel={t('settings.shareProfileTitle')}
                    >
                      <Ionicons name="people-outline" size={20} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                  {!p.isPrimary && p.isOwner && (
                    <TouchableOpacity
                      onPress={() => handleDelete(p.id, p.name)}
                      style={styles.iconBtn}
                      accessibilityLabel={t('delete')}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            <Text style={styles.addTitle}>{t('settings.createProfileTitle')}</Text>
            <View style={styles.addRow}>
              <TextInput
                style={styles.addNameInput}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('settings.newProfilePlaceholder')}
                placeholderTextColor={colors.textHint}
              />
              <TouchableOpacity
                onPress={handleCreate}
                style={[styles.addBtn, !newName.trim() && styles.addBtnDisabled]}
                disabled={!newName.trim()}
              >
                <Ionicons name="add" size={18} color={colors.textWhite} />
                <Text style={styles.addBtnText}>{t('settings.createProfileBtn')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>{t('settings.profilesHint')}</Text>

            {/* Join a shared route by code */}
            <Text style={styles.addTitle}>{t('settings.joinProfileTitle')}</Text>
            <View style={styles.addRow}>
              <TextInput
                style={styles.addNameInput}
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder={t('settings.joinProfilePlaceholder')}
                placeholderTextColor={colors.textHint}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={handleJoin}
                style={[styles.addBtn, !joinCode.trim() && styles.addBtnDisabled]}
                disabled={!joinCode.trim()}
              >
                <Ionicons name="enter-outline" size={18} color={colors.textWhite} />
                <Text style={styles.addBtnText}>{t('settings.joinProfileBtn')}</Text>
              </TouchableOpacity>
            </View>

            {mode === 'quick' && (
              <Text style={styles.hint}>{t('settings.manageInSettingsHint')}</Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>

          {/* Panel de compartir (overlay embebido, no un segundo modal) */}
          {shareProfile && (
            <View style={styles.shareBackdrop}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setShareProfileId(null)}
              />
              <View style={styles.shareCard}>
                <View style={styles.shareHeader}>
                  <Text style={styles.shareTitle} numberOfLines={1}>
                    {shareProfile.name}
                  </Text>
                  <TouchableOpacity onPress={() => setShareProfileId(null)} style={styles.closeBtn}>
                    <Text style={styles.closeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                  <Text style={styles.shareSection}>{t('settings.shareProfileTitle')}</Text>
                  <View style={styles.codeBox}>
                    <Text style={styles.codeText}>{shareProfile.code || '—'}</Text>
                  </View>
                  <Text style={styles.hint}>{t('settings.profileCodeHint')}</Text>

                  <Text style={[styles.shareSection, { marginTop: 20 }]}>
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
                        {shareProfile.isOwner && !isSelf && (
                          <TouchableOpacity onPress={() => handleRemoveMember(uid, label)} style={styles.iconBtn}>
                            <Ionicons name="close-circle" size={22} color={colors.danger} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}

                  {!shareProfile.isOwner && (
                    <TouchableOpacity onPress={handleLeave} style={styles.leaveBtn}>
                      <Ionicons name="exit-outline" size={18} color={colors.danger} />
                      <Text style={styles.leaveBtnText}>{t('settings.leaveProfileAction')}</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: isTablet ? 'center' : 'flex-end',
      alignItems: 'center',
      paddingHorizontal: isTablet ? s(24) : s(8),
      paddingVertical: isTablet ? s(24) : 0,
    },
    modal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: s(20),
      borderTopRightRadius: s(20),
      borderBottomLeftRadius: isTablet ? s(20) : 0,
      borderBottomRightRadius: isTablet ? s(20) : 0,
      maxHeight: Platform.OS === 'android' ? '100%' : '90%',
      maxWidth: isTablet ? undefined : 600,
      alignSelf: 'center',
      width: isTablet ? modalWidth : '100%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: s(16),
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    headerTitle: { fontSize: s(20), fontWeight: '700', color: colors.textPrimary },
    closeBtn: {
      width: s(32),
      height: s(32),
      borderRadius: s(16),
      backgroundColor: colors.sectionBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeBtnText: { fontSize: s(18), color: colors.textMuted },
    body: { padding: s(16) },
    subtitle: { fontSize: s(14), color: colors.textMuted, marginBottom: s(14) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: s(6),
      gap: s(8),
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
    },
    rowActive: {},
    radio: { padding: s(4) },
    quickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(12),
      paddingVertical: s(14),
      paddingHorizontal: s(14),
      borderRadius: s(12),
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.sectionBackground,
      marginBottom: s(8),
    },
    quickRowActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLighter,
    },
    quickName: { flex: 1, fontSize: s(17), fontWeight: '600', color: colors.textPrimary },
    quickNameActive: { color: colors.primaryDark },
    nameInput: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    nameInputLocked: { opacity: 0.6 },
    iconBtn: { padding: s(6) },
    addTitle: {
      fontSize: s(15),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginTop: s(22),
      marginBottom: s(10),
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: s(8) },
    addNameInput: {
      flex: 1,
      fontSize: s(16),
      color: colors.textPrimary,
      paddingVertical: s(8),
      paddingHorizontal: s(10),
      backgroundColor: colors.inputBackground,
      borderRadius: s(8),
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(6),
      backgroundColor: colors.primary,
      paddingVertical: s(12),
      paddingHorizontal: s(14),
      borderRadius: s(10),
    },
    addBtnDisabled: { opacity: 0.5 },
    addBtnText: { color: colors.textWhite, fontSize: s(15), fontWeight: '700' },
    hint: { fontSize: s(13), color: colors.textHint, marginTop: s(10) },
    footer: {
      padding: s(16),
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    doneBtn: {
      backgroundColor: colors.sectionBackground,
      paddingVertical: s(14),
      borderRadius: s(12),
      alignItems: 'center',
    },
    doneBtnText: { color: colors.textPrimary, fontSize: s(17), fontWeight: '700' },
    // Share panel (embedded overlay)
    shareBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: s(20),
    },
    shareCard: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: colors.card,
      borderRadius: s(16),
      padding: s(16),
    },
    shareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: s(12),
    },
    shareTitle: { fontSize: s(18), fontWeight: '700', color: colors.textPrimary, flex: 1, marginRight: s(8) },
    shareSection: {
      fontSize: s(14),
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: s(8),
    },
    codeBox: {
      backgroundColor: colors.primaryLighter,
      borderRadius: s(12),
      paddingVertical: s(16),
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primaryInactiveBorder,
    },
    codeText: { fontSize: s(30), fontWeight: '800', letterSpacing: 4, color: colors.primaryDark },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: s(10),
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
    },
    memberName: { fontSize: s(16), color: colors.textPrimary, fontWeight: '500' },
    memberRole: { fontSize: s(13), color: colors.textMuted, marginTop: s(2) },
    leaveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(6),
      marginTop: s(18),
      paddingVertical: s(12),
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: colors.danger,
    },
    leaveBtnText: { color: colors.danger, fontSize: s(15), fontWeight: '700' },
  });
};

export default ProfilesModal;
