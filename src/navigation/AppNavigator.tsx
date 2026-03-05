import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { Text as RNText } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useLayout } from '../hooks/useLayout';
import HomeScreen from '../screens/HomeScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AlarmBanner from '../components/AlarmBanner';
import { useAutoMergeDuplicates } from '../hooks/useAutoMergeDuplicates';
import { useAlarmChecker } from '../hooks/useAlarmChecker';

const Tab = createBottomTabNavigator();

const AppNavigator = () => {
  const { colors, isDark } = useTheme();
  const { fontScale } = useLayout();
  useAutoMergeDuplicates();
  const { activeAlarm, dismissAlarm } = useAlarmChecker();

  const s = (v: number) => Math.round(v * fontScale);

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
            tabBarIcon: () => <TabIcon label="🏠" scale={fontScale} />,
          }}
        />
        <Tab.Screen
          name="Directorio"
          component={DirectoryScreen}
          options={{
            headerTitle: 'Directorio',
            tabBarIcon: () => <TabIcon label="👥" scale={fontScale} />,
          }}
        />
        <Tab.Screen
          name="Ajustes"
          component={SettingsScreen}
          options={{
            headerTitle: 'Ajustes',
            tabBarIcon: () => <TabIcon label="⚙️" scale={fontScale} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
};

const TabIcon = ({ label, scale = 1 }: { label: string; scale?: number }) => (
  <RNText style={{ fontSize: Math.round(22 * scale) }}>{label}</RNText>
);

export default AppNavigator;
