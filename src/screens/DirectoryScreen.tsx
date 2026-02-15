import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import { Client, Debt } from '../types';
import { Frequency } from '../constants/products';
import { normalizePhone } from '../utils/helpers';
import { PRODUCTS } from '../constants/products';
import ScheduleModal from '../components/ScheduleModal';
import DebtModal from '../components/DebtModal';

interface DirectoryScreenProps {
  getFilteredDirectory: (term: string) => Client[];
  isAdmin: boolean;
  scheduleFromDirectory: (
    client: Client,
    days: string[],
    freq: Frequency,
    date: string,
    notes: string,
    products: Record<string, number>,
  ) => Promise<void>;
  debts: Debt[];
  addDebt: (client: Client, amount: number) => Promise<void>;
  markDebtPaid: (debt: Debt) => Promise<void>;
  editDebt: (debtId: string, newAmount: number) => Promise<void>;
  getClientDebtTotal: (clientId: string) => number;
}

const DirectoryScreen: React.FC<DirectoryScreenProps> = ({
  getFilteredDirectory,
  isAdmin,
  scheduleFromDirectory,
  debts,
  addDebt,
  markDebtPaid,
  editDebt,
  getClientDebtTotal,
}) => {
  const [search, setSearch] = useState('');
  const [scheduleClient, setScheduleClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);

  const filteredClients = getFilteredDirectory(search);

  const sendWhatsApp = (client: Client) => {
    if (!client.phone) return;
    const cleanPhone = normalizePhone(client.phone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
  };

  const openMaps = (client: Client) => {
    if (client.lat && client.lng) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`,
      );
    } else if (client.mapsLink) {
      Linking.openURL(client.mapsLink);
    }
  };

  const getProductSummary = (client: Client): string => {
    if (!client.products) return '';
    return Object.keys(client.products)
      .filter((k) => parseInt(String(client.products[k] || 0), 10) > 0)
      .map((k) => {
        const p = PRODUCTS.find((prod) => prod.id === k);
        return `${client.products[k]}x ${p ? p.short : k}`;
      })
      .join(', ');
  };

  const getFreqLabel = (freq: string): string => {
    switch (freq) {
      case 'weekly': return 'Semanal';
      case 'biweekly': return 'Quincenal';
      case 'triweekly': return 'Cada 3 sem';
      case 'monthly': return 'Mensual';
      case 'once': return 'Una vez';
      case 'on_demand': return 'Solo Directorio';
      default: return freq || '';
    }
  };

  const renderClient = ({ item }: { item: Client }) => {
    const debtTotal = getClientDebtTotal(item.id);
    const productSummary = getProductSummary(item);
    const isOnDemand = item.freq === 'on_demand' || !item.visitDays?.length;

    return (
      <View
        style={[
          styles.card,
          debtTotal > 0 && styles.cardDebt,
        ]}
      >
        <View style={styles.cardContent}>
          <View style={styles.nameRow}>
            <Text style={styles.clientName}>
              {(item.name || '').toUpperCase()}
            </Text>
            {debtTotal > 0 && (
              <TouchableOpacity onPress={() => setDebtClient(item)}>
                <Text style={styles.debtBadge}>
                  ${debtTotal.toLocaleString()}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {item.address ? (
            <Text style={styles.clientAddress}>{item.address}</Text>
          ) : null}
          {item.phone ? (
            <Text style={styles.clientPhone}>{item.phone}</Text>
          ) : null}
          {productSummary ? (
            <Text style={styles.productText}>📦 {productSummary}</Text>
          ) : null}

          {/* Freq + days info */}
          <View style={styles.infoRow}>
            <Text style={styles.freqBadge}>{getFreqLabel(item.freq)}</Text>
            {item.visitDays && item.visitDays.length > 0 && (
              <Text style={styles.daysText}>
                {item.visitDays.map((d) => d.slice(0, 3)).join(', ')}
              </Text>
            )}
          </View>

          {/* Action buttons row */}
          <View style={styles.actionsRow}>
            {item.phone ? (
              <TouchableOpacity
                onPress={() => sendWhatsApp(item)}
                style={styles.actionBtn}
              >
                <Text style={styles.actionBtnText}>💬</Text>
              </TouchableOpacity>
            ) : null}
            {(item.lat && item.lng) || item.mapsLink ? (
              <TouchableOpacity
                onPress={() => openMaps(item)}
                style={styles.actionBtn}
              >
                <Text style={styles.actionBtnText}>📍</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setDebtClient(item)}
              style={styles.actionBtn}
            >
              <Text style={styles.actionBtnText}>
                {debtTotal > 0 ? '🔴' : '💰'}
              </Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.scheduleButton}
              onPress={() => setScheduleClient(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.scheduleButtonText}>
                {isOnDemand ? 'Agendar' : '+ Visita'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre, direccion o telefono..."
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
      </View>

      <Text style={styles.countText}>
        {filteredClients.length} cliente
        {filteredClients.length !== 1 ? 's' : ''} en el directorio
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

      {/* Schedule Modal */}
      <ScheduleModal
        visible={!!scheduleClient}
        client={scheduleClient}
        onSave={scheduleFromDirectory}
        onClose={() => setScheduleClient(null)}
      />

      {/* Debt Modal */}
      <DebtModal
        visible={!!debtClient}
        client={debtClient}
        debts={debts}
        onClose={() => setDebtClient(null)}
        onAddDebt={addDebt}
        onMarkPaid={markDebtPaid}
        onEditDebt={editDebt}
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
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  cardDebt: {
    borderLeftColor: '#DC2626',
  },
  cardContent: {
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  debtBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  clientAddress: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  clientPhone: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  productText: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '600',
    marginTop: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  freqBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  daysText: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  actionBtn: {
    padding: 6,
    borderRadius: 6,
  },
  actionBtnText: {
    fontSize: 16,
  },
  scheduleButton: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 14,
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
