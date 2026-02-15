import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Text as RNText } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#111827' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700' },
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#E5E7EB',
            paddingBottom: 4,
            height: 56,
          },
          tabBarActiveTintColor: '#2563EB',
          tabBarInactiveTintColor: '#9CA3AF',
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tab.Screen
          name="Inicio"
          component={HomeScreen}
          options={{
            headerTitle: 'RutaWater',
            tabBarIcon: () => <TabIcon label="🏠" />,
          }}
        />
        <Tab.Screen
          name="Directorio"
          component={DirectoryScreen}
          options={{
            headerTitle: 'Directorio',
            tabBarIcon: () => <TabIcon label="👥" />,
          }}
        />
        <Tab.Screen
          name="Ajustes"
          component={SettingsScreen}
          options={{
            headerTitle: 'Ajustes',
            tabBarIcon: () => <TabIcon label="⚙️" />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
};

const TabIcon = ({ label }: { label: string }) => (
  <RNText style={{ fontSize: 20 }}>{label}</RNText>
);

export default AppNavigator;
