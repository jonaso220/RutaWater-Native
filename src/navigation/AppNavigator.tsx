import React from 'react';
import { Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { useLayout } from '../hooks/useLayout';
import HomeScreen from '../screens/HomeScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import PaywallScreen from '../screens/PaywallScreen';
import AlarmBanner from '../components/AlarmBanner';
import ProfileSwitcherButton from '../components/ProfileSwitcherButton';
import { useAlarmChecker } from '../hooks/useAlarmChecker';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TabNavigator = () => {
  const { colors } = useTheme();
  const { fontScale, width } = useLayout();
  const { t } = useTranslation();
  const { activeAlarm, dismissAlarm } = useAlarmChecker();

  // Header + tab bar scale with the global fontScale, which ramps up on wide
  // screens (see useLayout) so they don't look tiny on an iPad/Mac.
  const s = (v: number) => Math.round(v * fontScale);
  // On wide screens (iPad/Mac) there's no home-indicator inset and the scaled
  // emoji icons are tall, so the bar needs extra height + bottom room or the
  // label gets clipped against the bottom edge.
  const isWideNav = width >= 900;

  return (
    <>
      <AlarmBanner alarm={activeAlarm} onDismiss={dismissAlarm} />
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.headerBackground },
          headerTintColor: colors.headerText,
          headerTitleStyle: { fontWeight: '700', fontSize: s(17) },
          // Keep the icon-over-label layout on every screen size. On wide
          // screens (iPad/Mac) React Navigation defaults to label-beside-icon,
          // which looks squished — force below-icon like on the phone.
          tabBarLabelPosition: 'below-icon',
          tabBarStyle: {
            backgroundColor: colors.tabBarBackground,
            borderTopColor: colors.tabBarBorder,
            // Symmetric padding on wide screens so the icon+label stack stays
            // centered in the taller bar (asymmetric padding pushed it up).
            paddingTop: isWideNav ? s(10) : s(6),
            paddingBottom: isWideNav ? s(10) : s(8),
            height: isWideNav ? s(70) : s(60),
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
            headerTitle: () => (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons
                  name="truck-delivery"
                  size={s(22)}
                  color={colors.headerText}
                  style={{ marginRight: 8 }}
                />
                <Text style={{ color: colors.headerText, fontWeight: '700', fontSize: s(17) }}>
                  RutaWater
                </Text>
              </View>
            ),
            headerRight: () => <ProfileSwitcherButton />,
            tabBarLabel: t('nav.home'),
            tabBarIcon: () => <Text style={{ fontSize: s(22) }}>🏠</Text>,
          }}
        />
        <Tab.Screen
          name="Directorio"
          component={DirectoryScreen}
          options={{
            headerTitle: () => (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons
                  name="account-multiple"
                  size={s(22)}
                  color={colors.headerText}
                  style={{ marginRight: 8 }}
                />
                <Text style={{ color: colors.headerText, fontWeight: '700', fontSize: s(17) }}>
                  {t('nav.directory')}
                </Text>
              </View>
            ),
            tabBarLabel: t('nav.directory'),
            tabBarIcon: () => <Text style={{ fontSize: s(22) }}>📋</Text>,
          }}
        />
        <Tab.Screen
          name="Ajustes"
          component={SettingsScreen}
          options={{
            headerTitle: t('nav.settings'),
            tabBarLabel: t('nav.settings'),
            tabBarIcon: () => <Text style={{ fontSize: s(22) }}>⚙️</Text>,
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
          options={{ presentation: 'fullScreenModal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
