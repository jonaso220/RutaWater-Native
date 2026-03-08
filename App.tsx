// ============================================================
// Importaciones principales de React y React Native
// ============================================================
import React from 'react';
import { ActivityIndicator, LogBox, View } from 'react-native';

// Suprime la advertencia conocida de measureLayout en la consola
LogBox.ignoreLogs(['ref.measureLayout']);

// Libreria necesaria para manejar gestos (swipe, drag, etc.)
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// ============================================================
// Proveedores de contexto global (estado compartido de la app)
// ============================================================
import { AuthProvider, useAuthContext } from './src/context/AuthContext';       // Autenticacion del usuario
import { ClientsProvider } from './src/context/ClientsContext';                 // Datos de clientes
import { DebtsProvider } from './src/context/DebtsContext';                     // Datos de deudas
import { TransfersProvider } from './src/context/TransfersContext';             // Datos de transferencias
import { DailyLoadsProvider } from './src/context/DailyLoadsContext';           // Datos de cargas diarias

// ============================================================
// Tema visual y pantallas
// ============================================================
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';             // Proveedor de tema (colores, modo oscuro, etc.)
import LoginScreen from './src/screens/LoginScreen';                            // Pantalla de inicio de sesion
import AppNavigator from './src/navigation/AppNavigator';                       // Navegacion principal de la app

// ============================================================
// AppContent: Decide que mostrar segun el estado de autenticacion
// ============================================================
const AppContent = () => {
  // Obtiene el usuario actual, estado de carga y metodos de login del contexto de auth
  const { user, loading: authLoading, signInWithGoogle, signInWithApple } = useAuthContext();
  // Obtiene los colores del tema actual
  const { colors } = useTheme();

  // Mientras se verifica la sesion, muestra un indicador de carga
  if (authLoading) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background}}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Si no hay usuario autenticado, muestra la pantalla de login
  if (!user) {
    return <LoginScreen onSignInWithGoogle={signInWithGoogle} onSignInWithApple={signInWithApple} />;
  }

  // Usuario autenticado: envuelve la app con los proveedores de datos
  // y renderiza el navegador principal
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

// ============================================================
// App: Componente raiz que envuelve toda la aplicacion
// con los proveedores fundamentales (gestos, tema, auth)
// ============================================================
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
