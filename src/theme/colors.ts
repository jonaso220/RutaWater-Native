export const lightColors = {
  // Backgrounds
  background: '#F9FAFB',
  card: '#FFFFFF',
  cardBorder: '#E5E7EB',
  inputBackground: '#F9FAFB',
  inputBorder: '#E5E7EB',
  overlay: 'rgba(0,0,0,0.5)',
  modalBackground: '#FFFFFF',

  // Text
  textPrimary: '#111827',
  textSecondary: '#374151',
  textMuted: '#6B7280',
  textHint: '#9CA3AF',
  textDisabled: '#D1D5DB',
  textWhite: '#FFFFFF',

  // Primary (Blue)
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryLight: '#DBEAFE',
  primaryLighter: '#EFF6FF',
  primaryBorder: '#93C5FD',
  primaryInactiveBorder: '#BFDBFE',

  // Success (Green)
  success: '#10B981',
  successDark: '#059669',
  successBright: '#22C55E',
  successMedium: '#16A34A',
  successLight: '#A7F3D0',
  successLighter: '#ECFDF5',
  successBg: '#F0FDF4',
  successAccent: '#6EE7B7',
  successText: '#065F46',
  successBorder: '#BBF7D0',

  // Danger (Red)
  danger: '#DC2626',
  dangerBright: '#EF4444',
  dangerLight: '#FEF2F2',
  dangerBorder: '#FECACA',

  // Warning (Orange/Amber)
  warning: '#F97316',
  warningAmber: '#F59E0B',
  warningDark: '#D97706',
  warningDarker: '#B45309',
  warningOrangeText: '#EA580C',
  warningLightBg: '#FFF7ED',
  warningAmberBg: '#FFFBEB',
  warningAmberBorder: '#FDE68A',
  warningYellow: '#FBBF24',

  // Navigation
  headerBackground: '#111827',
  headerText: '#FFFFFF',
  tabBarBackground: '#FFFFFF',
  tabBarBorder: '#E5E7EB',
  tabActive: '#2563EB',
  tabInactive: '#9CA3AF',

  // Sections
  sectionBackground: '#F3F4F6',
  sectionBorder: '#E5E7EB',
  divider: '#E5E7EB',

  // Status bar
  statusBar: 'light-content' as const,
};

export const darkColors: typeof lightColors = {
  // Backgrounds
  background: '#111827',
  card: '#1F2937',
  cardBorder: '#374151',
  inputBackground: '#1F2937',
  inputBorder: '#374151',
  overlay: 'rgba(0,0,0,0.7)',
  modalBackground: '#1F2937',

  // Text
  textPrimary: '#F9FAFB',
  textSecondary: '#E5E7EB',
  textMuted: '#9CA3AF',
  textHint: '#6B7280',
  textDisabled: '#4B5563',
  textWhite: '#FFFFFF',

  // Primary (Blue)
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  primaryLight: '#1E3A5F',
  primaryLighter: '#172554',
  primaryBorder: '#1E40AF',
  primaryInactiveBorder: '#1E3A5F',

  // Success (Green)
  success: '#10B981',
  successDark: '#059669',
  successBright: '#22C55E',
  successMedium: '#16A34A',
  successLight: '#064E3B',
  successLighter: '#064E3B',
  successBg: '#052E16',
  successAccent: '#6EE7B7',
  successText: '#6EE7B7',
  successBorder: '#065F46',

  // Danger (Red)
  danger: '#EF4444',
  dangerBright: '#F87171',
  dangerLight: '#450A0A',
  dangerBorder: '#7F1D1D',

  // Warning (Orange/Amber)
  warning: '#F97316',
  warningAmber: '#F59E0B',
  warningDark: '#D97706',
  warningDarker: '#F59E0B',
  warningOrangeText: '#FB923C',
  warningLightBg: '#431407',
  warningAmberBg: '#451A03',
  warningAmberBorder: '#92400E',
  warningYellow: '#FBBF24',

  // Navigation
  headerBackground: '#0F172A',
  headerText: '#F9FAFB',
  tabBarBackground: '#1F2937',
  tabBarBorder: '#374151',
  tabActive: '#3B82F6',
  tabInactive: '#6B7280',

  // Sections
  sectionBackground: '#111827',
  sectionBorder: '#374151',
  divider: '#374151',

  // Status bar
  statusBar: 'light-content' as const,
};

export type ThemeColors = typeof lightColors;
