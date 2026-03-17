import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { useLayout } from '../hooks/useLayout';
import HomeScreen from '../screens/HomeScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import PaywallScreen from '../screens/PaywallScreen';
import AlarmBanner from '../components/AlarmBanner';
import { useAutoMergeDuplicates } from '../hooks/useAutoMergeDuplicates';
import { useAlarmChecker } from '../hooks/useAlarmChecker';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const TabNavigator = () => {
  const { colors } = useTheme();
  const { fontScale } = useLayout();
  const { t } = useTranslation();
  useAutoMergeDuplicates();
  const { activeAlarm, dismissAlarm } = useAlarmChecker();

  const s = (v: number) => Math.round(v * fontScale);

  return (
    <>
      <AlarmBanner alarm={activeAlarm} onDismiss={dismissAlarm} />
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.headerBackground },
          headerTintColor: colors.headerText,
          headerTitleStyle: { fontWeight: '700', fontSize: s(17) },
          tabBarStyle: {
            backgroundColor: colors.tabBarBackground,
            borderTopColor: colors.tabBarBorder,
            paddingBottom: 4,
            height: s(56),
          },
          tabBarActiveTintColor: colors.tabActive,
          tabBarInactiveTintColor: colors.tabInactive,
          tabBarLabelStyle: { fontSize: s(13), fontWeight: '600' },
        }}
      >
        <Tab.Screen
          name="Inicio"
          component={HomeScreen}
          options={{
            headerTitle: 'RutaWater',
            tabBarLabel: t('nav.home'),
            tabBarIcon: ({ color }) => <Ionicons name="home" size={Math.round(22 * fontScale)} color={color} />,
          }}
        />
        <Tab.Screen
          name="Directorio"
          component={DirectoryScreen}
          options={{
            headerTitle: t('nav.directory'),
            tabBarLabel: t('nav.directory'),
            tabBarIcon: ({ color }) => <Ionicons name="people" size={Math.round(22 * fontScale)} color={color} />,
          }}
        />
        <Tab.Screen
          name="Ajustes"
          component={SettingsScreen}
          options={{
            headerTitle: t('nav.settings'),
            tabBarLabel: t('nav.settings'),
            tabBarIcon: ({ color }) => <Ionicons name="settings" size={Math.round(22 * fontScale)} color={color} />,
          }}
        />
      </Tab.Navigator>
    </>
  );
};

const AppNavigator = () => {
  const { colors, isDark } = useTheme();

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.card,
      text: colors.textPrimary,
      border: colors.cardBorder,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={TabNavigator} />
        <Stack.Screen
          name="Paywall"
          component={PaywallScreen}
          options={{ presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
