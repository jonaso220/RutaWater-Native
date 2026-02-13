import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import HomeScreen from '../screens/HomeScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import { Client } from '../types';

const Tab = createBottomTabNavigator();

interface AppNavigatorProps {
  clients: Client[];
  loading: boolean;
  getVisibleClients: (day: string) => Client[];
  getCompletedClients: (day: string) => Client[];
  getFilteredDirectory: (term: string) => Client[];
  isAdmin: boolean;
}

const AppNavigator: React.FC<AppNavigatorProps> = ({
  clients,
  loading,
  getVisibleClients,
  getCompletedClients,
  getFilteredDirectory,
  isAdmin,
}) => {
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
          options={{
            headerTitle: 'RutaWater',
            tabBarIcon: ({ color }) => (
              <TabIcon label="🏠" color={color} />
            ),
          }}
        >
          {() => (
            <HomeScreen
              clients={clients}
              loading={loading}
              getVisibleClients={getVisibleClients}
              getCompletedClients={getCompletedClients}
              isAdmin={isAdmin}
            />
          )}
        </Tab.Screen>

        <Tab.Screen
          name="Directorio"
          options={{
            headerTitle: 'Directorio',
            tabBarIcon: ({ color }) => (
              <TabIcon label="👥" color={color} />
            ),
          }}
        >
          {() => (
            <DirectoryScreen
              getFilteredDirectory={getFilteredDirectory}
              isAdmin={isAdmin}
            />
          )}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
};

// Simple emoji-based tab icon (replace with react-native-vector-icons later)
import { Text as RNText } from 'react-native';

const TabIcon = ({ label }: { label: string; color: string }) => (
  <RNText style={{ fontSize: 20 }}>{label}</RNText>
);

export default AppNavigator;
