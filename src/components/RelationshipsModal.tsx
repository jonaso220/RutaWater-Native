import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { Client, RELATIONSHIP_TYPES } from '../types';
import { normalizePhone, fuzzyMatch, matchScore, getModalWidth } from '../utils/helpers';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

interface RelationshipsModalProps {
  visible: boolean;
  client: Client | null;
  allClients: Client[];
  onClose: () => void;
  onAddRelationship: (clientId: string, targetId: string, type: string) => Promise<void>;
  onRemoveRelationship: (clientId: string, targetId: string) => Promise<void>;
}

const RelationshipsModal: React.FC<RelationshipsModalProps> = ({
  visible,
  client,
  allClients,
  onClose,
  onAddRelationship,
  onRemoveRelationship,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth);
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<Client | null>(null);
  const [selectedType, setSelectedType] = useState('');
  const [saving, setSaving] = useState(false);

  const relationships = client?.relationships || {};
  const relatedIds = Object.keys(relationships);

  // Linked clients with their relationship type
  const linkedClients = useMemo(() => {
    if (!client) return [];
    return relatedIds
      .map((id) => {
        const c = allClients.find((cl) => cl.id === id);
        if (!c) return null;
        return { client: c, type: relationships[id] };
      })
      .filter(Boolean) as { client: Client; type: string }[];
  }, [client, allClients, relatedIds, relationships]);

  // Search results for adding new relationship.
  // Rank by matchScore (same as the directory) so exact prefix matches
  // appear first instead of being lost among generic fuzzy matches.
  const searchResults = useMemo(() => {
    if (!client || !searchTerm.trim()) return [];
    const matcher = fuzzyMatch(searchTerm);
    return allClients
      .filter((c) => !c.isNote)
      .filter((c) => c.id !== client.id)
      .filter((c) => !relatedIds.includes(c.id))
      .filter((c) => matcher(c.name || '', c.address || '', c.phone || ''))
      .map((c) => ({ c, score: matchScore(searchTerm, c.name || '', c.address || '', c.phone || '') }))
      .sort((a, b) => b.score - a.score || (a.c.name || '').localeCompare(b.c.name || ''))
      .map((entry) => entry.c)
      .slice(0, 20);
  }, [searchTerm, allClients, client, relatedIds]);

  if (!client) return null;

  const handleAdd = async () => {
    if (!selectedTarget || !selectedType || saving) return;
    setSaving(true);
    try {
      await onAddRelationship(client.id, selectedTarget.id, selectedType);
      resetAddState();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (relatedClient: Client) => {
    Alert.alert(
      t('relationships.remove'),
      t('relationships.removeConfirm', { name: relatedClient.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('relationships.remove'),
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await onRemoveRelationship(client.id, relatedClient.id);
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const callClient = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const openWhatsApp = (phone: string) => {
    const cleanPhone = normalizePhone(phone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
  };

  const resetAddState = () => {
    setMode('list');
    setSearchTerm('');
    setSelectedTarget(null);
    setSelectedType('');
  };

  const handleClose = () => {
    resetAddState();
    onClose();
  };

  return (
    <ModalOverlay visible={visible} onClose={handleClose} animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>
                {t('relationships.title')}
              </Text>
              <Text style={styles.headerSubtitle}>
                {(client.name || '').toUpperCase()}
              </Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {mode === 'list' ? (
              <>
                {/* Linked clients list */}
                {linkedClients.length > 0 ? (
                  linkedClients.map(({ client: rel, type }) => (
                    <View key={rel.id} style={styles.relCard}>
                      <View style={styles.relInfo}>
                        <Text style={styles.relName}>{rel.name}</Text>
                        <Text style={styles.relType}>
                          {t(`relationships.${type}`, { defaultValue: type })}
                        </Text>
                      </View>
                      <View style={styles.relActions}>
                        {rel.phone ? (
                          <>
                            <TouchableOpacity
                              onPress={() => callClient(rel.phone)}
                              style={styles.actionIconBtn}
                            >
                              <Ionicons name="call" size={18} color={colors.primary} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => openWhatsApp(rel.phone)}
                              style={styles.actionIconBtn}
                            >
                              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                            </TouchableOpacity>
                          </>
                        ) : null}
                        <TouchableOpacity
                          onPress={() => handleRemove(rel)}
                          style={styles.actionIconBtn}
                        >
                          <Ionicons name="close-circle" size={18} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={{ fontSize: 40, marginBottom: 8 }}>👥</Text>
                    <Text style={styles.emptyText}>{t('relationships.noRelationships')}</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                {/* Step 1: Search and select client */}
                {!selectedTarget ? (
                  <>
                    <TextInput
                      style={styles.searchInput}
                      value={searchTerm}
                      onChangeText={setSearchTerm}
                      placeholder={t('relationships.searchClient')}
                      placeholderTextColor={colors.textHint}
                      autoFocus
                    />
                    {searchResults.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.searchResultItem}
                        onPress={() => setSelectedTarget(c)}
                      >
                        <Text style={styles.searchResultName}>{c.name}</Text>
                        {c.address ? (
                          <Text style={styles.searchResultAddress} numberOfLines={1}>
                            {c.address}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                    {searchTerm.trim().length > 0 && searchResults.length === 0 && (
                      <Text style={styles.noResults}>{t('home.noClients')}</Text>
                    )}
                  </>
                ) : (
                  <>
                    {/* Step 2: Select relationship type */}
                    <View style={styles.selectedClientBanner}>
                      <Text style={styles.selectedClientName}>{selectedTarget.name}</Text>
                      <TouchableOpacity onPress={() => setSelectedTarget(null)}>
                        <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.sectionLabel}>{t('relationships.selectType')}</Text>
                    <View style={styles.typeGrid}>
                      {RELATIONSHIP_TYPES.map((type) => (
                        <TouchableOpacity
                          key={type}
                          style={[
                            styles.typeChip,
                            selectedType === type && styles.typeChipSelected,
                          ]}
                          onPress={() => setSelectedType(type)}
                        >
                          <Text
                            style={[
                              styles.typeChipText,
                              selectedType === type && styles.typeChipTextSelected,
                            ]}
                          >
                            {t(`relationships.${type}`, { defaultValue: type })}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            {mode === 'list' ? (
              <TouchableOpacity
                onPress={() => setMode('add')}
                style={styles.addBtn}
              >
                <Ionicons name="add" size={18} color={colors.textWhite} />
                <Text style={styles.addBtnText}>{t('relationships.add')}</Text>
              </TouchableOpacity>
            ) : selectedTarget && selectedType ? (
              <TouchableOpacity
                onPress={handleAdd}
                style={[styles.confirmBtn, saving && { opacity: 0.5 }]}
                disabled={saving}
              >
                <Text style={styles.confirmBtnText}>{t('relationships.add')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={resetAddState}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>{t('cancel')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </ModalOverlay>
  );
};

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: isTablet ? 24 : 16,
    paddingVertical: isTablet ? 24 : 0,
  },
  modal: {
    backgroundColor: colors.modalBackground,
    borderRadius: 20,
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '80%',
    maxWidth: isTablet ? undefined : 500,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: {
    padding: 16,
  },
  relCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  relInfo: {
    flex: 1,
  },
  relName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  relType: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  relActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textHint,
  },
  searchInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: 12,
  },
  searchResultItem: {
    backgroundColor: colors.sectionBackground,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  searchResultAddress: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  noResults: {
    textAlign: 'center',
    color: colors.textHint,
    marginTop: 16,
    fontSize: 15,
  },
  selectedClientBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  selectedClientName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 10,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.sectionBackground,
  },
  typeChipSelected: {
    backgroundColor: colors.primary,
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  typeChipTextSelected: {
    color: colors.textWhite,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  addBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  addBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 16,
  },
  confirmBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: 16,
  },
  cancelBtn: {
    backgroundColor: colors.sectionBackground,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 16,
  },
});

export default RelationshipsModal;
