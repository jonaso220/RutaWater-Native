import React from 'react';
import { ActivityIndicator, LogBox, View } from 'react-native';
import './src/i18n';

LogBox.ignoreLogs(['ref.measureLayout']);

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, useAuthContext } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { StoreSync } from './src/stores/StoreSync';
import LoginScreen from './src/screens/LoginScreen';
import AppNavigator from './src/navigation/AppNavigator';
import { queryClient } from './src/lib/queryClient';

const AppContent = () => {
  const { user, loading: authLoading, signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple } = useAuthContext();
  const { colors } = useTheme();

  if (authLoading) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background}}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onSignInWithEmail={signInWithEmail} onSignUpWithEmail={signUpWithEmail} onSignInWithGoogle={signInWithGoogle} onSignInWithApple={signInWithApple} />;
  }

  return (
    <StoreSync>
      <AppNavigator />
    </StoreSync>
  );
};

const App = () => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </GestureHandlerRootView>
);

export default App;
