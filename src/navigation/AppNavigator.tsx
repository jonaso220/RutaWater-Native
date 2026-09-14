import React from 'react';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const { fontScale, width, isPhoneLandscape } = useLayout();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'android' || isPhoneLandscape ? insets.bottom : 0;
  const { t } = useTranslation();
  const { activeAlarm, dismissAlarm } = useAlarmChecker();

  // Header + tab bar scale with the global fontScale, which ramps up on wide
  // screens (see useLayout) so they don't look tiny on an iPad/Mac.
  const s = (v: number) => Math.round(v * fontScale);
  // On wide screens (iPad/Mac) there's no home-indicator inset and the scaled
  // emoji icons are tall, so the bar needs extra height + bottom room or the
  // label gets clipped against the bottom edge.
  const isWideNav = width >= 900 && !isPhoneLandscape;
  // On wide screens the scaled emoji gets clipped at the bottom inside the tab
  // bar's icon slot. Wrapping it in a roomy, centered box (instead of forcing a
  // big lineHeight, which pushes the glyph down and clips it more) gives the
  // emoji space above and below. Phone keeps the plain text icon untouched.
  const renderTabIcon = (emoji: string) =>
    isWideNav ? (
      <View style={{ height: s(36), justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: s(22), lineHeight: s(26), textAlign: 'center' }}>{emoji}</Text>
      </View>
    ) : (
      <Text style={{ fontSize: s(isPhoneLandscape ? 18 : 22) }}>{emoji}</Text>
    );

  return (
    <>
      <AlarmBanner alarm={activeAlarm} onDismiss={dismissAlarm} />
      <Tab.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.headerBackground,
            ...(isPhoneLandscape ? { height: 44 + insets.top } : {}),
          },
          sceneStyle: isPhoneLandscape ? {
            paddingLeft: insets.left,
            paddingRight: insets.right,
          } : undefined,
          headerTintColor: colors.headerText,
          headerTitleStyle: { fontWeight: '700', fontSize: s(17) },
          // A horizontal icon and label save vertical space on a rotated phone.
          tabBarLabelPosition: isPhoneLandscape ? 'beside-icon' : 'below-icon',
          tabBarStyle: {
            backgroundColor: colors.tabBarBackground,
            borderTopColor: colors.tabBarBorder,
            // Keep Android controls above the system navigation area when
            // Android 15+ enforces edge-to-edge rendering.
            paddingTop: isWideNav ? s(10) : 0,
            paddingBottom: (isWideNav ? s(10) : isPhoneLandscape ? 0 : 4) + bottomInset,
            height: (isWideNav ? s(74) : isPhoneLandscape ? 44 : s(56)) + bottomInset,
          },
          tabBarActiveTintColor: colors.tabActive,
          tabBarInactiveTintColor: colors.tabInactive,
          // On wide screens add a gap below the icon and a roomier lineHeight
          // so the label isn't glued to the icon nor clipped at the descenders
          // (e.g. the "j" in "Ajustes"). Phone unchanged.
          tabBarLabelStyle: {
            fontSize: s(13),
            fontWeight: '600',
            marginTop: isWideNav ? s(6) : 0,
            lineHeight: isWideNav ? s(18) : undefined,
          },
        }}
      >
        <Tab.Screen
          name="Inicio"
          component={HomeScreen}
          options={{
            headerTitleAlign: 'left',
            headerTitleContainerStyle: {
              maxWidth: Math.max(0, width - insets.left - insets.right - Math.min(s(160), width * 0.44) - 44),
            },
            headerTitle: () => (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons
                  name="truck-delivery"
                  size={s(22)}
                  color={colors.headerText}
                  style={{ marginRight: 8 }}
                />
                <Text numberOfLines={1} style={{ color: colors.headerText, fontWeight: '700', fontSize: s(17), flexShrink: 1 }}>
                  RutaWater
                </Text>
              </View>
            ),
            headerRight: () => <ProfileSwitcherButton />,
            tabBarLabel: t('nav.home'),
            tabBarIcon: () => renderTabIcon('🏠'),
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
            tabBarIcon: () => renderTabIcon('📋'),
          }}
        />
        <Tab.Screen
          name="Ajustes"
          component={SettingsScreen}
          options={{
            headerTitle: t('nav.settings'),
            tabBarLabel: t('nav.settings'),
            tabBarIcon: () => renderTabIcon('⚙️'),
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
