import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { AuthProvider, useAuthContext } from './src/context/AuthContext';
import { ClientsProvider } from './src/context/ClientsContext';
import { DebtsProvider } from './src/context/DebtsContext';
import { TransfersProvider } from './src/context/TransfersContext';
import { DailyLoadsProvider } from './src/context/DailyLoadsContext';
import LoginScreen from './src/screens/LoginScreen';
import AppNavigator from './src/navigation/AppNavigator';

const AppContent = () => {
  const { user, loading: authLoading, signInWithGoogle } = useAuthContext();

  if (authLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onSignIn={signInWithGoogle} />;
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
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
  },
});

export default App;
