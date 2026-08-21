import React, { useState, useMemo, useRef } from 'react';
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
  Switch,
  useWindowDimensions,
} from 'react-native';
import ModalOverlay from './ModalOverlay';
import { Client, RELATIONSHIP_TYPES } from '../types';
import { normalizePhone, fuzzyMatch, matchScore, getModalWidth } from '../utils/helpers';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { getDaysSince, getEffectiveLastActivityDate, sharesHouseholdWith } from '../utils/recency';

interface RelationshipsModalProps {
  visible: boolean;
  client: Client | null;
  allClients: Client[];
  onClose: () => void;
  onAddRelationship: (
    clientId: string,
    targetId: string,
    type: string,
    sameHousehold: boolean,
  ) => Promise<void>;
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
  const { fontScale } = useLayout();
  const isTablet = windowWidth >= 600;
  const modalWidth = getModalWidth(windowWidth);
  const styles = getStyles(colors, isTablet, modalWidth, fontScale);
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<Client | null>(null);
  const [selectedType, setSelectedType] = useState('');
  const [sameHousehold, setSameHousehold] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const relationships = client?.relationships || {};
  const relatedIds = Object.keys(relationships);
  const clientsById = useMemo(
    () => new Map(allClients.map((candidate) => [candidate.id, candidate])),
    [allClients],
  );

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
    if (!selectedTarget || !selectedType || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onAddRelationship(client.id, selectedTarget.id, selectedType, sameHousehold);
      resetAddState();
    } catch {
      Alert.alert(t('error'), t('relationships.saveError'));
    } finally {
      savingRef.current = false;
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
            if (savingRef.current) return;
            savingRef.current = true;
            setSaving(true);
            try {
              await onRemoveRelationship(client.id, relatedClient.id);
            } catch {
              Alert.alert(t('error'), t('relationships.removeError'));
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const callClient = (phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorCall'));
    });
  };

