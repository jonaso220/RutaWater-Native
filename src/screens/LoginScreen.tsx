import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';

interface LoginScreenProps {
  onSignIn: () => Promise<void>;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onSignIn }) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await onSignIn();
    } catch (e: any) {
      setError(e.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.emoji}>🚚</Text>
        <Text style={styles.title}>RutaWater</Text>
        <Text style={styles.subtitle}>Gestión de rutas de agua</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Conectando...' : 'Iniciar con Google'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1F2937',
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
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 32,
  },
  error: {
    color: '#EF4444',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2563EB',
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
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default LoginScreen;
