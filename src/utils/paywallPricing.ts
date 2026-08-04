import type { PurchasesPackage } from 'react-native-purchases';
import { PRODUCT_ID_ANNUAL, PRODUCT_ID_MONTHLY } from '../constants/subscriptionProducts';

export type StorePlatform = 'ios' | 'android' | 'other';
export type TrialPeriodUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export interface TrialDuration {
  count: number;
  unit: TrialPeriodUnit;
}

export interface PaidIntroPhase {
  priceString: string;
  billingPeriod: TrialDuration;
  totalDuration: TrialDuration;
  cycles: number;
}

export interface PaywallPlan {
  pkg: PurchasesPackage;
  // Precio recurrente normal. En Android viene de fullPricePhase; nunca de una
  // fase gratuita o introductoria del defaultOption.
  priceString: string;
  renewalPeriod: TrialDuration | null;
  trial: TrialDuration | null;
  paidIntroPhases: PaidIntroPhase[];
}

export interface PaywallPlans {
  monthly: PaywallPlan | null;
  annual: PaywallPlan | null;
  savingsPercent: number | null;
}

// Valor de INTRO_ELIGIBILITY_STATUS_ELIGIBLE. Se mantiene numérico para que
// esta utilidad pura no cargue el módulo nativo de RevenueCat en los tests.
export const INTRO_ELIGIBLE = 2;

const packageFor = (
  packages: PurchasesPackage[],
  packageType: 'MONTHLY' | 'ANNUAL',
  productId: string,
): PurchasesPackage | null =>
  packages.find((pkg) => pkg.packageType === packageType)
  || packages.find((pkg) => pkg.product.identifier === productId)
  || null;

const positiveInteger = (value: unknown, fallback = 1): number =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;