  const openWhatsApp = (phone: string) => {
    const cleanPhone = normalizePhone(phone);
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`).catch(() => {
      Alert.alert(t('error'), t('directory.errorWhatsApp'));
    });
  };

  const resetAddState = () => {
    setMode('list');
    setSearchTerm('');
    setSelectedTarget(null);
    setSelectedType('');
    setSameHousehold(false);
    setEditingTargetId(null);
  };

  const selectNewTarget = (target: Client) => {
    setSelectedTarget(target);
    const currentAddress = (client.address || '').trim().toLocaleLowerCase();
    const targetAddress = (target.address || '').trim().toLocaleLowerCase();
    setSameHousehold(!!currentAddress && currentAddress === targetAddress);
  };

  const startEdit = (target: Client, type: string) => {
    setMode('add');
    setEditingTargetId(target.id);
    setSelectedTarget(target);
    setSelectedType(type);
    setSameHousehold(sharesHouseholdWith(client, target.id));
  };

  const visitLabel = (target: Client): string => {
    const days = getDaysSince(getEffectiveLastActivityDate(target, clientsById));
    if (days === null) return t('directory.noHistory');
    if (days === 0) return t('directory.today');
    return t('directory.daysAgo', { count: days });
  };

  const handleClose = () => {
    if (savingRef.current) return;
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
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} disabled={saving}>
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
                        <Text style={styles.relMeta}>
                          {sharesHouseholdWith(client, rel.id)
                            ? t('relationships.sameHousehold')
                            : t('relationships.differentHousehold')}
                          {' · '}{t('relationships.lastVisit', { date: visitLabel(rel) })}
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
                          onPress={() => startEdit(rel, type)}
                          style={styles.actionIconBtn}
                          disabled={saving}
                        >
                          <Ionicons name="pencil" size={17} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleRemove(rel)}
                          style={styles.actionIconBtn}
                          disabled={saving}
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
                        onPress={() => selectNewTarget(c)}
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
                      {!editingTargetId && (
                        <TouchableOpacity onPress={() => setSelectedTarget(null)}>
                          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
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
                    <View style={styles.householdRow}>
                      <View style={styles.householdTextWrap}>
                        <Text style={styles.householdTitle}>{t('relationships.sameHouseholdQuestion')}</Text>
                        <Text style={styles.householdHint}>{t('relationships.sameHouseholdHint')}</Text>
                      </View>
                      <Switch
                        value={sameHousehold}
                        onValueChange={setSameHousehold}
                        disabled={saving}
                        trackColor={{ false: colors.cardBorder, true: colors.primaryLight }}
                        thumbColor={sameHousehold ? colors.primary : colors.textMuted}
                      />
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
                disabled={saving}
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
                <Text style={styles.confirmBtnText}>
                  {editingTargetId ? t('relationships.saveChanges') : t('relationships.add')}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={resetAddState}
                style={styles.cancelBtn}
                disabled={saving}
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

const getStyles = (colors: ThemeColors, isTablet: boolean, modalWidth?: number, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: isTablet ? 24 : 16,
    paddingVertical: isTablet ? 24 : 0,
  },
  modal: {
    backgroundColor: colors.modalBackground,
    borderRadius: s(20),
    maxHeight: Platform.OS === 'android' ? '100%' : isTablet ? '90%' : '80%',
    maxWidth: isTablet ? undefined : 500,
    alignSelf: 'center' as const,
    width: isTablet ? modalWidth : ('100%' as const),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: s(16),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: s(2),
  },
  closeBtn: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    backgroundColor: colors.sectionBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: {
    padding: s(16),
  },
  relCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.sectionBackground,
    borderRadius: s(12),
    padding: s(12),
    marginBottom: s(8),
  },
  relInfo: {
    flex: 1,
  },
  relName: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  relType: {
    fontSize: s(13),
    color: colors.primary,
    fontWeight: '600',
    marginTop: s(2),
  },
  relMeta: {
    fontSize: s(11),
    color: colors.textMuted,
    marginTop: s(3),
  },
  relActions: {
    flexDirection: 'row',
    gap: s(4),
  },
  actionIconBtn: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: s(32),
  },
  emptyText: {
    fontSize: s(16),
    color: colors.textHint,
  },
  searchInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: s(10),
    padding: s(12),
    fontSize: s(16),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    marginBottom: s(12),
  },
  searchResultItem: {
    backgroundColor: colors.sectionBackground,
    borderRadius: s(10),
    padding: s(12),
    marginBottom: s(6),
  },
  searchResultName: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.textPrimary,
  },
  searchResultAddress: {
    fontSize: s(13),
    color: colors.textSecondary,
    marginTop: s(2),
  },
  noResults: {
    textAlign: 'center',
    color: colors.textHint,
    marginTop: s(16),
    fontSize: s(15),
  },
  selectedClientBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: s(10),
    padding: s(12),
    marginBottom: s(16),
  },
  selectedClientName: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.primary,
  },
  sectionLabel: {
    fontSize: s(15),
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: s(10),
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  householdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    backgroundColor: colors.sectionBackground,
    borderRadius: s(12),
    padding: s(12),
    marginTop: s(18),
  },
  householdTextWrap: {
    flex: 1,
  },
  householdTitle: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  householdHint: {
    fontSize: s(11),
    color: colors.textMuted,
    marginTop: s(3),
    lineHeight: s(15),
  },
  typeChip: {
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: s(20),
    backgroundColor: colors.sectionBackground,
  },
  typeChipSelected: {
    backgroundColor: colors.primary,
  },
  typeChipText: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.textSecondary,
  },
  typeChipTextSelected: {
    color: colors.textWhite,
  },
  footer: {
    padding: s(16),
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  addBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    paddingVertical: s(12),
    borderRadius: s(10),
  },
  addBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  confirmBtn: {
    backgroundColor: colors.primary,
    paddingVertical: s(12),
    borderRadius: s(10),
    alignItems: 'center',
  },
  confirmBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(16),
  },
  cancelBtn: {
    backgroundColor: colors.sectionBackground,
    paddingVertical: s(12),
    borderRadius: s(10),
    alignItems: 'center',
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: s(16),
  },
  });
};

export default RelationshipsModal;
