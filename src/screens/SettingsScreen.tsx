import React, { useState } from 'react';
import { reportError } from '../lib/crashReporting';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import ModalOverlay from '../components/ModalOverlay';
import { getModalWidth } from '../utils/helpers';
import { formatShortDate } from '../utils/format';
import { useAuthContext } from '../context/AuthContext';
import { useClientsStore } from '../stores/clientsStore';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { useSubscriptionStore } from '../stores/subscriptionStore';
import { useGroupManagement } from '../hooks/useGroupManagement';
import { useDataExport } from '../hooks/useDataExport';
import { useDataRestore } from '../hooks/useDataRestore';
import ProductCatalogModal from '../components/ProductCatalogModal';
import ProfilesModal from '../components/ProfilesModal';
import WhatsAppTemplatesModal from '../components/WhatsAppTemplatesModal';
import { useProfileStore } from '../stores/profileStore';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { fontScale, width: screenWidth } = useLayout();
  const isTablet = screenWidth >= 600;
  const groupModalWidth = getModalWidth(screenWidth);
  const styles = getStyles(colors, fontScale, isTablet, groupModalWidth);
  const { user: firebaseUser, groupData, isAdmin, signOut, deleteAccount, setGroupData } = useAuthContext();
  const clientCount = useClientsStore((s) => s.clientCount);
  const findDuplicateClients = useClientsStore((s) => s.findDuplicateClients);
  const cleanupDuplicates = useClientsStore((s) => s.cleanupDuplicates);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const currentPlan = useSubscriptionStore((s) => s.currentPlan);
  const expirationDate = useSubscriptionStore((s) => s.expirationDate);
  const isTrialActive = useSubscriptionStore((s) => s.isTrialActive);
  const hasPromo = useSubscriptionStore((s) => s.hasPromo);
  const redeemCode = useSubscriptionStore((s) => s.redeemCode);
  const removePromo = useSubscriptionStore((s) => s.removePromo);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [productsModalVisible, setProductsModalVisible] = useState(false);
  const [profilesModalVisible, setProfilesModalVisible] = useState(false);
  const [whatsappModalVisible, setWhatsappModalVisible] = useState(false);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  // ALL hooks must be called before any early return (Rules of Hooks)
  const [loading, setLoading] = useState(false);

  const uid = firebaseUser?.uid || '';
  const userEmail = firebaseUser?.email || '';
  const userDisplayName = firebaseUser?.displayName || '';

  const {
    members,
    joinCode,
    setJoinCode,
    handleCreateGroup,
    handleJoinGroup,
    handleLeaveGroup,
    handleRemoveMember,
    handleDissolveGroup,
  } = useGroupManagement(
    { uid, email: userEmail, displayName: userDisplayName },
    groupData,
    setGroupData,
    setLoading,
  );

  const activeProfileName = activeProfile?.name || t('settings.defaultPrimaryProfile');
  const { handleExportCSV, handleExportJSON } = useDataExport({
    uid,
    email: userEmail,
    profileName: activeProfileName,
  });
  const { handleRestoreJSON, restoring } = useDataRestore({
    userId: uid,
    groupId: activeProfile?.scopeGroupId,
    profileName: activeProfileName,
  });

  if (!firebaseUser) return null;
  const user = {
    uid,
    email: userEmail,
    displayName: userDisplayName,
  };
  const onSignOut = signOut;

  const handleCleanupDuplicates = () => {
    const { staleIds } = findDuplicateClients();
    if (staleIds.length === 0) {
      Alert.alert(t('settings.noDuplicatesTitle'), t('settings.noDuplicates'));
      return;
    }
    Alert.alert(
      t('settings.duplicatesFoundTitle'),
      t('settings.duplicatesFoundMsg', { count: staleIds.length }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('settings.cleanDuplicatesAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              const count = await cleanupDuplicates();
              Alert.alert(t('done'), t('settings.duplicatesCleaned', { count }));
            } catch (e) {
              reportError(e, 'Error cleaning duplicates');
              Alert.alert(t('error'), t('settings.duplicatesCleanError'));
            }
          },
        },
      ],
    );
  };

  const handleRedeemPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    try {
      const result = await redeemCode(promoCode);
      Alert.alert(result.success ? t('settings.promoSuccess') : t('error'), result.message);
      if (result.success) setPromoCode('');
    } catch {
      Alert.alert(t('error'), t('settings.promoRedeemError'));
    }
    setPromoLoading(false);
  };

  const handleRemovePromo = () => {
    Alert.alert(t('settings.removePromoTitle'), t('settings.removePromoMsg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settings.removeMember'),
        style: 'destructive',
        onPress: async () => {
          await removePromo();
          Alert.alert(t('done'), t('settings.premiumDeactivated'));
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('settings.deleteAccount'),
      t('settings.deleteAccountMsg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('settings.deleteAccount'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('settings.confirmDeleteTitle'),
              t('settings.confirmDeleteMsg'),
              [
                { text: t('settings.noCancel'), style: 'cancel' },
                {
                  text: t('settings.yesDelete'),
                  style: 'destructive',
                  onPress: async () => {
                    setLoading(true);
                    try {
                      await deleteAccount();
                    } catch (e: any) {
                      if (e.message === 'REQUIRES_RECENT_LOGIN') {
                        Alert.alert(
                          t('settings.sessionExpired'),
                          t('settings.sessionExpiredMsg'),
                        );
                      } else {
                        Alert.alert(t('error'), t('settings.deleteAccountError'));
                      }
                    }
                    setLoading(false);
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* User info */}
      <View style={styles.section}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user.displayName || user.email || '?')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user.displayName}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            {groupData && (
              <Text style={styles.roleBadge}>
                {groupData.role === 'admin' ? t('settings.admin') : t('settings.member')}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Subscription status */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="diamond-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>{t('settings.subscription')}</Text>
        </View>
        {isPremium ? (
          <View style={styles.premiumCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="diamond" size={20} color={colors.primary} />
              <Text style={styles.premiumLabel}>{t('settings.premiumLabel')}</Text>
              {isTrialActive && (
                <View style={styles.trialTag}>
                  <Text style={styles.trialTagText}>{t('settings.trialLabel')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.premiumPlan}>
              {t('settings.plan')} {currentPlan === 'annual' ? t('settings.annual') : t('settings.monthly')}
            </Text>
            {expirationDate && (
              <Text style={styles.premiumExpiry}>
                {t('settings.renews')}: {formatShortDate(expirationDate)}
              </Text>
            )}
            <TouchableOpacity
              onPress={() => {
                Linking.openURL(
                  Platform.OS === 'ios'
                    ? 'https://apps.apple.com/account/subscriptions'
                    : 'https://play.google.com/store/account/subscriptions',
                );
              }}
              style={styles.manageBtn}
            >
              <Text style={styles.manageBtnText}>{t('settings.manageSub')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.freeCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.freePlanLabel}>{t('settings.freePlan')}</Text>
              <Text style={styles.freeCount}>{t('settings.clientsUsed', { count: clientCount, limit: FREE_CLIENT_LIMIT })}</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${Math.min(100, (clientCount / FREE_CLIENT_LIMIT) * 100)}%` }]} />
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate('Paywall')}
              style={styles.upgradeBtn}
            >
              <Ionicons name="diamond" size={18} color="#FFFFFF" />
              <Text style={styles.upgradeBtnText}>{t('settings.getPremium')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Promo code section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="gift-outline" size={20} color={colors.warningDark} />
          <Text style={styles.sectionTitle}>{t('settings.promoCode')}</Text>
        </View>
        {hasPromo ? (
          <View style={styles.premiumCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="gift" size={20} color={colors.primary} />
              <Text style={styles.premiumLabel}>{t('settings.premiumActivated')}</Text>
            </View>
            <Text style={styles.premiumPlan}>{t('settings.activatedWithCode')}</Text>
            <TouchableOpacity onPress={handleRemovePromo} style={styles.manageBtn}>
              <Text style={[styles.manageBtnText, { color: colors.danger }]}>{t('settings.deactivate')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.joinRow}>
            <TextInput
              style={styles.joinInput}
              value={promoCode}
              onChangeText={setPromoCode}
              placeholder={t('settings.promoPlaceholder')}
              placeholderTextColor={colors.textHint}
              autoCapitalize="characters"
              maxLength={20}
            />
            <TouchableOpacity
              onPress={handleRedeemPromo}
              style={[styles.joinBtn, (!promoCode.trim() || promoLoading) && styles.joinBtnDisabled]}
              disabled={!promoCode.trim() || promoLoading}
            >
              {promoLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.joinBtnText}>{t('settings.redeem')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Management group heading */}
      <Text style={styles.groupHeading}>{t('settings.managementGroup')}</Text>

      {/* Management — consolidated list (Family group / Repartos / Products / WhatsApp) */}
      <View style={styles.section}>
        <View style={styles.mgmtCard}>
          {/* Grupo Familiar */}
          <TouchableOpacity style={styles.mgmtRow} onPress={() => setGroupModalVisible(true)} activeOpacity={0.6}>
            <Ionicons name="people-outline" size={22} color={colors.primary} style={styles.mgmtIcon} />
            <View style={styles.mgmtRowText}>
              <Text style={styles.mgmtRowTitle}>{t('settings.familyGroup')}</Text>
              <Text style={styles.mgmtRowSubtitle} numberOfLines={2}>{t('settings.familyGroupSubtitle')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
          </TouchableOpacity>

          <View style={styles.mgmtDivider} />

          {/* Repartos */}
          <TouchableOpacity style={styles.mgmtRow} onPress={() => setProfilesModalVisible(true)} activeOpacity={0.6}>
            <Ionicons name="git-branch-outline" size={22} color={colors.primary} style={styles.mgmtIcon} />
            <View style={styles.mgmtRowText}>
              <Text style={styles.mgmtRowTitle}>{t('settings.profilesTitle')}</Text>
              <Text style={styles.mgmtRowSubtitle} numberOfLines={2}>{t('settings.profilesSubtitle')}</Text>
            </View>
            {activeProfile ? <Text style={styles.mgmtRowValue} numberOfLines={1}>{activeProfile.name}</Text> : null}
            <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
          </TouchableOpacity>

          <View style={styles.mgmtDivider} />

          {/* Productos */}
          <TouchableOpacity style={styles.mgmtRow} onPress={() => setProductsModalVisible(true)} activeOpacity={0.6}>
            <Ionicons name="cube-outline" size={22} color={colors.primary} style={styles.mgmtIcon} />
            <View style={styles.mgmtRowText}>
              <Text style={styles.mgmtRowTitle}>{t('settings.productsTitle')}</Text>
              <Text style={styles.mgmtRowSubtitle} numberOfLines={2}>{t('settings.productsSubtitle')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
          </TouchableOpacity>

          <View style={styles.mgmtDivider} />

          {/* Mensajes WhatsApp */}
          <TouchableOpacity style={styles.mgmtRow} onPress={() => setWhatsappModalVisible(true)} activeOpacity={0.6}>
            <Ionicons name="logo-whatsapp" size={22} color={colors.successDark} style={styles.mgmtIcon} />
            <View style={styles.mgmtRowText}>
              <Text style={styles.mgmtRowTitle}>{t('settings.whatsappMessages')}</Text>
              <Text style={styles.mgmtRowSubtitle} numberOfLines={2}>{t('settings.whatsappSubtitle')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textHint} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Family group — modal (same content/logic as before, moved into a modal) */}
      <ModalOverlay visible={groupModalVisible} onClose={() => setGroupModalVisible(false)} animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.groupModalOverlay}
        >
          <View style={styles.groupModalCard}>
            <View style={styles.groupModalHeader}>
              <Text style={styles.groupModalTitle}>{t('settings.familyGroup')}</Text>
              <TouchableOpacity onPress={() => setGroupModalVisible(false)} style={styles.groupModalClose}>
                <Text style={styles.groupModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.groupModalBody} keyboardShouldPersistTaps="handled">
              {groupData ? (
                <View>
                  {/* Group code */}
                  <View style={styles.codeCard}>
                    <Text style={styles.codeLabel}>{t('settings.groupCode')}</Text>
                    <Text style={styles.codeValue}>{groupData.code}</Text>
                    <Text style={styles.codeHint}>
                      {t('settings.shareCodeHint')}
                    </Text>
                  </View>

                  {/* Members */}
                  <Text style={styles.subsectionTitle}>
                    {t('settings.members')} ({members.length})
                  </Text>
                  {members.map((member) => (
                    <View key={member.id} style={styles.memberRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>
                          {member.displayName || member.email}
                        </Text>
                        <Text style={styles.memberRole}>
                          {member.role === 'admin' ? t('settings.admin') : t('settings.member')}
                        </Text>
                      </View>
                      {isAdmin && member.id !== user.uid && (
                        <TouchableOpacity
                          onPress={() =>
                            handleRemoveMember(
                              member.id,
                              member.displayName || member.email,
                            )
                          }
                          style={styles.removeBtn}
                        >
                          <Text style={styles.removeBtnText}>{t('settings.removeMember')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  {/* Group actions */}
                  <View style={styles.groupActions}>
                    {!isAdmin && (
                      <TouchableOpacity
                        onPress={handleLeaveGroup}
                        style={styles.dangerBtn}
                      >
                        <Text style={styles.dangerBtnText}>{t('settings.leaveGroup')}</Text>
                      </TouchableOpacity>
                    )}
                    {isAdmin && (
                      <TouchableOpacity
                        onPress={handleDissolveGroup}
                        style={styles.dangerBtn}
                      >
                        <Text style={styles.dangerBtnText}>{t('settings.dissolveGroup')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ) : isPremium ? (
                <View>
                  <Text style={styles.noGroupText}>
                    {t('settings.noGroupText')}
                  </Text>

                  <TouchableOpacity
                    onPress={handleCreateGroup}
                    style={styles.primaryBtn}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>{t('settings.createGroup')}</Text>
                    )}
                  </TouchableOpacity>

                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>{t('settings.or')}</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <View style={styles.joinRow}>
                    <TextInput
                      style={styles.joinInput}
                      value={joinCode}
                      onChangeText={setJoinCode}
                      placeholder={t('settings.joinPlaceholder')}
                      placeholderTextColor={colors.textHint}
                      autoCapitalize="characters"
                      maxLength={6}
                    />
                    <TouchableOpacity
                      onPress={handleJoinGroup}
                      style={[styles.joinBtn, !joinCode && styles.joinBtnDisabled]}
                      disabled={!joinCode || loading}
                    >
                      <Text style={styles.joinBtnText}>{t('settings.joinGroup')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View>
                  <View style={styles.lockedCard}>
                    <Ionicons name="lock-closed" size={24} color={colors.textHint} />
                    <Text style={styles.lockedText}>
                      {t('settings.groupsPremiumMsg')}
                    </Text>
                    <TouchableOpacity
                      onPress={() => { setGroupModalVisible(false); navigation.navigate('Paywall'); }}
                      style={styles.upgradeBtn}
                    >
                      <Ionicons name="diamond" size={16} color="#FFFFFF" />
                      <Text style={styles.upgradeBtnText}>{t('settings.getPremium')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </ModalOverlay>

      {/* Export & Maintenance */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="construct" size={20} color={colors.textMuted} />
          <Text style={styles.sectionTitle}>{t('settings.tools')}</Text>
        </View>
        <View style={styles.sectionCard}>
          {/* Export */}
          <Text style={styles.cardGroupTitle}>{t('settings.exportDataTitle')}</Text>
          {isPremium ? (
            <View style={styles.cardGroupContent}>
              <TouchableOpacity onPress={handleExportCSV} style={styles.exportBtn}>
                <Ionicons name="share-outline" size={18} color={colors.primary} />
                <Text style={styles.exportBtnText}>{t('settings.exportCSV')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleExportJSON} style={styles.exportBtn}>
                <Ionicons name="save-outline" size={18} color={colors.primary} />
                <Text style={styles.exportBtnText}>{t('settings.exportJSON')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRestoreJSON}
                style={[styles.exportBtn, restoring && { opacity: 0.6 }]}
                disabled={restoring}
              >
                {restoring ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
                )}
                <Text style={styles.exportBtnText}>
                  {restoring ? t('settings.restoreWorking') : t('settings.restoreJSON')}
                </Text>
              </TouchableOpacity>
              <Text style={styles.cardGroupHint}>{t('settings.restoreHint')}</Text>
            </View>
          ) : (
            <View style={styles.lockedCard}>
              <Ionicons name="lock-closed" size={24} color={colors.textHint} />
              <Text style={styles.lockedText}>
                {t('settings.exportPremiumMsg')}
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Paywall')}
                style={styles.upgradeBtn}
              >
                <Ionicons name="diamond" size={16} color="#FFFFFF" />
                <Text style={styles.upgradeBtnText}>{t('settings.getPremium')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.templateDivider} />

          {/* Maintenance */}
          <Text style={styles.cardGroupTitle}>{t('settings.maintenance')}</Text>
          <TouchableOpacity onPress={handleCleanupDuplicates} style={styles.exportBtn}>
            <Ionicons name="copy-outline" size={18} color={colors.primary} />
            <Text style={styles.exportBtnText}>{t('settings.cleanDuplicates')}</Text>
          </TouchableOpacity>
          <Text style={styles.cardGroupHint}>
            {t('settings.cleanDuplicatesHint')}
          </Text>
        </View>
      </View>

      {/* Account actions */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="person-circle-outline" size={20} color={colors.textMuted} />
          <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
        </View>
        <View style={styles.sectionCard}>
          <TouchableOpacity onPress={onSignOut} style={styles.signOutBtn}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
          </TouchableOpacity>

          <View style={styles.templateDivider} />

          <TouchableOpacity
            onPress={handleDeleteAccount}
            style={styles.deleteAccountBtn}
            disabled={loading}
          >
            <Ionicons name="trash-outline" size={18} color={colors.textHint} />
            <Text style={styles.deleteAccountText}>{t('settings.deleteAccount')}</Text>
          </TouchableOpacity>
          <Text style={styles.deleteAccountHint}>
            {t('settings.deleteAccountHint')}
          </Text>
        </View>
      </View>

      <View style={{ height: 60 }} />
    </ScrollView>
    <ProductCatalogModal
      visible={productsModalVisible}
      onClose={() => setProductsModalVisible(false)}
    />
    <ProfilesModal
      visible={profilesModalVisible}
      onClose={() => setProfilesModalVisible(false)}
    />
    <WhatsAppTemplatesModal
      visible={whatsappModalVisible}
      onClose={() => setWhatsappModalVisible(false)}
      uid={uid}
      groupId={groupData?.groupId}
    />
    </>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1, isTablet: boolean = false, modalWidth?: number) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  groupModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: isTablet ? 'center' : 'flex-end',
    alignItems: 'center',
    paddingHorizontal: isTablet ? s(24) : s(8),
    paddingVertical: isTablet ? s(24) : 0,
  },
  groupModalCard: {
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
  groupModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: s(16),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  groupModalTitle: { fontSize: s(20), fontWeight: '700', color: colors.textPrimary },
  groupModalClose: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupModalCloseText: { fontSize: s(18), color: colors.textMuted },
  groupModalBody: { padding: s(16) },
  contentContainer: {
    maxWidth: 800,
    width: '100%' as const,
    alignSelf: 'center' as const,
  },
  section: {
    paddingHorizontal: s(16),
    paddingTop: s(20),
    paddingBottom: s(4),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(4),
  },
  sectionTitle: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  groupHeading: {
    fontSize: s(12),
    fontWeight: '700',
    color: colors.textHint,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: s(24),
    marginBottom: s(-8),
    marginHorizontal: s(16),
  },
  mgmtCard: {
    backgroundColor: colors.card,
    borderRadius: s(12),
    marginTop: s(8),
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  mgmtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingVertical: s(13),
    paddingHorizontal: s(16),
  },
  mgmtIcon: {
    width: s(24),
    textAlign: 'center',
  },
  mgmtRowText: {
    flex: 1,
  },
  mgmtRowTitle: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  mgmtRowSubtitle: {
    fontSize: s(12),
    color: colors.textHint,
    marginTop: s(2),
  },
  mgmtRowValue: {
    fontSize: s(13),
    color: colors.textMuted,
    marginRight: s(4),
    maxWidth: s(120),
  },
  mgmtDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginLeft: s(52),
  },
  sectionSubtitle: {
    fontSize: s(13),
    color: colors.textHint,
    marginBottom: s(12),
    marginLeft: s(28),
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: s(12),
    padding: s(16),
    marginTop: s(8),
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardGroupTitle: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: s(10),
  },
  cardGroupContent: {
    gap: s(8),
  },
  cardGroupHint: {
    fontSize: s(12),
    color: colors.textHint,
    marginTop: s(6),
  },
  subsectionTitle: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: s(16),
    marginBottom: s(8),
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: s(12),
    padding: s(16),
    gap: s(12),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  avatar: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: s(22),
    fontWeight: '700',
  },
  userName: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  userEmail: {
    fontSize: s(14),
    color: colors.textMuted,
    marginTop: s(2),
  },
  roleBadge: {
    fontSize: s(13),
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: s(8),
    paddingVertical: s(2),
    borderRadius: s(6),
    alignSelf: 'flex-start',
    marginTop: s(4),
    overflow: 'hidden',
  },
  codeCard: {
    backgroundColor: colors.primaryLighter,
    borderRadius: s(12),
    padding: s(16),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  codeLabel: {
    fontSize: s(14),
    color: colors.textMuted,
    fontWeight: '600',
  },
  codeValue: {
    fontSize: s(32),
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 4,
    marginVertical: s(8),
  },
  codeHint: {
    fontSize: s(13),
    color: colors.textHint,
    textAlign: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: s(10),
    padding: s(12),
    marginBottom: s(6),
    borderWidth: 1,
    borderColor: colors.sectionBackground,
  },
  memberName: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.textPrimary,
  },
  memberRole: {
    fontSize: s(13),
    color: colors.textMuted,
    marginTop: s(2),
  },
  removeBtn: {
    backgroundColor: colors.dangerLight,
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: s(6),
  },
  removeBtnText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(14),
  },
  groupActions: {
    marginTop: s(16),
  },
  dangerBtn: {
    backgroundColor: colors.dangerLight,
    paddingVertical: s(12),
    borderRadius: s(10),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  dangerBtnText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(16),
  },
  noGroupText: {
    fontSize: s(16),
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: s(16),
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: s(14),
    borderRadius: s(12),
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: s(18),
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: s(16),
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  dividerText: {
    color: colors.textHint,
    paddingHorizontal: s(12),
    fontSize: s(15),
  },
  joinRow: {
    flexDirection: 'row',
    gap: s(8),
  },
  joinInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: s(10),
    paddingHorizontal: s(16),
    paddingVertical: s(12),
    fontSize: s(20),
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    letterSpacing: 3,
    textAlign: 'center',
  },
  joinBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: s(20),
    borderRadius: s(10),
    justifyContent: 'center',
  },
  joinBtnDisabled: { opacity: 0.5 },
  joinBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: s(16),
  },
  templateDivider: {
    height: 1,
    backgroundColor: colors.sectionBackground,
    marginVertical: s(14),
  },
  exportBtn: {
    flexDirection: 'row',
    gap: s(8),
    backgroundColor: colors.primaryLighter,
    paddingVertical: s(12),
    paddingHorizontal: s(14),
    borderRadius: s(10),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  exportBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: s(15),
  },
  signOutBtn: {
    flexDirection: 'row',
    gap: s(10),
    paddingVertical: s(12),
    alignItems: 'center',
  },
  signOutText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(16),
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    gap: s(10),
    paddingVertical: s(12),
    alignItems: 'center',
  },
  deleteAccountText: {
    color: colors.textHint,
    fontWeight: '600',
    fontSize: s(14),
  },
  deleteAccountHint: {
    color: colors.textHint,
    fontSize: s(13),
    textAlign: 'center',
    marginTop: s(4),
  },
  premiumCard: {
    backgroundColor: colors.primaryLighter,
    borderRadius: s(12),
    padding: s(16),
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  premiumLabel: {
    fontSize: s(18),
    fontWeight: '800',
    color: colors.primary,
  },
  premiumPlan: {
    fontSize: s(14),
    color: colors.textMuted,
    marginTop: s(4),
  },
  premiumExpiry: {
    fontSize: s(13),
    color: colors.textHint,
    marginTop: s(2),
  },
  trialTag: {
    backgroundColor: colors.successBg,
    paddingHorizontal: s(8),
    paddingVertical: s(2),
    borderRadius: s(6),
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  trialTagText: {
    fontSize: s(11),
    fontWeight: '700',
    color: colors.successText,
  },
  manageBtn: {
    marginTop: s(12),
    alignItems: 'center',
  },
  manageBtnText: {
    fontSize: s(14),
    color: colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  freeCard: {
    backgroundColor: colors.card,
    borderRadius: s(12),
    padding: s(16),
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  freePlanLabel: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  freeCount: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.textMuted,
  },
  progressBarBg: {
    height: s(6),
    backgroundColor: colors.sectionBackground,
    borderRadius: s(3),
    marginTop: s(10),
    marginBottom: s(14),
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: s(3),
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: s(6),
    backgroundColor: colors.primary,
    paddingVertical: s(12),
    paddingHorizontal: s(32),
    borderRadius: s(10),
  },
  upgradeBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: s(16),
  },
  lockedCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: s(12),
    padding: s(20),
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: s(10),
  },
  lockedText: {
    fontSize: s(14),
    color: colors.textMuted,
    textAlign: 'center',
  },
});
};

export default SettingsScreen;