const durationFromPeriod = (
  period: { unit?: unknown; value?: unknown } | null | undefined,
  multiplier = 1,
): TrialDuration | null => {
  const unit = period?.unit as TrialPeriodUnit;
  if (!['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(unit)) return null;
  return {
    count: positiveInteger(period?.value) * multiplier,
    unit,
  };
};

const iosTrial = (
  pkg: PurchasesPackage,
  eligibility: Record<string, number>,
): TrialDuration | null => {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return null;
  if (eligibility[pkg.product.identifier] !== INTRO_ELIGIBLE) return null;

  const unit = intro.periodUnit as TrialPeriodUnit;
  if (!['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(unit)) return null;
  return {
    count: positiveInteger(intro.periodNumberOfUnits) * positiveInteger(intro.cycles),
    unit,
  };
};

const iosPaidIntroPhases = (
  pkg: PurchasesPackage,
  eligibility: Record<string, number>,
): PaidIntroPhase[] => {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price <= 0 || !intro.priceString) return [];
  if (eligibility[pkg.product.identifier] !== INTRO_ELIGIBLE) return [];

  const unit = intro.periodUnit as TrialPeriodUnit;
  if (!['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(unit)) return [];
  const periodCount = positiveInteger(intro.periodNumberOfUnits);
  const cycles = positiveInteger(intro.cycles);
  return [{
    priceString: intro.priceString,
    billingPeriod: { count: periodCount, unit },
    totalDuration: { count: periodCount * cycles, unit },
    cycles,
  }];
};

const androidTrial = (pkg: PurchasesPackage): TrialDuration | null => {
  const freePhase = pkg.product.defaultOption?.freePhase;
  if (!freePhase || freePhase.price.amountMicros !== 0) return null;

  return durationFromPeriod(
    freePhase.billingPeriod,
    positiveInteger(freePhase.billingCycleCount),
  );
};

const androidPricingDetails = (pkg: PurchasesPackage): {
  renewalPriceString: string;
  renewalPeriod: TrialDuration | null;
  paidIntroPhases: PaidIntroPhase[];
} => {
  const option = pkg.product.defaultOption;
  const phases = option?.pricingPhases || [];
  if (!option || phases.length === 0) {
    return {
      renewalPriceString: pkg.product.priceString,
      renewalPeriod: null,
      paidIntroPhases: [],
    };
  }

  // RevenueCat ordena pricingPhases cronológicamente. La fase recurrente
  // infinita es la renovación normal; si no está marcada, el SDK expone
  // fullPricePhase y el último elemento sigue siendo el mejor fallback.
  let renewalIndex = phases.length - 1;
  phases.forEach((phase, index) => {
    if (phase.recurrenceMode === 1) {
      renewalIndex = index;
    }
  });
  const renewalPhase = option.fullPricePhase || phases[renewalIndex];

  const paidIntroPhases = phases
    .slice(0, renewalIndex)
    .flatMap((phase): PaidIntroPhase[] => {
      if (phase.price.amountMicros <= 0 || !phase.price.formatted) return [];
      const billingPeriod = durationFromPeriod(phase.billingPeriod);
      const explicitCycles = Number.isSafeInteger(phase.billingCycleCount)
        && Number(phase.billingCycleCount) > 0
        ? Number(phase.billingCycleCount)
        : null;
      const singlePayment = phase.recurrenceMode === 3
        || phase.offerPaymentMode === 'SINGLE_PAYMENT';
      const cycles = explicitCycles || (singlePayment ? 1 : null);
      if (!billingPeriod || !cycles) return [];

      return [{
        priceString: phase.price.formatted,
        billingPeriod,
        totalDuration: {
          count: billingPeriod.count * cycles,
          unit: billingPeriod.unit,
        },
        cycles,
      }];
    });

  return {
    renewalPriceString: renewalPhase?.price.formatted || pkg.product.priceString,
    renewalPeriod: durationFromPeriod(renewalPhase?.billingPeriod),
    paidIntroPhases,
  };
};

export const trialForPackage = (
  pkg: PurchasesPackage,
  platform: StorePlatform,
  eligibility: Record<string, number>,
): TrialDuration | null => {
  if (platform === 'ios') return iosTrial(pkg, eligibility);
  if (platform === 'android') return androidTrial(pkg);
  return null;
};

export const calculateSavingsPercent = (
  monthly: PurchasesPackage | null,
  annual: PurchasesPackage | null,
  platform: StorePlatform = 'other',
): number | null => {
  if (!monthly || !annual) return null;

  const comparablePrice = (pkg: PurchasesPackage): { amount: number; currency: string } => {
    if (platform === 'android') {
      const option = pkg.product.defaultOption;
      const normalPhase = option?.fullPricePhase
        || option?.pricingPhases?.find((phase) => phase.recurrenceMode === 1);
      if (normalPhase && Number.isFinite(normalPhase.price.amountMicros)) {
        return {
          amount: normalPhase.price.amountMicros / 1_000_000,
          currency: normalPhase.price.currencyCode || pkg.product.currencyCode || '',
        };
      }
    }
    return {
      amount: pkg.product.price,
      currency: pkg.product.currencyCode || '',
    };
  };

  const monthlyPrice = comparablePrice(monthly);
  const annualPrice = comparablePrice(annual);
  if (!monthlyPrice.currency
    || monthlyPrice.currency !== annualPrice.currency
    || !Number.isFinite(monthlyPrice.amount)
    || !Number.isFinite(annualPrice.amount)
    || monthlyPrice.amount <= 0
    || annualPrice.amount <= 0) {
    return null;
  }

  const monthlyForYear = monthlyPrice.amount * 12;
  if (annualPrice.amount >= monthlyForYear) return null;
  const savings = Math.round((1 - annualPrice.amount / monthlyForYear) * 100);
  return savings > 0 ? savings : null;
};

export const buildPaywallPlans = (
  packages: PurchasesPackage[],
  platform: StorePlatform,
  eligibility: Record<string, number> = {},
): PaywallPlans => {
  const monthlyPackage = packageFor(packages, 'MONTHLY', PRODUCT_ID_MONTHLY);
  const annualPackage = packageFor(packages, 'ANNUAL', PRODUCT_ID_ANNUAL);

  const toPlan = (pkg: PurchasesPackage | null): PaywallPlan | null => {
    if (!pkg) return null;
    const pricingDetails = platform === 'android'
      ? androidPricingDetails(pkg)
      : {
        renewalPriceString: pkg.product.priceString,
        renewalPeriod: null,
        paidIntroPhases: platform === 'ios'
          ? iosPaidIntroPhases(pkg, eligibility)
          : [] as PaidIntroPhase[],
      };
    return {
      pkg,
      priceString: pricingDetails.renewalPriceString,
      renewalPeriod: pricingDetails.renewalPeriod,
      trial: trialForPackage(pkg, platform, eligibility),
      paidIntroPhases: pricingDetails.paidIntroPhases,
    };
  };

  return {
    monthly: toPlan(monthlyPackage),
    annual: toPlan(annualPackage),
    savingsPercent: calculateSavingsPercent(monthlyPackage, annualPackage, platform),
  };
};
