import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface LoginScreenProps {
  onSignInWithEmail: (email: string, password: string) => Promise<void>;
  onSignUpWithEmail: (email: string, password: string) => Promise<void>;
  onSignInWithGoogle: () => Promise<void>;
  onSignInWithApple: () => Promise<void>;
}

const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignInWithEmail,
  onSignUpWithEmail,
  onSignInWithGoogle,
  onSignInWithApple,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = getStyles(colors);
  const [loading, setLoading] = useState<'google' | 'apple' | 'email' | null>(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignIn = async (provider: 'google' | 'apple') => {
    setLoading(provider);
    setError('');
    try {
      if (provider === 'google') {
        await onSignInWithGoogle();
      } else {
        await onSignInWithApple();
      }
    } catch (e: any) {
      setError(e.message || t('login.signInError'));
    } finally {
      setLoading(null);
    }
  };

  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) {
      setError(t('login.fillFields'));
      return;
    }
    if (password.length < 6) {
      setError(t('login.passwordMin'));
      return;
    }
    setLoading('email');
    setError('');
    try {
      if (isSignUp) {
        await onSignUpWithEmail(email.trim(), password);
      } else {
        await onSignInWithEmail(email.trim(), password);
      }
    } catch (e: any) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        setError(t('login.invalidCredentials'));
      } else if (e.code === 'auth/email-already-in-use') {
        setError(t('login.emailInUse'));
      } else if (e.code === 'auth/invalid-email') {
        setError(t('login.invalidEmail'));
      } else if (e.code === 'auth/weak-password') {
        setError(t('login.passwordMin'));
      } else {
        setError(e.message || t('login.signInError'));
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <MaterialCommunityIcons name="truck-delivery" size={48} color={colors.primary} />
          <Text style={styles.title}>RutaWater</Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {showEmailForm ? (
            <>
              <View style={styles.inputContainer}>
                <Ionicons name="mail-outline" size={20} color={colors.textHint} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder={t('login.email')}
                  placeholderTextColor={colors.textHint}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>

              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.textHint} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder={t('login.password')}
                  placeholderTextColor={colors.textHint}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textHint}
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.emailButton, !!loading && styles.buttonDisabled]}
                onPress={handleEmailAuth}
                disabled={!!loading}
                activeOpacity={0.7}
              >
                {loading === 'email' ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.emailButtonText}>
                    {isSignUp ? t('login.signUp') : t('login.signInEmail')}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => { setIsSignUp(!isSignUp); setError(''); }}>
                <Text style={styles.toggleText}>
                  {isSignUp ? t('login.alreadyHaveAccount') : t('login.noAccount')}
                </Text>
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('login.or')}</Text>
                <View style={styles.dividerLine} />
              </View>
            </>
          ) : null}

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.appleButton, !!loading && styles.buttonDisabled]}
              onPress={() => handleSignIn('apple')}
              disabled={!!loading}
              activeOpacity={0.7}
            >
              <Text style={styles.appleButtonText}>
                {loading === 'apple' ? t('login.connecting') : `\uF8FF  ${t('login.signInApple')}`}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, !!loading && styles.buttonDisabled]}
            onPress={() => handleSignIn('google')}
            disabled={!!loading}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>
              {loading === 'google' ? t('login.connecting') : t('login.signInGoogle')}
            </Text>
          </TouchableOpacity>

          {!showEmailForm && (
            <TouchableOpacity
              style={styles.emailToggleButton}
              onPress={() => setShowEmailForm(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="mail-outline" size={18} color={colors.primary} />
              <Text style={styles.emailToggleText}>{t('login.signInWithEmail')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 40,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textHint,
    marginBottom: 32,
  },
  error: {
    color: colors.dangerBright,
    fontSize: 15,
    marginBottom: 16,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    width: '100%',
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    paddingVertical: 14,
  },
  eyeIcon: {
    padding: 4,
  },
  emailButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 8,
  },
  emailButtonText: {
    color: colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
  },
  toggleText: {
    color: colors.primary,
    fontSize: 14,
    marginBottom: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textHint,
    fontSize: 13,
    marginHorizontal: 12,
  },
  appleButton: {
    backgroundColor: '#000000',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  appleButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.textWhite,
    fontSize: 18,
    fontWeight: '700',
  },
  emailToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 6,
  },
  emailToggleText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
});

export default LoginScreen;
