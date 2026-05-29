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
} from 'react-native';
import { useAuthContext } from '../context/AuthContext';
import { useClientsStore } from '../stores/clientsStore';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { useSubscriptionStore } from '../stores/subscriptionStore';
import { useGroupManagement } from '../hooks/useGroupManagement';
import {
  useWhatsAppTemplates,
  DEFAULT_EN_CAMINO,
  DEFAULT_DEUDA,
  DEFAULT_RECORDATORIO,
} from '../hooks/useWhatsAppTemplates';
import { useDataExport } from '../hooks/useDataExport';
import ProductCatalogModal from '../components/ProductCatalogModal';
import ProfilesModal from '../components/ProfilesModal';
import { useProfileStore } from '../stores/profileStore';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { fontScale } = useLayout();
  const styles = getStyles(colors, fontScale);
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

  const {
    waEnCamino,
    setWaEnCamino,
    waDeuda,
    setWaDeuda,
    waRecordatorio,
    setWaRecordatorio,
    waLoaded,
    handleSaveTemplates,
    handleResetTemplates,
  } = useWhatsAppTemplates(uid, groupData?.groupId);

  const { handleExportCSV, handleExportJSON } = useDataExport({ uid, email: userEmail });

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
                {t('settings.renews')}: {new Date(expirationDate).toLocaleDateString()}
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

      {/* Group section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="people-outline" size={20} color={colors.textMuted} />
          <Text style={styles.sectionTitle}>{t('settings.familyGroup')}</Text>
        </View>

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
                onPress={() => navigation.navigate('Paywall')}
                style={styles.upgradeBtn}
              >
                <Ionicons name="diamond" size={16} color="#FFFFFF" />
                <Text style={styles.upgradeBtnText}>{t('settings.getPremium')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Profiles / Repartos */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="git-branch-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>{t('settings.profilesTitle')}</Text>
        </View>
        <Text style={styles.sectionSubtitle}>{t('settings.profilesSubtitle')}</Text>
        <View style={styles.sectionCard}>
          <TouchableOpacity onPress={() => setProfilesModalVisible(true)} style={styles.exportBtn}>
            <Ionicons name="git-branch-outline" size={18} color={colors.primary} />
            <Text style={styles.exportBtnText}>
              {t('settings.manageProfiles')}
              {activeProfile ? `  ·  ${activeProfile.name}` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Products catalog */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="cube-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>{t('settings.productsTitle')}</Text>
        </View>
        <Text style={styles.sectionSubtitle}>{t('settings.productsSubtitle')}</Text>
        <View style={styles.sectionCard}>
          <TouchableOpacity onPress={() => setProductsModalVisible(true)} style={styles.exportBtn}>
            <Ionicons name="create-outline" size={18} color={colors.primary} />
            <Text style={styles.exportBtnText}>{t('settings.manageProducts')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* WhatsApp Templates */}
      {waLoaded && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="logo-whatsapp" size={20} color={colors.successDark} />
            <Text style={styles.sectionTitle}>{t('settings.whatsappMessages')}</Text>
          </View>
          <Text style={styles.sectionSubtitle}>{t('settings.whatsappSubtitle')}</Text>
          <View style={styles.sectionCard}>
            <Text style={styles.templateLabel}>{t('settings.enCaminoLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waEnCamino}
              onChangeText={setWaEnCamino}
              placeholder={DEFAULT_EN_CAMINO}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={3}
            />

            <View style={styles.templateDivider} />

            <Text style={styles.templateLabel}>{t('settings.debtLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waDeuda}
              onChangeText={setWaDeuda}
              placeholder={DEFAULT_DEUDA}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={2}
            />
            <Text style={styles.templateHint}>{t('settings.debtHint')}</Text>

            <View style={styles.templateDivider} />

            <Text style={styles.templateLabel}>{t('settings.reminderLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waRecordatorio}
              onChangeText={setWaRecordatorio}
              placeholder={DEFAULT_RECORDATORIO}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={4}
            />
          </View>
          <View style={styles.templateActions}>
            <TouchableOpacity onPress={handleSaveTemplates} style={styles.templateSaveBtn}>
              <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              <Text style={styles.templateSaveBtnText}>{t('settings.saveTemplates')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleResetTemplates} style={styles.templateResetBtn}>
              <Ionicons name="refresh" size={16} color={colors.textMuted} />
              <Text style={styles.templateResetBtnText}>{t('settings.resetTemplates')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
    </>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    maxWidth: 800,
    width: '100%' as const,
    alignSelf: 'center' as const,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: s(13),
    color: colors.textHint,
    marginBottom: 12,
    marginLeft: 28,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardGroupTitle: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  cardGroupContent: {
    gap: 8,
  },
  cardGroupHint: {
    fontSize: s(12),
    color: colors.textHint,
    marginTop: 6,
  },
  subsectionTitle: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    marginTop: 2,
  },
  roleBadge: {
    fontSize: s(13),
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    overflow: 'hidden',
  },
  codeCard: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 12,
    padding: 16,
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
    marginVertical: 8,
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
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
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
    marginTop: 2,
  },
  removeBtn: {
    backgroundColor: colors.dangerLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  removeBtnText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(14),
  },
  groupActions: {
    marginTop: 16,
  },
  dangerBtn: {
    backgroundColor: colors.dangerLight,
    paddingVertical: 12,
    borderRadius: 10,
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
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
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
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  dividerText: {
    color: colors.textHint,
    paddingHorizontal: 12,
    fontSize: s(15),
  },
  joinRow: {
    flexDirection: 'row',
    gap: 8,
  },
  joinInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    paddingHorizontal: 20,
    borderRadius: 10,
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
    marginVertical: 14,
  },
  templateLabel: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  templateInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: s(15),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    textAlignVertical: 'top',
    minHeight: 60,
  },
  templateHint: {
    fontSize: s(12),
    color: colors.textHint,
    marginTop: 4,
  },
  templateActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  templateSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateSaveBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(15),
  },
  templateResetBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.sectionBackground,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  templateResetBtnText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: s(15),
  },
  exportBtn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.primaryLighter,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
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
    gap: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(16),
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
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
    marginTop: 4,
  },
  premiumCard: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 12,
    padding: 16,
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
    marginTop: 4,
  },
  premiumExpiry: {
    fontSize: s(13),
    color: colors.textHint,
    marginTop: 2,
  },
  trialTag: {
    backgroundColor: colors.successBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  trialTagText: {
    fontSize: s(11),
    fontWeight: '700',
    color: colors.successText,
  },
  manageBtn: {
    marginTop: 12,
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
    borderRadius: 12,
    padding: 16,
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
    height: 6,
    backgroundColor: colors.sectionBackground,
    borderRadius: 3,
    marginTop: 10,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  upgradeBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: s(16),
  },
  lockedCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 10,
  },
  lockedText: {
    fontSize: s(14),
    color: colors.textMuted,
    textAlign: 'center',
  },
});
};

export default SettingsScreen;
