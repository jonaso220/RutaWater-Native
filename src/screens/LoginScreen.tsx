import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface LoginScreenProps {
  onSignInWithGoogle: () => Promise<void>;
  onSignInWithApple: () => Promise<void>;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onSignInWithGoogle, onSignInWithApple }) => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [loading, setLoading] = React.useState<'google' | 'apple' | null>(null);
  const [error, setError] = React.useState('');

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
      setError(e.message || 'Error al iniciar sesion');
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.emoji}>🚚</Text>
        <Text style={styles.title}>RutaWater</Text>
        <Text style={styles.subtitle}>Gestion de rutas de agua</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[styles.appleButton, !!loading && styles.buttonDisabled]}
            onPress={() => handleSignIn('apple')}
            disabled={!!loading}
            activeOpacity={0.7}
          >
            <Text style={styles.appleButtonText}>
              {loading === 'apple' ? 'Conectando...' : '\uF8FF  Iniciar con Apple'}
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
            {loading === 'google' ? 'Conectando...' : 'Iniciar con Google'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  emoji: {
    fontSize: 48,
    marginBottom: 12,
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
});

export default LoginScreen;
