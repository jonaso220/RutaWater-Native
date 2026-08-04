import React, { useEffect, useRef, useState } from 'react';
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
import type { PurchasesPackage } from 'react-native-purchases';
import {
  buildPaywallPlans,
} from '../utils/paywallPricing';
import type { StorePlatform, TrialDuration } from '../utils/paywallPricing';
import { runExclusiveOperation } from '../utils/inFlightOperation';

interface Props {
  navigation: any;
}

const PaywallScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const { t } = useTranslation();
  const styles = getStyles(colors, fontScale);
  const packages = useSubscriptionStore((s) => s.packages);
  const subscriptionLoading = useSubscriptionStore((s) => s.loading);
  const introEligibility = useSubscriptionStore((s) => s.introEligibility);
  const purchasePackage = useSubscriptionStore((s) => s.purchasePackage);
  const restorePurchases = useSubscriptionStore((s) => s.restorePurchases);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const billingInFlightRef = useRef(false);
  const billingPending = purchasing || restoring;

  useEffect(() => navigation.addListener('beforeRemove', (event: any) => {
    if (billingInFlightRef.current) event.preventDefault();
  }), [navigation]);

  const storePlatform: StorePlatform = Platform.OS === 'ios'
    ? 'ios'
    : Platform.OS === 'android' ? 'android' : 'other';
  const plans = buildPaywallPlans(packages, storePlatform, introEligibility);

  const durationLabel = (duration: TrialDuration): string => {
    const key = {
      DAY: 'trialDays',
      WEEK: 'trialWeeks',
      MONTH: 'trialMonths',
      YEAR: 'trialYears',
    }[duration.unit];
    return t(`paywall.${key}`, { count: duration.count });
  };

  const recurringPeriodLabel = (
    period: TrialDuration | null,
    fallbackKey: 'paywall.perMonth' | 'paywall.perYear',
  ): string => period
    ? t('paywall.everyDuration', { duration: durationLabel(period) })
    : t(fallbackKey);

  const hasPromotionalOffer = [plans.monthly, plans.annual].some(
    (plan) => Boolean(plan?.trial || plan?.paidIntroPhases.length),
  );

  const handlePurchase = async (pkg: PurchasesPackage) => {
    if (!pkg) return;
    await runExclusiveOperation(billingInFlightRef, async () => {
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
    });
  };

  const handleRestore = async () => {
    await runExclusiveOperation(billingInFlightRef, async () => {
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
    });
  };

  if (isPremium) {
    return (
      <View style={styles.outer}>
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
    <View style={styles.outer}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backBtn}
        disabled={billingPending}
      >
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
      {subscriptionLoading && !plans.monthly && !plans.annual ? (
        <View style={styles.loadingPackages}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>{t('paywall.loadingPrices')}</Text>
        </View>
      ) : plans.monthly || plans.annual ? (
        <>
          <View style={styles.pricingSection}>
            {plans.monthly ? (
              <TouchableOpacity
                onPress={() => handlePurchase(plans.monthly!.pkg)}
                style={styles.priceCard}
                disabled={billingPending}
              >
                <Text style={styles.priceLabel}>{t('paywall.monthly')}</Text>
                <Text style={styles.priceAmount}>{plans.monthly.priceString}</Text>
                <Text style={styles.pricePeriod}>
                  {recurringPeriodLabel(plans.monthly.renewalPeriod, 'paywall.perMonth')}
                </Text>
                {plans.monthly.trial || plans.monthly.paidIntroPhases.length > 0 ? (
                  <>
                    {plans.monthly.trial ? (
                      <View style={styles.trialBadge}>
                        <Ionicons name="gift" size={14} color={colors.success} />
                        <Text style={styles.trialText}>
                          {t('paywall.freeTrial', {
                            duration: durationLabel(plans.monthly.trial),
                          })}
                        </Text>
                      </View>
                    ) : null}
                    {plans.monthly.paidIntroPhases.map((phase, index) => (
                      <Text
                        key={`${phase.priceString}-${phase.billingPeriod.unit}-${index}`}
                        style={styles.introPhaseText}
                      >
                        {t('paywall.paidIntroPhase', {
                          price: phase.priceString,
                          period: recurringPeriodLabel(phase.billingPeriod, 'paywall.perMonth'),
                          duration: durationLabel(phase.totalDuration),
                          count: phase.cycles,
                        })}
                      </Text>
                    ))}
                    <Text style={styles.renewalText}>
                      {t('paywall.renewsAfterOffer', {
                        price: plans.monthly.priceString,
                        period: recurringPeriodLabel(
                          plans.monthly.renewalPeriod,
                          'paywall.perMonth',
                        ),
                      })}
                    </Text>
                  </>
                ) : null}
              </TouchableOpacity>
            ) : null}

            {plans.annual ? (
              <TouchableOpacity
                onPress={() => handlePurchase(plans.annual!.pkg)}
                style={[styles.priceCard, styles.priceCardFeatured]}
                disabled={billingPending}
              >
                {plans.savingsPercent ? (
                  <View style={styles.saveBadge}>
                    <Text style={styles.saveBadgeText}>
                      {t('paywall.savePercent', { percent: plans.savingsPercent })}
                    </Text>
                  </View>
                ) : null}
                <Text style={[styles.priceLabel, styles.priceLabelFeatured]}>{t('paywall.annual')}</Text>
                <Text style={[styles.priceAmount, styles.priceAmountFeatured]}>
                  {plans.annual.priceString}
                </Text>
                <Text style={[styles.pricePeriod, styles.pricePeriodFeatured]}>
                  {recurringPeriodLabel(plans.annual.renewalPeriod, 'paywall.perYear')}
                </Text>
                {plans.annual.trial || plans.annual.paidIntroPhases.length > 0 ? (
                  <>
                    {plans.annual.trial ? (
                      <View style={[styles.trialBadge, styles.trialBadgeFeatured]}>
                        <Ionicons name="gift" size={14} color={colors.primary} />
                        <Text style={[styles.trialText, styles.trialTextFeatured]}>
                          {t('paywall.freeTrial', {
                            duration: durationLabel(plans.annual.trial),
                          })}
                        </Text>
                      </View>
                    ) : null}
                    {plans.annual.paidIntroPhases.map((phase, index) => (
                      <Text
                        key={`${phase.priceString}-${phase.billingPeriod.unit}-${index}`}
                        style={styles.introPhaseText}
                      >
                        {t('paywall.paidIntroPhase', {
                          price: phase.priceString,
                          period: recurringPeriodLabel(phase.billingPeriod, 'paywall.perYear'),
                          duration: durationLabel(phase.totalDuration),
                          count: phase.cycles,
                        })}
                      </Text>
                    ))}
                    <Text style={styles.renewalText}>
                      {t('paywall.renewsAfterOffer', {
                        price: plans.annual.priceString,
                        period: recurringPeriodLabel(
                          plans.annual.renewalPeriod,
                          'paywall.perYear',
                        ),
                      })}
                    </Text>
                  </>
                ) : null}
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.taxNotice}>{t('paywall.taxNotice')}</Text>
          {hasPromotionalOffer ? (
            <Text style={styles.offerCancellationText}>
              {t('paywall.cancelBeforeOfferEnds')}
            </Text>
          ) : null}
        </>
      ) : (
        <View style={styles.unavailablePrices}>
          <Text style={styles.loadingText}>{t('paywall.notAvailableMsg')}</Text>
        </View>
      )}

      {purchasing && (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />
      )}

      {/* Restore */}
      <TouchableOpacity onPress={handleRestore} disabled={billingPending} style={styles.restoreBtn}>
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
    </View>
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
    outer: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    scrollView: {
      width: '100%',
      maxWidth: 540,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingVertical: 20,
      paddingBottom: 60,
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
    renewalText: {
      fontSize: s(10),
      color: colors.textHint,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: s(14),
    },
    introPhaseText: {
      fontSize: s(10),
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: s(14),
      fontWeight: '600',
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
      textAlign: 'center',
    },
    unavailablePrices: {
      marginTop: 20,
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    taxNotice: {
      marginTop: 10,
      fontSize: s(10),
      lineHeight: s(14),
      color: colors.textHint,
      textAlign: 'center',
    },
    offerCancellationText: {
      marginTop: 6,
      fontSize: s(10),
      lineHeight: s(14),
      color: colors.textMuted,
      textAlign: 'center',
      fontWeight: '600',
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
