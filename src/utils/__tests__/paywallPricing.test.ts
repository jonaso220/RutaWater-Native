import fs from 'fs';
import path from 'path';
import type { PurchasesPackage } from 'react-native-purchases';
import en from '../../i18n/locales/en';
import es from '../../i18n/locales/es';
import pt from '../../i18n/locales/pt';
import {
  buildPaywallPlans,
  calculateSavingsPercent,
  INTRO_ELIGIBLE,
} from '../paywallPricing';

const makePackage = ({
  type,
  id,
  price,
  priceString,
  currency = 'USD',
  introPrice = null,
  defaultOption = null,
}: Record<string, any>): PurchasesPackage => ({
  identifier: `$rc_${String(type).toLowerCase()}`,
  packageType: type,
  product: {
    identifier: id,
    price,
    priceString,
    currencyCode: currency,
    introPrice,
    defaultOption,
  },
} as PurchasesPackage);

describe('paywall pricing derived from RevenueCat packages', () => {
  const monthly = makePackage({
    type: 'MONTHLY', id: 'rw_premium_monthly', price: 3, priceString: 'UYU 120',
  });
  const annual = makePackage({
    type: 'ANNUAL', id: 'rw_premium_annual', price: 30, priceString: 'UYU 1.200',
  });

  test('shows no plan or invented fallback when RevenueCat returns no package', () => {
    expect(buildPaywallPlans([], 'ios', {})).toEqual({
      monthly: null,
      annual: null,
      savingsPercent: null,
    });
  });

  test('uses the localized store price verbatim and computes real savings', () => {
    const plans = buildPaywallPlans([monthly, annual], 'ios', {});
    expect(plans.monthly?.priceString).toBe('UYU 120');
    expect(plans.annual?.priceString).toBe('UYU 1.200');
    expect(plans.savingsPercent).toBe(17);
  });

  test('hides savings when currencies differ or annual is not cheaper', () => {
    const eurAnnual = makePackage({
      type: 'ANNUAL', id: 'rw_premium_annual', price: 30, priceString: '€30', currency: 'EUR',
    });
    expect(calculateSavingsPercent(monthly, eurAnnual)).toBeNull();
    expect(calculateSavingsPercent(monthly, makePackage({
      type: 'ANNUAL', id: 'rw_premium_annual', price: 36, priceString: '$36',
    }))).toBeNull();
  });

  test('advertises an iOS free trial only when RevenueCat confirms eligibility', () => {
    const trialMonthly = makePackage({
      type: 'MONTHLY',
      id: 'rw_premium_monthly',
      price: 3,
      priceString: '$3',
      introPrice: {
        price: 0,
        periodUnit: 'WEEK',
        periodNumberOfUnits: 1,
        cycles: 1,
      },
    });
    expect(buildPaywallPlans([trialMonthly], 'ios', {}).monthly?.trial).toBeNull();
    expect(buildPaywallPlans([trialMonthly], 'ios', {
      rw_premium_monthly: INTRO_ELIGIBLE,
    }).monthly?.trial).toEqual({ count: 1, unit: 'WEEK' });
    const eligiblePlan = buildPaywallPlans([trialMonthly], 'ios', {
      rw_premium_monthly: INTRO_ELIGIBLE,
    }).monthly;
    expect(eligiblePlan?.priceString).toBe('$3');
    expect(eligiblePlan?.renewalPeriod).toBeNull();
    expect(eligiblePlan?.paidIntroPhases).toEqual([]);
  });

  test('shows an eligible paid iOS introductory price before normal renewal', () => {
    const introMonthly = makePackage({
      type: 'MONTHLY',
      id: 'rw_premium_monthly',
      price: 3.99,
      priceString: '$3.99',
      introPrice: {
        price: 0.99,
        priceString: '$0.99',
        periodUnit: 'MONTH',
        periodNumberOfUnits: 1,
        cycles: 3,
      },
    });

    expect(buildPaywallPlans([introMonthly], 'ios', {}).monthly?.paidIntroPhases)
      .toEqual([]);
    expect(buildPaywallPlans([introMonthly], 'ios', {
      rw_premium_monthly: INTRO_ELIGIBLE,
    }).monthly).toMatchObject({
      priceString: '$3.99',
      trial: null,
      paidIntroPhases: [{
        priceString: '$0.99',
        billingPeriod: { count: 1, unit: 'MONTH' },
        totalDuration: { count: 3, unit: 'MONTH' },
        cycles: 3,
      }],
    });
  });

  test('uses only the eligible Google default option free phase', () => {
    const googleAnnual = makePackage({
      type: 'ANNUAL',
      id: 'rw_premium_annual',
      price: 30,
      priceString: '$30',
      defaultOption: {
        freePhase: {
          price: { amountMicros: 0 },
          billingPeriod: { unit: 'MONTH', value: 1 },
          billingCycleCount: 1,
        },
      },
    });
    expect(buildPaywallPlans([googleAnnual], 'android').annual?.trial)
      .toEqual({ count: 1, unit: 'MONTH' });
  });

  test('models the full Google trial, paid intro, and normal renewal sequence', () => {
    const freePhase = {
      price: { amountMicros: 0, formatted: '$0.00', currencyCode: 'USD' },
      billingPeriod: { unit: 'WEEK', value: 1, iso8601: 'P1W' },
      billingCycleCount: 1,
      recurrenceMode: 3,
      offerPaymentMode: 'FREE_TRIAL',
    };
    const paidIntroPhase = {
      price: { amountMicros: 990000, formatted: '$0.99', currencyCode: 'USD' },
      billingPeriod: { unit: 'MONTH', value: 1, iso8601: 'P1M' },
      billingCycleCount: 3,
      recurrenceMode: 2,
      offerPaymentMode: 'DISCOUNTED_RECURRING_PAYMENT',
    };
    const renewalPhase = {
      price: { amountMicros: 3990000, formatted: '$3.99', currencyCode: 'USD' },
      billingPeriod: { unit: 'MONTH', value: 1, iso8601: 'P1M' },
      billingCycleCount: null,
      recurrenceMode: 1,
      offerPaymentMode: null,
    };
    const googleMonthly = makePackage({
      type: 'MONTHLY',
      id: 'rw_premium_monthly',
      price: 3.99,
      priceString: '$3.99',
      defaultOption: {
        freePhase,
        pricingPhases: [freePhase, paidIntroPhase, renewalPhase],
        fullPricePhase: renewalPhase,
      },
    });

    const plan = buildPaywallPlans([googleMonthly], 'android').monthly;

    expect(plan).toMatchObject({
      priceString: '$3.99',
      renewalPeriod: { count: 1, unit: 'MONTH' },
      trial: { count: 1, unit: 'WEEK' },
      paidIntroPhases: [{
        priceString: '$0.99',
        billingPeriod: { count: 1, unit: 'MONTH' },
        totalDuration: { count: 3, unit: 'MONTH' },
        cycles: 3,
      }],
    });
  });

  test('computes Android savings from normal renewal phases, not intro prices', () => {
    const phase = (amountMicros: number, formatted: string) => ({
      price: { amountMicros, formatted, currencyCode: 'USD' },
      billingPeriod: { unit: 'MONTH', value: 1, iso8601: 'P1M' },
      recurrenceMode: 1,
    });
    const monthlyRenewal = phase(4_000_000, '$4.00');
    const annualRenewal = {
      ...phase(36_000_000, '$36.00'),
      billingPeriod: { unit: 'YEAR', value: 1, iso8601: 'P1Y' },
    };
    const googleMonthly = makePackage({
      type: 'MONTHLY',
      id: 'rw_premium_monthly',
      // RevenueCat may expose the selected option's intro amount here.
      price: 0.99,
      priceString: '$0.99',
      defaultOption: { pricingPhases: [monthlyRenewal], fullPricePhase: monthlyRenewal },
    });
    const googleAnnual = makePackage({
      type: 'ANNUAL',
      id: 'rw_premium_annual',
      price: 1.99,
      priceString: '$1.99',
      defaultOption: { pricingPhases: [annualRenewal], fullPricePhase: annualRenewal },
    });

    expect(buildPaywallPlans([googleMonthly, googleAnnual], 'android').savingsPercent).toBe(25);
  });

  test('does not apply Google pricing phases to the iOS paywall', () => {
    const androidPhase = {
      price: { amountMicros: 990000, formatted: '$0.99', currencyCode: 'USD' },
      billingPeriod: { unit: 'MONTH', value: 1, iso8601: 'P1M' },
      billingCycleCount: 3,
      recurrenceMode: 2,
      offerPaymentMode: 'DISCOUNTED_RECURRING_PAYMENT',
    };
    const iosMonthly = makePackage({
      type: 'MONTHLY',
      id: 'rw_premium_monthly',
      price: 3,
      priceString: '$3',
      defaultOption: {
        pricingPhases: [androidPhase],
        fullPricePhase: androidPhase,
      },
    });

    expect(buildPaywallPlans([iosMonthly], 'ios').monthly).toMatchObject({
      priceString: '$3',
      renewalPeriod: null,
      paidIntroPhases: [],
    });
  });

  test('tells users to cancel before a trial or promotion ends', () => {
    expect(es.paywall.cancelBeforeOfferEnds).toContain('antes de que termine');
    expect(en.paywall.cancelBeforeOfferEnds).toContain('before the trial or promotion ends');
    expect(pt.paywall.cancelBeforeOfferEnds).toContain('antes do fim do teste ou da promoção');
  });

  test('PaywallScreen contains no hard-coded fallback price or static trial claim', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/screens/PaywallScreen.tsx'),
      'utf8',
    );
    expect(source).not.toContain("'$2.99'");
    expect(source).not.toContain("'$29.99'");
    expect(source).not.toContain("t('paywall.freeWeek')");
    expect(source).not.toContain("t('paywall.freeMonth')");
    expect(source).not.toContain("t('paywall.save16')");
    expect(source).toContain('paidIntroPhases.map');
    expect(source).toContain("t('paywall.renewsAfterOffer'");
    expect(source).toContain("t('paywall.cancelBeforeOfferEnds')");
  });
});
