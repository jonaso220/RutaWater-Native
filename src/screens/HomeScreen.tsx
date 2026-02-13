import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Client } from '../types';
import { ALL_DAYS } from '../constants/products';
import { getTodayDayName } from '../utils/helpers';
import ClientCard from '../components/ClientCard';

interface HomeScreenProps {
  clients: Client[];
  loading: boolean;
  getVisibleClients: (day: string) => Client[];
  getCompletedClients: (day: string) => Client[];
  isAdmin: boolean;
}

const HomeScreen: React.FC<HomeScreenProps> = ({
  clients,
  loading,
  getVisibleClients,
  getCompletedClients,
  isAdmin,
}) => {
  const [selectedDay, setSelectedDay] = useState(getTodayDayName());

  const visibleClients = getVisibleClients(selectedDay);
  const completedClients = getCompletedClients(selectedDay);

  const renderClient = useCallback(
    ({ item, index }: { item: Client; index: number }) => (
      <ClientCard
        client={item}
        index={index}
        isAdmin={isAdmin}
        onMarkDone={() => {
          // TODO: implement handleMarkAsDoneInList
        }}
        onEdit={() => {
          // TODO: implement editClient
        }}
        onDelete={() => {
          // TODO: implement handleDeleteClient
        }}
      />
    ),
    [isAdmin],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Cargando clientes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Day selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.daySelector}
        contentContainerStyle={styles.daySelectorContent}
      >
        {ALL_DAYS.map((day) => {
          const isToday = day === getTodayDayName();
          const isSelected = day === selectedDay;
          const count = getVisibleClients(day).length;

          return (
            <TouchableOpacity
              key={day}
              onPress={() => setSelectedDay(day)}
              style={[
                styles.dayChip,
                isSelected && styles.dayChipSelected,
                isToday && !isSelected && styles.dayChipToday,
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.dayChipText,
                  isSelected && styles.dayChipTextSelected,
                ]}
              >
                {day.slice(0, 3)}
              </Text>
              <Text
                style={[
                  styles.dayCount,
                  isSelected && styles.dayCountSelected,
                ]}
              >
                {count}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Client list */}
      <FlatList
        data={visibleClients}
        renderItem={renderClient}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>
              No hay clientes para {selectedDay}
            </Text>
          </View>
        }
      />

      {/* Completed section */}
      {completedClients.length > 0 && (
        <View style={styles.completedSection}>
          <Text style={styles.completedTitle}>
            Completados ({completedClients.length})
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
  },
  daySelector: {
    maxHeight: 56,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  daySelectorContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  dayChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  dayChipSelected: {
    backgroundColor: '#2563EB',
  },
  dayChipToday: {
    borderWidth: 1.5,
    borderColor: '#2563EB',
  },
  dayChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  dayChipTextSelected: {
    color: '#FFFFFF',
  },
  dayCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  dayCountSelected: {
    color: '#2563EB',
    backgroundColor: '#DBEAFE',
  },
  listContent: {
    padding: 12,
    paddingBottom: 100,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
  },
  completedSection: {
    borderTopWidth: 2,
    borderTopColor: '#E5E7EB',
    borderStyle: 'dashed',
    padding: 16,
  },
  completedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});

export default HomeScreen;
