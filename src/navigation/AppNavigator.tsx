import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import HomeScreen from '../screens/HomeScreen';
import DirectoryScreen from '../screens/DirectoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { Client, Debt, Transfer, Group, UserData } from '../types';
import { Frequency } from '../constants/products';
import { DailyLoad } from '../hooks/useDailyLoads';
import { Text as RNText } from 'react-native';

const Tab = createBottomTabNavigator();

interface AppNavigatorProps {
  clients: Client[];
  loading: boolean;
  getVisibleClients: (day: string) => Client[];
  getCompletedClients: (day: string) => Client[];
  getFilteredDirectory: (term: string) => Client[];
  isAdmin: boolean;
  markAsDone: (clientId: string, client: Client) => Promise<void>;
  undoComplete: (clientId: string) => Promise<void>;
  deleteFromDay: (clientId: string) => Promise<void>;
  updateClient: (clientId: string, data: Partial<Client>) => Promise<void>;
  debts: Debt[];
  addDebt: (client: Client, amount: number) => Promise<void>;
  markDebtPaid: (debt: Debt) => Promise<void>;
  editDebt: (debtId: string, newAmount: number) => Promise<void>;
  getClientDebtTotal: (clientId: string) => number;
  scheduleFromDirectory: (
    client: Client,
    days: string[],
    freq: Frequency,
    date: string,
    notes: string,
    products: Record<string, number>,
  ) => Promise<void>;
  toggleStar: (clientId: string, currentValue: boolean) => Promise<void>;
  saveAlarm: (clientId: string, time: string) => Promise<void>;
  addNote: (notesText: string, date: string) => Promise<void>;
  transfers: Transfer[];
  hasPendingTransfer: (clientId: string) => boolean;
  addTransfer: (client: Client) => Promise<boolean | undefined>;
  markTransferReviewed: (transfer: Transfer) => Promise<void>;
  dailyLoad: DailyLoad;
  loadForDay: (day: string) => Promise<void>;
  saveDailyLoad: (day: string, data: DailyLoad) => Promise<void>;
  // Settings
  user: UserData;
  groupData: Group | null;
  onSignOut: () => void;
  onGroupUpdate: (data: Group | null) => void;
}

const AppNavigator: React.FC<AppNavigatorProps> = ({
  clients,
  loading,
  getVisibleClients,
  getCompletedClients,
  getFilteredDirectory,
  isAdmin,
  markAsDone,
  undoComplete,
  deleteFromDay,
  updateClient,
  debts,
  addDebt,
  markDebtPaid,
  editDebt,
  getClientDebtTotal,
  scheduleFromDirectory,
  toggleStar,
  saveAlarm,
  addNote,
  transfers,
  hasPendingTransfer,
  addTransfer,
  markTransferReviewed,
  dailyLoad,
  loadForDay,
  saveDailyLoad,
  user,
  groupData,
  onSignOut,
  onGroupUpdate,
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
              markAsDone={markAsDone}
              undoComplete={undoComplete}
              deleteFromDay={deleteFromDay}
              updateClient={updateClient}
              debts={debts}
              addDebt={addDebt}
              markDebtPaid={markDebtPaid}
              editDebt={editDebt}
              getClientDebtTotal={getClientDebtTotal}
              toggleStar={toggleStar}
              saveAlarm={saveAlarm}
              addNote={addNote}
              transfers={transfers}
              hasPendingTransfer={hasPendingTransfer}
              addTransfer={addTransfer}
              markTransferReviewed={markTransferReviewed}
              dailyLoad={dailyLoad}
              loadForDay={loadForDay}
              saveDailyLoad={saveDailyLoad}
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
              scheduleFromDirectory={scheduleFromDirectory}
              debts={debts}
              addDebt={addDebt}
              markDebtPaid={markDebtPaid}
              editDebt={editDebt}
              getClientDebtTotal={getClientDebtTotal}
            />
          )}
        </Tab.Screen>

        <Tab.Screen
          name="Ajustes"
          options={{
            headerTitle: 'Ajustes',
            tabBarIcon: ({ color }) => (
              <TabIcon label="⚙️" color={color} />
            ),
          }}
        >
          {() => (
            <SettingsScreen
              user={user}
              groupData={groupData}
              isAdmin={isAdmin}
              onSignOut={onSignOut}
              onGroupUpdate={onGroupUpdate}
            />
          )}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
};

// Simple emoji-based tab icon
const TabIcon = ({ label }: { label: string; color: string }) => (
  <RNText style={{ fontSize: 20 }}>{label}</RNText>
);

export default AppNavigator;
