import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { Client, Debt, Transfer } from '../types';
import { ALL_DAYS } from '../constants/products';
import { getTodayDayName } from '../utils/helpers';
import { DailyLoad } from '../hooks/useDailyLoads';
import ClientCard from '../components/ClientCard';
import EditClientModal from '../components/EditClientModal';
import DebtModal from '../components/DebtModal';
import ProductCounter from '../components/ProductCounter';
import NoteModal from '../components/NoteModal';
import DailyLoadModal from '../components/DailyLoadModal';
import TransfersSheet from '../components/TransfersSheet';

interface HomeScreenProps {
  clients: Client[];
  loading: boolean;
  getVisibleClients: (day: string) => Client[];
  getCompletedClients: (day: string) => Client[];
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
}

const HomeScreen: React.FC<HomeScreenProps> = ({
  clients,
  loading,
  getVisibleClients,
  getCompletedClients,
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
}) => {
  const [selectedDay, setSelectedDay] = useState(getTodayDayName());
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<Client | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showDailyLoadModal, setShowDailyLoadModal] = useState(false);
  const [showTransfersSheet, setShowTransfersSheet] = useState(false);

  const visibleClients = getVisibleClients(selectedDay);
  const completedClients = getCompletedClients(selectedDay);

  // Load daily load data when day changes
  useEffect(() => {
    loadForDay(selectedDay);
  }, [selectedDay, loadForDay]);

  const handleMarkDone = useCallback(
    (client: Client) => {
      markAsDone(client.id, client);
    },
    [markAsDone],
  );

  const handleDelete = useCallback(
    (client: Client) => {
      Alert.alert(
        'Quitar de la lista?',
        'Se guardara en el Directorio.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Quitar',
            onPress: () => deleteFromDay(client.id),
          },
        ],
      );
    },
    [deleteFromDay],
  );

  const handleUndoComplete = useCallback(
    (client: Client) => {
      undoComplete(client.id);
    },
    [undoComplete],
  );

  const handleToggleStar = useCallback(
    (client: Client) => {
      toggleStar(client.id, client.isStarred);
    },
    [toggleStar],
  );

  const handleAlarm = useCallback(
    (client: Client) => {
      if (client.alarm) {
        Alert.alert(
          'Alarma activa',
          `Alarma: ${client.alarm}`,
          [
            { text: 'Cerrar', style: 'cancel' },
            {
              text: 'Quitar alarma',
              style: 'destructive',
              onPress: () => saveAlarm(client.id, ''),
            },
          ],
        );
      } else {
        Alert.prompt?.(
          'Alarma',
          'Hora o nota para la alarma:',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Guardar',
              onPress: (text?: string) => {
                if (text?.trim()) saveAlarm(client.id, text.trim());
              },
            },
          ],
          'plain-text',
          '',
        ) ||
          // Fallback for Android (no Alert.prompt)
          saveAlarm(client.id, new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
      }
    },
    [saveAlarm],
  );

  const handleTransfer = useCallback(
    (client: Client) => {
      if (hasPendingTransfer(client.id)) {
        setShowTransfersSheet(true);
      } else {
        Alert.alert(
          'Agregar transferencia?',
          `Marcar transferencia pendiente para ${client.name}`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Agregar',
              onPress: () => addTransfer(client),
            },
          ],
        );
      }
    },
    [hasPendingTransfer, addTransfer],
  );

  const pendingTransferCount = transfers.length;

  const renderClient = useCallback(
    ({ item, index }: { item: Client; index: number }) => (
      <ClientCard
        client={item}
        index={index}
        isAdmin={isAdmin}
        hasDebt={getClientDebtTotal(item.id) > 0}
        hasPendingTransfer={hasPendingTransfer(item.id)}
        onMarkDone={() => handleMarkDone(item)}
        onEdit={() => setEditingClient(item)}
        onDelete={() => handleDelete(item)}
        onDebt={() => setDebtClient(item)}
        onToggleStar={() => handleToggleStar(item)}
        onTransfer={() => handleTransfer(item)}
        onAlarm={() => handleAlarm(item)}
      />
    ),
    [isAdmin, handleMarkDone, handleDelete, getClientDebtTotal, hasPendingTransfer, handleToggleStar, handleTransfer, handleAlarm],
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

      {/* Product counter */}
      <ProductCounter clients={visibleClients} />

      {/* Action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setShowNoteModal(true)}
        >
          <Text style={styles.actionBtnText}>+ Nota</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setShowDailyLoadModal(true)}
        >
          <Text style={styles.actionBtnText}>Carga</Text>
        </TouchableOpacity>
        {pendingTransferCount > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnTransfer]}
            onPress={() => setShowTransfersSheet(true)}
          >
            <Text style={[styles.actionBtnText, styles.actionBtnTransferText]}>
              Transf ({pendingTransferCount})
            </Text>
          </TouchableOpacity>
        )}
      </View>

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
        ListFooterComponent={
          completedClients.length > 0 ? (
            <View style={styles.completedSection}>
              <TouchableOpacity
                onPress={() => setShowCompleted(!showCompleted)}
                style={styles.completedHeader}
                activeOpacity={0.7}
              >
                <Text style={styles.completedTitle}>
                  {showCompleted ? '▼' : '▶'} Completados ({completedClients.length})
                </Text>
              </TouchableOpacity>
              {showCompleted &&
                completedClients.map((client) => (
                  <TouchableOpacity
                    key={client.id}
                    style={styles.completedCard}
                    onPress={() => handleUndoComplete(client)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.completedName}>
                      {(client.name || '').toUpperCase()}
                    </Text>
                    <Text style={styles.completedHint}>Tocar para deshacer</Text>
                  </TouchableOpacity>
                ))}
            </View>
          ) : null
        }
      />

      {/* Edit Client Modal */}
      <EditClientModal
        visible={!!editingClient}
        client={editingClient}
        onSave={updateClient}
        onClose={() => setEditingClient(null)}
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

      {/* Note Modal */}
      <NoteModal
        visible={showNoteModal}
        onSave={addNote}
        onClose={() => setShowNoteModal(false)}
      />

      {/* Daily Load Modal */}
      <DailyLoadModal
        visible={showDailyLoadModal}
        day={selectedDay}
        initialData={dailyLoad}
        onSave={saveDailyLoad}
        onClose={() => setShowDailyLoadModal(false)}
      />

      {/* Transfers Sheet */}
      <TransfersSheet
        visible={showTransfersSheet}
        transfers={transfers}
        isAdmin={isAdmin}
        onReview={markTransferReviewed}
        onClose={() => setShowTransfersSheet(false)}
      />
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
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  actionBtn: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  actionBtnTransfer: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  actionBtnTransferText: {
    color: '#059669',
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
    marginTop: 12,
    paddingTop: 4,
  },
  completedHeader: {
    padding: 12,
  },
  completedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  completedCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  completedName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },
  completedHint: {
    fontSize: 11,
    color: '#6EE7B7',
    fontStyle: 'italic',
  },
});

export default HomeScreen;
