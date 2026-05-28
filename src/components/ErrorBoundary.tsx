import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import crashlytics from '@react-native-firebase/crashlytics';

// Strings hardcoded (sin i18n) por si el error es justamente en el provider de i18n
// o el ThemeProvider. El boundary tiene que renderizar siempre, sin dependencias.
const STRINGS = {
  title: 'Algo salió mal',
  subtitle: 'La app encontró un error inesperado. Probá reintentar — si sigue, cerrá y abrí de nuevo.',
  retry: 'Reintentar',
};

type Props = { children: React.ReactNode };
type State = { error: Error | null };

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      crashlytics().log(`componentStack: ${info.componentStack ?? '(none)'}`);
      crashlytics().recordError(error);
    } catch {
      // Si Crashlytics falla por lo que sea, no escalemos: el boundary tiene que aguantar.
    }
    if (__DEV__) {
      console.error('[ErrorBoundary] caught:', error, info.componentStack);
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>{STRINGS.title}</Text>
        <Text style={styles.subtitle}>{STRINGS.subtitle}</Text>
        {__DEV__ && (
          <Text style={styles.devMessage} numberOfLines={6}>
            {error.message}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={this.handleRetry}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonLabel}>{STRINGS.retry}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#3C3C43',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  devMessage: {
    fontSize: 12,
    color: '#B00020',
    fontFamily: 'Menlo',
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ErrorBoundary;
