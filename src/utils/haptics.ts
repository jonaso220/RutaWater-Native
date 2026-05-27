import { trigger as triggerHaptic, HapticFeedbackTypes } from 'react-native-haptic-feedback';

// Centralized haptic feedback helpers. The names map to UI intent rather than
// to specific iOS haptic styles so call sites stay readable and the mapping
// can evolve.
//
// On iPhone these resolve to UIImpactFeedbackGenerator / UINotificationFeedback
// styles. On Android the lib falls back to vibration patterns.
//
// `ignoreAndroidSystemSettings: false` respects the user's system haptic
// preference: if the user has haptics off, we don't try to force them on.
const OPTIONS = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

const trigger = (type: HapticFeedbackTypes) => {
  try {
    triggerHaptic(type, OPTIONS);
  } catch {
    // Haptics are nice-to-have; never let a missing native module crash UX.
  }
};

// Light tap — for general selection / tab change / toggle on
export const hapticSelection = () => trigger(HapticFeedbackTypes.selection);

// Subtle confirmation — small action took effect (mark done, save alarm)
export const hapticLight = () => trigger(HapticFeedbackTypes.impactLight);

// Stronger confirmation — destructive or significant action
export const hapticMedium = () => trigger(HapticFeedbackTypes.impactMedium);

// Drop / drag end — most pronounced tactile feedback
export const hapticHeavy = () => trigger(HapticFeedbackTypes.impactHeavy);

// Multi-tap notification haptics
export const hapticSuccess = () => trigger(HapticFeedbackTypes.notificationSuccess);
export const hapticWarning = () => trigger(HapticFeedbackTypes.notificationWarning);
export const hapticError = () => trigger(HapticFeedbackTypes.notificationError);
