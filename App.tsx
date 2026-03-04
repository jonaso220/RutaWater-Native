import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuthContext } from './src/context/AuthContext';
import { ClientsProvider } from './src/context/ClientsContext';
import { DebtsProvider } from './src/context/DebtsContext';
import { TransfersProvider } from './src/context/TransfersContext';
import { DailyLoadsProvider } from './src/context/DailyLoadsContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import LoginScreen from './src/screens/LoginScreen';
import AppNavigator from './src/navigation/AppNavigator';

const AppContent = () => {
  const { user, loading: authLoading, signInWithGoogle, signInWithApple } = useAuthContext();
  const { colors } = useTheme();

  if (authLoading) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background}}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onSignInWithGoogle={signInWithGoogle} onSignInWithApple={signInWithApple} />;
  }

  return (
    <ClientsProvider>
      <DebtsProvider>
        <TransfersProvider>
          <DailyLoadsProvider>
            <AppNavigator />
          </DailyLoadsProvider>
        </TransfersProvider>
      </DebtsProvider>
    </ClientsProvider>
  );
};

const App = () => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  </GestureHandlerRootView>
);

export default App;
