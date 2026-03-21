import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { useLayout } from '../hooks/useLayout';
import { useSubscriptionStore } from '../stores/subscriptionStore';
import { ThemeColors } from '../theme/colors';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { PACKAGE_TYPE } from 'react-native-purchases';

interface Props {
  navigation: any;
}

const PaywallScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const { t } = useTranslation();
  const styles = getStyles(colors, fontScale);
  const packages = useSubscriptionStore((s) => s.packages);
  const purchasePackage = useSubscriptionStore((s) => s.purchasePackage);
  const restorePurchases = useSubscriptionStore((s) => s.restorePurchases);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const monthlyPkg = packages.find((p) => p.packageType === PACKAGE_TYPE.MONTHLY);
  const annualPkg = packages.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL);

  const handlePurchase = async (pkg: typeof monthlyPkg) => {
    if (!pkg) return;
    setPurchasing(true);
    try {
      const success = await purchasePackage(pkg);
      if (success) {
        Alert.alert(t('paywall.welcomePremium'), t('paywall.welcomePremiumMsg'), [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (error: any) {
      Alert.alert(t('error'), t('paywall.purchaseError'));
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      if (restored) {
        Alert.alert(t('paywall.restored'), t('paywall.restoredMsg'), [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert(t('paywall.noRestored'), t('paywall.noRestoredMsg'));
      }
    } catch {
      Alert.alert(t('error'), t('paywall.restoreError'));
    } finally {
      setRestoring(false);
    }
  };

  if (isPremium) {
    return (
      <View style={styles.container}>
        <View style={styles.premiumActive}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          <Text style={styles.premiumActiveTitle}>{t('paywall.alreadyPremium')}</Text>
          <Text style={styles.premiumActiveSubtitle}>
            {t('paywall.alreadyPremiumDesc')}
          </Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>{t('back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Ionicons name="close" size={28} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Ionicons name="diamond" size={40} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('paywall.title')}</Text>
        <Text style={styles.subtitle}>{t('paywall.subtitle')}</Text>
      </View>

      {/* Features */}
      <View style={styles.featuresCard}>
        <FeatureRow
          icon="people"
          title={t('paywall.unlimitedClients')}
          description={t('paywall.unlimitedClientsDesc', { limit: FREE_CLIENT_LIMIT })}
          colors={colors}
          fontScale={fontScale}
        />
        <FeatureRow
          icon="person-add"
          title={t('paywall.workGroups')}
          description={t('paywall.workGroupsDesc')}
          colors={colors}
          fontScale={fontScale}
        />
        <FeatureRow
          icon="download"
          title={t('paywall.exportData')}
          description={t('paywall.exportDataDesc')}
          colors={colors}
          fontScale={fontScale}
        />
      </View>

      {/* Pricing */}
      <View style={styles.pricingSection}>
        <TouchableOpacity
          onPress={() => monthlyPkg ? handlePurchase(monthlyPkg) : Alert.alert(t('paywall.notAvailable'), t('paywall.notAvailableMsg'))}
          style={styles.priceCard}
          disabled={purchasing}
        >
          <Text style={styles.priceLabel}>{t('paywall.monthly')}</Text>
          <Text style={styles.priceAmount}>
            {monthlyPkg ? monthlyPkg.product.priceString : '$2.99'}
          </Text>
          <Text style={styles.pricePeriod}>{t('paywall.perMonth')}</Text>
          <View style={styles.trialBadge}>
            <Ionicons name="gift" size={14} color={colors.success} />
            <Text style={styles.trialText}>{t('paywall.freeWeek')}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => annualPkg ? handlePurchase(annualPkg) : Alert.alert(t('paywall.notAvailable'), t('paywall.notAvailableMsg'))}
          style={[styles.priceCard, styles.priceCardFeatured]}
          disabled={purchasing}
        >
          <View style={styles.saveBadge}>
            <Text style={styles.saveBadgeText}>{t('paywall.save16')}</Text>
          </View>
          <Text style={[styles.priceLabel, styles.priceLabelFeatured]}>{t('paywall.annual')}</Text>
          <Text style={[styles.priceAmount, styles.priceAmountFeatured]}>
            {annualPkg ? annualPkg.product.priceString : '$29.99'}
          </Text>
          <Text style={[styles.pricePeriod, styles.pricePeriodFeatured]}>{t('paywall.perYear')}</Text>
          <View style={[styles.trialBadge, styles.trialBadgeFeatured]}>
            <Ionicons name="gift" size={14} color={colors.primary} />
            <Text style={[styles.trialText, styles.trialTextFeatured]}>{t('paywall.freeMonth')}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {purchasing && (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />
      )}

      {/* Restore */}
      <TouchableOpacity onPress={handleRestore} disabled={restoring} style={styles.restoreBtn}>
        {restoring ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <Text style={styles.restoreText}>{t('paywall.restorePurchases')}</Text>
        )}
      </TouchableOpacity>

      {/* Legal */}
      <Text style={styles.legalText}>
        {t('paywall.legalText', { store: Platform.OS === 'ios' ? 'Apple' : 'Google' })}
      </Text>

      {/* Privacy Policy & Terms of Use links */}
      <View style={styles.legalLinks}>
        <TouchableOpacity onPress={() => Linking.openURL('https://rutawater-privacy.netlify.app/')}>
          <Text style={styles.legalLink}>{t('paywall.privacyPolicy')}</Text>
        </TouchableOpacity>
        <Text style={styles.legalSeparator}>|</Text>
        <TouchableOpacity onPress={() => Linking.openURL('https://rutawater-privacy.netlify.app/terms.html')}>
          <Text style={styles.legalLink}>{t('paywall.termsOfUse')}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const FeatureRow: React.FC<{
  icon: string;
  title: string;
  description: string;
  colors: ThemeColors;
  fontScale: number;
}> = ({ icon, title, description, colors, fontScale }) => {
  const s = (v: number) => Math.round(v * fontScale);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.primaryLighter,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Ionicons name={icon as any} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: s(16), fontWeight: '700', color: colors.textPrimary }}>
          {title}
        </Text>
        <Text style={{ fontSize: s(13), color: colors.textMuted, marginTop: 2 }}>
          {description}
        </Text>
      </View>
      <Ionicons name="checkmark-circle" size={22} color={colors.success} />
    </View>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
    },
    backBtn: {
      alignSelf: 'flex-end',
      padding: 4,
    },
    header: {
      alignItems: 'center',
      marginBottom: 24,
    },
    iconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primaryLighter,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
      borderWidth: 2,
      borderColor: colors.primaryBorder,
    },
    title: {
      fontSize: s(26),
      fontWeight: '800',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: s(16),
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 6,
    },
    featuresCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    trialBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      marginTop: 12,
      backgroundColor: colors.successBg,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.successBorder,
    },
    trialBadgeFeatured: {
      backgroundColor: colors.primaryLighter,
      borderColor: colors.primaryBorder,
    },
    trialText: {
      fontSize: s(11),
      fontWeight: '700',
      color: colors.successText,
    },
    trialTextFeatured: {
      color: colors.primary,
    },
    pricingSection: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 20,
    },
    priceCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 20,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.cardBorder,
    },
    priceCardFeatured: {
      borderColor: colors.primary,
      backgroundColor: colors.card,
    },
    saveBadge: {
      position: 'absolute',
      top: -10,
      backgroundColor: colors.primary,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 8,
    },
    saveBadgeText: {
      color: '#FFFFFF',
      fontSize: s(11),
      fontWeight: '700',
    },
    priceLabel: {
      fontSize: s(14),
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 4,
    },
    priceLabelFeatured: {
      color: colors.textPrimary,
    },
    priceAmount: {
      fontSize: s(28),
      fontWeight: '800',
      color: colors.textPrimary,
    },
    priceAmountFeatured: {
      color: colors.textPrimary,
    },
    pricePeriod: {
      fontSize: s(13),
      color: colors.textHint,
      marginTop: 2,
    },
    pricePeriodFeatured: {
      color: colors.textMuted,
    },
    loadingPackages: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 20,
    },
    loadingText: {
      fontSize: s(14),
      color: colors.textMuted,
    },
    restoreBtn: {
      marginTop: 20,
      alignItems: 'center',
      paddingVertical: 12,
    },
    restoreText: {
      fontSize: s(14),
      color: colors.textMuted,
      textDecorationLine: 'underline',
    },
    legalText: {
      fontSize: s(11),
      color: colors.textHint,
      textAlign: 'center',
      marginTop: 12,
      lineHeight: s(16),
    },
    legalLinks: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 12,
      gap: 8,
    },
    legalLink: {
      fontSize: s(12),
      color: colors.primary,
      textDecorationLine: 'underline',
    },
    legalSeparator: {
      fontSize: s(12),
      color: colors.textHint,
    },
    premiumActive: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
    },
    premiumActiveTitle: {
      fontSize: s(24),
      fontWeight: '800',
      color: colors.textPrimary,
      marginTop: 16,
    },
    premiumActiveSubtitle: {
      fontSize: s(16),
      color: colors.textMuted,
      marginTop: 8,
      textAlign: 'center',
    },
    closeBtn: {
      marginTop: 24,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 40,
      borderRadius: 12,
    },
    closeBtnText: {
      color: '#FFFFFF',
      fontSize: s(16),
      fontWeight: '700',
    },
  });
};

export default PaywallScreen;
