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
import { useProfileStore } from '../stores/profileStore';
import ProfileShareModal from './ProfileShareModal';

interface ProfilesModalProps {
  visible: boolean;
  onClose: () => void;
}

const ProfilesModal: React.FC<ProfilesModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth);

  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const setActiveProfile = useProfileStore((s) => s.setActiveProfile);
  const createProfile = useProfileStore((s) => s.createProfile);
  const renameProfile = useProfileStore((s) => s.renameProfile);
  const deleteProfile = useProfileStore((s) => s.deleteProfile);
  const joinProfile = useProfileStore((s) => s.joinProfile);

  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [shareProfileId, setShareProfileId] = useState<string | null>(null);

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

  return (
    <>
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
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
    <ProfileShareModal
      visible={shareProfileId !== null}
      profileId={shareProfileId}
      onClose={() => setShareProfileId(null)}
    />
    </>
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
      maxHeight: Platform.OS === 'android' ? '100%' : '90%',
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
    headerTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
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
    subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 14 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.sectionBackground,
    },
    rowActive: {},
    radio: { padding: 4 },
    nameInput: {
      flex: 1,
      fontSize: 16,
      color: colors.textPrimary,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: colors.inputBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    nameInputLocked: { opacity: 0.6 },
    iconBtn: { padding: 6 },
    addTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginTop: 22,
      marginBottom: 10,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    addNameInput: {
      flex: 1,
      fontSize: 16,
      color: colors.textPrimary,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: colors.inputBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
    },
    addBtnDisabled: { opacity: 0.5 },
    addBtnText: { color: colors.textWhite, fontSize: 15, fontWeight: '700' },
    hint: { fontSize: 13, color: colors.textHint, marginTop: 10 },
    footer: {
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    doneBtn: {
      backgroundColor: colors.sectionBackground,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    doneBtnText: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  });

export default ProfilesModal;
