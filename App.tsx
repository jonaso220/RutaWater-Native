import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useAuth } from './src/hooks/useAuth';
import { useClients } from './src/hooks/useClients';
import LoginScreen from './src/screens/LoginScreen';
import AppNavigator from './src/navigation/AppNavigator';

const App = () => {
  const {
    user,
    loading: authLoading,
    groupData,
    isAdmin,
    signInWithGoogle,
    signOut,
    getDataScope,
  } = useAuth();

  const scope = getDataScope();
  const {
    clients,
    loading: clientsLoading,
    getVisibleClients,
    getCompletedClients,
    getFilteredDirectory,
  } = useClients({
    userId: user?.uid || '',
    groupId: groupData?.groupId,
  });

  // Auth loading
  if (authLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  // Not logged in
  if (!user) {
    return <LoginScreen onSignIn={signInWithGoogle} />;
  }

  // Logged in - show main app
  return (
    <AppNavigator
      clients={clients}
      loading={clientsLoading}
      getVisibleClients={getVisibleClients}
      getCompletedClients={getCompletedClients}
      getFilteredDirectory={getFilteredDirectory}
      isAdmin={isAdmin}
    />
  );
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
  },
});

export default App;
