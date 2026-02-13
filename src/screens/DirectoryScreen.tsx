import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Client } from '../types';

interface DirectoryScreenProps {
  getFilteredDirectory: (term: string) => Client[];
  isAdmin: boolean;
}

const DirectoryScreen: React.FC<DirectoryScreenProps> = ({
  getFilteredDirectory,
  isAdmin,
}) => {
  const [search, setSearch] = useState('');

  const filteredClients = getFilteredDirectory(search);

  const renderClient = ({ item }: { item: Client }) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <Text style={styles.clientName}>{(item.name || '').toUpperCase()}</Text>
        <Text style={styles.clientAddress}>{item.address}</Text>
        {item.phone ? (
          <Text style={styles.clientPhone}>{item.phone}</Text>
        ) : null}
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.scheduleButton}
          onPress={() => {
            // TODO: implement schedule from directory
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.scheduleButtonText}>Agendar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre, dirección o teléfono..."
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
      </View>

      <Text style={styles.countText}>
        {filteredClients.length} cliente{filteredClients.length !== 1 ? 's' : ''} en el directorio
      </Text>

      {/* Client list */}
      <FlatList
        data={filteredClients}
        renderItem={renderClient}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No se encontraron clientes</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  searchContainer: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
  },
  countText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
  },
  listContent: {
    padding: 12,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  cardContent: {
    flex: 1,
    marginRight: 12,
  },
  clientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  clientAddress: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  clientPhone: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  cardActions: {
    gap: 8,
  },
  scheduleButton: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scheduleButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
  },
});

export default DirectoryScreen;
