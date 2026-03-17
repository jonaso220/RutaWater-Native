import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Share,
  Linking,
  Platform,
} from 'react-native';
import RNFS from 'react-native-fs';
import { db } from '../config/firebase';
import { useAuthContext } from '../context/AuthContext';
import { useClientsContext } from '../context/ClientsContext';
import { useDebtsContext } from '../context/DebtsContext';
import { useTransfersContext } from '../context/TransfersContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';
import { useLayout } from '../hooks/useLayout';
import { PRODUCTS, FREQUENCY_LABELS, Frequency } from '../constants/products';
import { FREE_CLIENT_LIMIT } from '../constants/subscription';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { fontScale } = useLayout();
  const styles = getStyles(colors, fontScale);
  const { user: firebaseUser, groupData, isAdmin, signOut, deleteAccount, setGroupData } = useAuthContext();
  const { clients, clientCount, findDuplicateClients, cleanupDuplicates } = useClientsContext();
  const { isPremium, currentPlan, expirationDate, isTrialActive, hasPromo, redeemCode, removePromo } = useSubscriptionContext();
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const { debts } = useDebtsContext();
  const { transfers } = useTransfersContext();
  if (!firebaseUser) return null;
  const user = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
  };
  const onSignOut = signOut;
  const onGroupUpdate = setGroupData;
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  // WhatsApp templates
  const DEFAULT_EN_CAMINO = 'Buenas 🚚. Ya estamos en camino, sos el/la siguiente en la lista de entrega. ¡Nos vemos en unos minutos!\n\nAquapura';
  const DEFAULT_DEUDA = 'La deuda es de ${total}. Saludos';
  const DEFAULT_RECORDATORIO = 'Hola, buenas \nEste es un mensaje automatico para informarle que, segun nuestros registros, quedo pendiente un saldo por regularizar.\nCuando pueda, le agradecemos que nos indique en que fecha podriamos saldarlo. Si necesita nuevamente los datos de la cuenta, con gusto se los enviamos.\nMuchas gracias.';
  const [waEnCamino, setWaEnCamino] = useState('');
  const [waDeuda, setWaDeuda] = useState('');
  const [waRecordatorio, setWaRecordatorio] = useState('');
  const [waLoaded, setWaLoaded] = useState(false);

  // Load WhatsApp templates from settings
  useEffect(() => {
    if (!user.uid) return;
    const settingsDocId = groupData?.groupId || user.uid;
    db.collection('settings').doc(settingsDocId).get().then((doc) => {
      if (doc.exists) {
        const data = doc.data();
        if (data?.whatsappEnCamino) setWaEnCamino(data.whatsappEnCamino);
        if (data?.whatsappDeuda) setWaDeuda(data.whatsappDeuda);
        if (data?.whatsappRecordatorio) setWaRecordatorio(data.whatsappRecordatorio);
      }
      setWaLoaded(true);
    }).catch(() => setWaLoaded(true));
  }, [user.uid, groupData?.groupId]);

  const handleSaveTemplates = async () => {
    try {
      const settingsDocId = groupData?.groupId || user.uid;
      const settings: Record<string, string> = {};
      if (waEnCamino.trim()) settings.whatsappEnCamino = waEnCamino.trim();
      if (waDeuda.trim()) settings.whatsappDeuda = waDeuda.trim();
      if (waRecordatorio.trim()) settings.whatsappRecordatorio = waRecordatorio.trim();
      await db.collection('settings').doc(settingsDocId).set(settings, { merge: true });
      Alert.alert(t('settings.templatesSaved'), t('settings.templatesSavedMsg'));
    } catch (e) {
      console.error('Error saving templates:', e);
      Alert.alert(t('error'), t('settings.templatesSaveError'));
    }
  };

  const handleResetTemplates = () => {
    setWaEnCamino('');
    setWaDeuda('');
    setWaRecordatorio('');
    const settingsDocId = groupData?.groupId || user.uid;
    db.collection('settings').doc(settingsDocId).set(
      { whatsappEnCamino: null, whatsappDeuda: null, whatsappRecordatorio: null },
      { merge: true },
    ).catch((e) => console.error('Error resetting templates:', e));
    Alert.alert(t('settings.templatesReset'), t('settings.templatesResetMsg'));
  };

  // Load group members
  useEffect(() => {
    if (!groupData?.groupId) {
      setMembers([]);
      return;
    }
    const unsubscribe = db
      .collection('users')
      .where('groupId', '==', groupData.groupId)
      .onSnapshot((snapshot) => {
        const loaded = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setMembers(loaded);
      });
    return () => unsubscribe();
  }, [groupData?.groupId]);

  const generateCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleCreateGroup = async () => {
    setLoading(true);
    try {
      const groupId = `group_${user.uid}_${Date.now()}`;
      const code = generateCode();

      await db
        .collection('groups')
        .doc(groupId)
        .set({
          code,
          adminId: user.uid,
          adminEmail: user.email,
          adminName: user.displayName,
          createdAt: new Date(),
        });

      await db.collection('users').doc(user.uid).update({
        groupId,
        role: 'admin',
      });

      // Migrate existing data
      const clientsSnap = await db
        .collection('clients')
        .where('userId', '==', user.uid)
        .get();
      const batch = db.batch();
      let count = 0;
      for (const doc of clientsSnap.docs) {
        batch.update(doc.ref, { groupId });
        count++;
        if (count >= 450) break;
      }

      const debtsSnap = await db
        .collection('debts')
        .where('userId', '==', user.uid)
        .get();
      for (const doc of debtsSnap.docs) {
        if (count >= 450) break;
        batch.update(doc.ref, { groupId });
        count++;
      }

      const transfersSnap = await db
        .collection('transfers')
        .where('userId', '==', user.uid)
        .get();
      for (const doc of transfersSnap.docs) {
        if (count >= 450) break;
        batch.update(doc.ref, { groupId });
        count++;
      }

      await batch.commit();

      onGroupUpdate({ groupId, role: 'admin', code });
    } catch (e) {
      console.error('Error creating group:', e);
      Alert.alert(t('error'), t('settings.createGroupError'));
    }
    setLoading(false);
  };

  const handleJoinGroup = async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    try {
      const snap = await db
        .collection('groups')
        .where('code', '==', joinCode.trim().toUpperCase())
        .get();

      if (snap.empty) {
        Alert.alert(t('error'), t('settings.joinError'));
        setLoading(false);
        return;
      }

      const groupDoc = snap.docs[0];
      const groupId = groupDoc.id;

      await db.collection('users').doc(user.uid).update({
        groupId,
        role: 'member',
      });

      onGroupUpdate({
        groupId,
        role: 'member',
        code: groupDoc.data().code,
      });
      setJoinCode('');
    } catch (e) {
      console.error('Error joining group:', e);
      Alert.alert(t('error'), t('settings.joinGroupError'));
    }
    setLoading(false);
  };

  const handleLeaveGroup = () => {
    Alert.alert(t('settings.leaveGroupTitle'), t('settings.leaveGroupMsg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settings.leave'),
        style: 'destructive',
        onPress: async () => {
          try {
            await db
              .collection('users')
              .doc(user.uid)
              .update({ groupId: null, role: null });
            onGroupUpdate(null);
          } catch (e) {
            Alert.alert(t('error'), t('settings.leaveError'));
          }
        },
      },
    ]);
  };

  const handleRemoveMember = (memberId: string, memberName: string) => {
    Alert.alert(
      t('settings.removeMemberTitle'),
      t('settings.removeMemberMsg', { name: memberName }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('settings.removeMember'),
          style: 'destructive',
          onPress: async () => {
            try {
              await db
                .collection('users')
                .doc(memberId)
                .update({ groupId: null, role: null });
            } catch (e) {
              Alert.alert(t('error'), t('settings.removeMemberError'));
            }
          },
        },
      ],
    );
  };

  const handleDissolveGroup = () => {
    Alert.alert(
      t('settings.dissolveTitle'),
      t('settings.dissolveMsg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('settings.dissolve'),
          style: 'destructive',
          onPress: async () => {
            if (!groupData?.groupId) return;
            setLoading(true);
            try {
              const gid = groupData.groupId;

              // Collect all docs to update
              const updates: { ref: any; data: any }[] = [];

              const membersSnap = await db.collection('users').where('groupId', '==', gid).get();
              membersSnap.docs.forEach((doc) => updates.push({ ref: doc.ref, data: { groupId: null, role: null } }));

              const clientsSnap = await db.collection('clients').where('groupId', '==', gid).get();
              clientsSnap.docs.forEach((doc) => updates.push({ ref: doc.ref, data: { groupId: null } }));

              const debtsSnap = await db.collection('debts').where('groupId', '==', gid).get();
              debtsSnap.docs.forEach((doc) => updates.push({ ref: doc.ref, data: { groupId: null } }));

              const transfersSnap = await db.collection('transfers').where('groupId', '==', gid).get();
              transfersSnap.docs.forEach((doc) => updates.push({ ref: doc.ref, data: { groupId: null } }));

              // Execute in batches of 450
              for (let i = 0; i < updates.length; i += 450) {
                const batch = db.batch();
                updates.slice(i, i + 450).forEach(({ ref, data }) => batch.update(ref, data));
                await batch.commit();
              }

              // Delete group doc
              await db.collection('groups').doc(gid).delete();

              onGroupUpdate(null);
            } catch (e) {
              Alert.alert(t('error'), t('settings.dissolveError'));
            }
            setLoading(false);
          },
        },
      ],
    );
  };

  // --- EXPORT ---
  const escapeCsv = (val: string | number | boolean | undefined | null): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const shareFile = async (content: string, filename: string) => {
    const dir = Platform.OS === 'ios' ? RNFS.TemporaryDirectoryPath : RNFS.CachesDirectoryPath;
    const filePath = `${dir}/${filename}`;
    await RNFS.writeFile(filePath, content, 'utf8');
    const fileUrl = Platform.OS === 'ios' ? filePath : `file://${filePath}`;
    await Share.share(
      Platform.OS === 'ios'
        ? { url: fileUrl }
        : { title: filename, message: content },
    );
  };

  const handleExportCSV = async () => {
    try {
      const allClients = clients.filter((c) => c.name);
      if (allClients.length === 0) {
        Alert.alert(t('settings.noDataCSV'), t('settings.noClientsToExport'));
        return;
      }

      const headers = ['Nombre', 'Teléfono', 'Dirección', 'Día', 'Frecuencia', 'Productos', 'Notas', 'Tiene Deuda', 'Favorito', 'Link Maps'];

      const rows = allClients.map((c) => {
        // Build product summary with labels (matching webapp)
        const prodParts: string[] = [];
        if (c.products) {
          PRODUCTS.forEach((p) => {
            const qty = parseInt(String(c.products[p.id] || 0), 10);
            if (qty > 0) prodParts.push(`${p.label}: ${qty}`);
          });
        }

        return [
          escapeCsv(c.name),
          escapeCsv(c.phone),
          escapeCsv(c.address),
          escapeCsv(c.visitDay || (c.visitDays || []).join(', ')),
          escapeCsv(FREQUENCY_LABELS[c.freq as Frequency] || c.freq || ''),
          escapeCsv(prodParts.join(', ')),
          escapeCsv(c.notes || ''),
          c.hasDebt ? 'Sí' : 'No',
          c.isStarred ? 'Sí' : 'No',
          escapeCsv(c.mapsLink || ''),
        ].join(',');
      });

      // BOM for Excel/Sheets UTF-8 recognition
      const bom = '\uFEFF';
      const csvContent = bom + headers.map(escapeCsv).join(',') + '\n' + rows.join('\n');

      const date = new Date().toISOString().split('T')[0];
      await shareFile(csvContent, `RutaWater_Clientes_${date}.csv`);

      Alert.alert(t('settings.csvExported', { count: allClients.length }), '');
    } catch (e) {
      console.error('Error exporting CSV:', e);
      Alert.alert(t('error'), t('settings.exportError'));
    }
  };

  const handleExportJSON = async () => {
    try {
      const allClients = clients.filter((c) => c.name);
      if (allClients.length === 0 && debts.length === 0 && transfers.length === 0) {
        Alert.alert(t('settings.noDataCSV'), t('settings.noDataToExport'));
        return;
      }

      const backup = {
        exportDate: new Date().toISOString().split('T')[0],
        exportedBy: user.email || user.uid,
        clients: allClients.map((c) => ({
          id: c.id, name: c.name, phone: c.phone || '', address: c.address || '',
          lat: c.lat || '', lng: c.lng || '', freq: c.freq || '',
          visitDay: c.visitDay || '', visitDays: c.visitDays || [],
          specificDate: c.specificDate || '', notes: c.notes || '',
          products: c.products || {}, isStarred: c.isStarred || false,
          alarm: c.alarm || '', mapsLink: c.mapsLink || '', isNote: c.isNote || false,
          hasDebt: c.hasDebt || false,
        })),
        debts: debts.map((d) => ({
          id: d.id, clientId: d.clientId, clientName: d.clientName || '',
          clientAddress: (d as any).clientAddress || '', amount: d.amount || 0,
          createdAt: (d.createdAt as any)?.seconds
            ? new Date((d.createdAt as any).seconds * 1000).toISOString()
            : '',
        })),
        transfers: transfers.map((t) => ({
          id: t.id, clientId: t.clientId, clientName: t.clientName || '',
          clientAddress: (t as any).clientAddress || '',
          createdAt: (t.createdAt as any)?.seconds
            ? new Date((t.createdAt as any).seconds * 1000).toISOString()
            : '',
        })),
      };

      const jsonContent = JSON.stringify(backup, null, 2);
      const date = new Date().toISOString().split('T')[0];
      await shareFile(jsonContent, `RutaWater_Backup_${date}.json`);

      const counts: string[] = [];
      if (backup.clients.length > 0) counts.push(t('settings.backupClients', { count: backup.clients.length }));
      if (backup.debts.length > 0) counts.push(t('settings.backupDebts', { count: backup.debts.length }));
      if (backup.transfers.length > 0) counts.push(t('settings.backupTransfers', { count: backup.transfers.length }));
      Alert.alert(t('settings.backupReady'), counts.join(', '));
    } catch (e) {
      console.error('Error exporting JSON:', e);
      Alert.alert(t('error'), t('settings.exportError'));
    }
  };

  const handleCleanupDuplicates = () => {
    const { staleIds } = findDuplicateClients();
    if (staleIds.length === 0) {
      Alert.alert(t('settings.noDuplicatesTitle'), t('settings.noDuplicates'));
      return;
    }
    Alert.alert(
      t('settings.duplicatesFoundTitle'),
      t('settings.duplicatesFoundMsg', { count: staleIds.length }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('settings.cleanDuplicatesAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              const count = await cleanupDuplicates();
              Alert.alert(t('done'), t('settings.duplicatesCleaned', { count }));
            } catch (e) {
              console.error('Error cleaning duplicates:', e);
              Alert.alert(t('error'), t('settings.duplicatesCleanError'));
            }
          },
        },
      ],
    );
  };

  const handleRedeemPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    try {
      const result = await redeemCode(promoCode);
      Alert.alert(result.success ? t('settings.promoSuccess') : t('error'), result.message);
      if (result.success) setPromoCode('');
    } catch {
      Alert.alert(t('error'), t('settings.promoRedeemError'));
    }
    setPromoLoading(false);
  };

  const handleRemovePromo = () => {
    Alert.alert(t('settings.removePromoTitle'), t('settings.removePromoMsg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settings.removeMember'),
        style: 'destructive',
        onPress: async () => {
          await removePromo();
          Alert.alert(t('done'), t('settings.premiumDeactivated'));
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('settings.deleteAccount'),
      t('settings.deleteAccountMsg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('settings.deleteAccount'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('settings.confirmDeleteTitle'),
              t('settings.confirmDeleteMsg'),
              [
                { text: t('settings.noCancel'), style: 'cancel' },
                {
                  text: t('settings.yesDelete'),
                  style: 'destructive',
                  onPress: async () => {
                    setLoading(true);
                    try {
                      await deleteAccount();
                    } catch (e: any) {
                      if (e.message === 'REQUIRES_RECENT_LOGIN') {
                        Alert.alert(
                          t('settings.sessionExpired'),
                          t('settings.sessionExpiredMsg'),
                        );
                      } else {
                        Alert.alert(t('error'), t('settings.deleteAccountError'));
                      }
                    }
                    setLoading(false);
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* User info */}
      <View style={styles.section}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user.displayName || user.email || '?')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user.displayName}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            {groupData && (
              <Text style={styles.roleBadge}>
                {groupData.role === 'admin' ? t('settings.admin') : t('settings.member')}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Subscription status */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="diamond-outline" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>{t('settings.subscription')}</Text>
        </View>
        {isPremium ? (
          <View style={styles.premiumCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="diamond" size={20} color={colors.primary} />
              <Text style={styles.premiumLabel}>{t('settings.premiumLabel')}</Text>
              {isTrialActive && (
                <View style={styles.trialTag}>
                  <Text style={styles.trialTagText}>{t('settings.trialLabel')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.premiumPlan}>
              {t('settings.plan')} {currentPlan === 'annual' ? t('settings.annual') : t('settings.monthly')}
            </Text>
            {expirationDate && (
              <Text style={styles.premiumExpiry}>
                {t('settings.renews')}: {new Date(expirationDate).toLocaleDateString()}
              </Text>
            )}
            <TouchableOpacity
              onPress={() => {
                Linking.openURL(
                  Platform.OS === 'ios'
                    ? 'https://apps.apple.com/account/subscriptions'
                    : 'https://play.google.com/store/account/subscriptions',
                );
              }}
              style={styles.manageBtn}
            >
              <Text style={styles.manageBtnText}>{t('settings.manageSub')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.freeCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.freePlanLabel}>{t('settings.freePlan')}</Text>
              <Text style={styles.freeCount}>{t('settings.clientsUsed', { count: clientCount, limit: FREE_CLIENT_LIMIT })}</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${Math.min(100, (clientCount / FREE_CLIENT_LIMIT) * 100)}%` }]} />
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate('Paywall')}
              style={styles.upgradeBtn}
            >
              <Ionicons name="diamond" size={18} color="#FFFFFF" />
              <Text style={styles.upgradeBtnText}>{t('settings.getPremium')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Promo code section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="gift-outline" size={20} color={colors.warningDark} />
          <Text style={styles.sectionTitle}>{t('settings.promoCode')}</Text>
        </View>
        {hasPromo ? (
          <View style={styles.premiumCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="gift" size={20} color={colors.primary} />
              <Text style={styles.premiumLabel}>{t('settings.premiumActivated')}</Text>
            </View>
            <Text style={styles.premiumPlan}>{t('settings.activatedWithCode')}</Text>
            <TouchableOpacity onPress={handleRemovePromo} style={styles.manageBtn}>
              <Text style={[styles.manageBtnText, { color: colors.danger }]}>{t('settings.deactivate')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.joinRow}>
            <TextInput
              style={styles.joinInput}
              value={promoCode}
              onChangeText={setPromoCode}
              placeholder={t('settings.promoPlaceholder')}
              placeholderTextColor={colors.textHint}
              autoCapitalize="characters"
              maxLength={20}
            />
            <TouchableOpacity
              onPress={handleRedeemPromo}
              style={[styles.joinBtn, (!promoCode.trim() || promoLoading) && styles.joinBtnDisabled]}
              disabled={!promoCode.trim() || promoLoading}
            >
              {promoLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.joinBtnText}>{t('settings.redeem')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Group section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="people-outline" size={20} color={colors.textMuted} />
          <Text style={styles.sectionTitle}>{t('settings.familyGroup')}</Text>
        </View>

        {groupData ? (
          <View>
            {/* Group code */}
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>{t('settings.groupCode')}</Text>
              <Text style={styles.codeValue}>{groupData.code}</Text>
              <Text style={styles.codeHint}>
                {t('settings.shareCodeHint')}
              </Text>
            </View>

            {/* Members */}
            <Text style={styles.subsectionTitle}>
              {t('settings.members')} ({members.length})
            </Text>
            {members.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>
                    {member.displayName || member.email}
                  </Text>
                  <Text style={styles.memberRole}>
                    {member.role === 'admin' ? t('settings.admin') : t('settings.member')}
                  </Text>
                </View>
                {isAdmin && member.id !== user.uid && (
                  <TouchableOpacity
                    onPress={() =>
                      handleRemoveMember(
                        member.id,
                        member.displayName || member.email,
                      )
                    }
                    style={styles.removeBtn}
                  >
                    <Text style={styles.removeBtnText}>{t('settings.removeMember')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {/* Group actions */}
            <View style={styles.groupActions}>
              {!isAdmin && (
                <TouchableOpacity
                  onPress={handleLeaveGroup}
                  style={styles.dangerBtn}
                >
                  <Text style={styles.dangerBtnText}>{t('settings.leaveGroup')}</Text>
                </TouchableOpacity>
              )}
              {isAdmin && (
                <TouchableOpacity
                  onPress={handleDissolveGroup}
                  style={styles.dangerBtn}
                >
                  <Text style={styles.dangerBtnText}>{t('settings.dissolveGroup')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : isPremium ? (
          <View>
            <Text style={styles.noGroupText}>
              {t('settings.noGroupText')}
            </Text>

            <TouchableOpacity
              onPress={handleCreateGroup}
              style={styles.primaryBtn}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('settings.createGroup')}</Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('settings.or')}</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.joinRow}>
              <TextInput
                style={styles.joinInput}
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder={t('settings.joinPlaceholder')}
                placeholderTextColor={colors.textHint}
                autoCapitalize="characters"
                maxLength={6}
              />
              <TouchableOpacity
                onPress={handleJoinGroup}
                style={[styles.joinBtn, !joinCode && styles.joinBtnDisabled]}
                disabled={!joinCode || loading}
              >
                <Text style={styles.joinBtnText}>{t('settings.joinGroup')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <View style={styles.lockedCard}>
              <Ionicons name="lock-closed" size={24} color={colors.textHint} />
              <Text style={styles.lockedText}>
                {t('settings.groupsPremiumMsg')}
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Paywall')}
                style={styles.upgradeBtn}
              >
                <Ionicons name="diamond" size={16} color="#FFFFFF" />
                <Text style={styles.upgradeBtnText}>{t('settings.getPremium')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* WhatsApp Templates */}
      {waLoaded && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="logo-whatsapp" size={20} color={colors.successDark} />
            <Text style={styles.sectionTitle}>{t('settings.whatsappMessages')}</Text>
          </View>
          <Text style={styles.sectionSubtitle}>{t('settings.whatsappSubtitle')}</Text>
          <View style={styles.sectionCard}>
            <Text style={styles.templateLabel}>{t('settings.enCaminoLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waEnCamino}
              onChangeText={setWaEnCamino}
              placeholder={DEFAULT_EN_CAMINO}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={3}
            />

            <View style={styles.templateDivider} />

            <Text style={styles.templateLabel}>{t('settings.debtLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waDeuda}
              onChangeText={setWaDeuda}
              placeholder={DEFAULT_DEUDA}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={2}
            />
            <Text style={styles.templateHint}>{t('settings.debtHint')}</Text>

            <View style={styles.templateDivider} />

            <Text style={styles.templateLabel}>{t('settings.reminderLabel')}</Text>
            <TextInput
              style={styles.templateInput}
              value={waRecordatorio}
              onChangeText={setWaRecordatorio}
              placeholder={DEFAULT_RECORDATORIO}
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={4}
            />
          </View>
          <View style={styles.templateActions}>
            <TouchableOpacity onPress={handleSaveTemplates} style={styles.templateSaveBtn}>
              <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              <Text style={styles.templateSaveBtnText}>{t('settings.saveTemplates')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleResetTemplates} style={styles.templateResetBtn}>
              <Ionicons name="refresh" size={16} color={colors.textMuted} />
              <Text style={styles.templateResetBtnText}>{t('settings.resetTemplates')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Export & Maintenance */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="construct" size={20} color={colors.textMuted} />
          <Text style={styles.sectionTitle}>{t('settings.tools')}</Text>
        </View>
        <View style={styles.sectionCard}>
          {/* Export */}
          <Text style={styles.cardGroupTitle}>{t('settings.exportDataTitle')}</Text>
          {isPremium ? (
            <View style={styles.cardGroupContent}>
              <TouchableOpacity onPress={handleExportCSV} style={styles.exportBtn}>
                <Ionicons name="share-outline" size={18} color={colors.primary} />
                <Text style={styles.exportBtnText}>{t('settings.exportCSV')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleExportJSON} style={styles.exportBtn}>
                <Ionicons name="save-outline" size={18} color={colors.primary} />
                <Text style={styles.exportBtnText}>{t('settings.exportJSON')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.lockedCard}>
              <Ionicons name="lock-closed" size={24} color={colors.textHint} />
              <Text style={styles.lockedText}>
                {t('settings.exportPremiumMsg')}
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Paywall')}
                style={styles.upgradeBtn}
              >
                <Ionicons name="diamond" size={16} color="#FFFFFF" />
                <Text style={styles.upgradeBtnText}>{t('settings.getPremium')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.templateDivider} />

          {/* Maintenance */}
          <Text style={styles.cardGroupTitle}>{t('settings.maintenance')}</Text>
          <TouchableOpacity onPress={handleCleanupDuplicates} style={styles.exportBtn}>
            <Ionicons name="copy-outline" size={18} color={colors.primary} />
            <Text style={styles.exportBtnText}>{t('settings.cleanDuplicates')}</Text>
          </TouchableOpacity>
          <Text style={styles.cardGroupHint}>
            {t('settings.cleanDuplicatesHint')}
          </Text>
        </View>
      </View>

      {/* Account actions */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="person-circle-outline" size={20} color={colors.textMuted} />
          <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
        </View>
        <View style={styles.sectionCard}>
          <TouchableOpacity onPress={onSignOut} style={styles.signOutBtn}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
          </TouchableOpacity>

          <View style={styles.templateDivider} />

          <TouchableOpacity
            onPress={handleDeleteAccount}
            style={styles.deleteAccountBtn}
            disabled={loading}
          >
            <Ionicons name="trash-outline" size={18} color={colors.textHint} />
            <Text style={styles.deleteAccountText}>{t('settings.deleteAccount')}</Text>
          </TouchableOpacity>
          <Text style={styles.deleteAccountHint}>
            {t('settings.deleteAccountHint')}
          </Text>
        </View>
      </View>

      <View style={{ height: 60 }} />
    </ScrollView>
  );
};

const getStyles = (colors: ThemeColors, scale: number = 1) => {
  const s = (v: number) => Math.round(v * scale);
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: s(13),
    color: colors.textHint,
    marginBottom: 12,
    marginLeft: 28,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardGroupTitle: {
    fontSize: s(14),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  cardGroupContent: {
    gap: 8,
  },
  cardGroupHint: {
    fontSize: s(12),
    color: colors.textHint,
    marginTop: 6,
  },
  subsectionTitle: {
    fontSize: s(15),
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: s(22),
    fontWeight: '700',
  },
  userName: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  userEmail: {
    fontSize: s(14),
    color: colors.textMuted,
    marginTop: 2,
  },
  roleBadge: {
    fontSize: s(13),
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    overflow: 'hidden',
  },
  codeCard: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  codeLabel: {
    fontSize: s(14),
    color: colors.textMuted,
    fontWeight: '600',
  },
  codeValue: {
    fontSize: s(32),
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 4,
    marginVertical: 8,
  },
  codeHint: {
    fontSize: s(13),
    color: colors.textHint,
    textAlign: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.sectionBackground,
  },
  memberName: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.textPrimary,
  },
  memberRole: {
    fontSize: s(13),
    color: colors.textMuted,
    marginTop: 2,
  },
  removeBtn: {
    backgroundColor: colors.dangerLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  removeBtnText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(14),
  },
  groupActions: {
    marginTop: 16,
  },
  dangerBtn: {
    backgroundColor: colors.dangerLight,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  dangerBtnText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(16),
  },
  noGroupText: {
    fontSize: s(16),
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: s(18),
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  dividerText: {
    color: colors.textHint,
    paddingHorizontal: 12,
    fontSize: s(15),
  },
  joinRow: {
    flexDirection: 'row',
    gap: 8,
  },
  joinInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: s(20),
    fontWeight: '700',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    letterSpacing: 3,
    textAlign: 'center',
  },
  joinBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: 20,
    borderRadius: 10,
    justifyContent: 'center',
  },
  joinBtnDisabled: { opacity: 0.5 },
  joinBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: s(16),
  },
  templateDivider: {
    height: 1,
    backgroundColor: colors.sectionBackground,
    marginVertical: 14,
  },
  templateLabel: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  templateInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    padding: 12,
    fontSize: s(15),
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    textAlignVertical: 'top',
    minHeight: 60,
  },
  templateHint: {
    fontSize: s(12),
    color: colors.textHint,
    marginTop: 4,
  },
  templateActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  templateSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateSaveBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(15),
  },
  templateResetBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.sectionBackground,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  templateResetBtnText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: s(15),
  },
  exportBtn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.primaryLighter,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  exportBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: s(15),
  },
  signOutBtn: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(16),
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteAccountText: {
    color: colors.textHint,
    fontWeight: '600',
    fontSize: s(14),
  },
  deleteAccountHint: {
    color: colors.textHint,
    fontSize: s(13),
    textAlign: 'center',
    marginTop: 4,
  },
  premiumCard: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  premiumLabel: {
    fontSize: s(18),
    fontWeight: '800',
    color: colors.primary,
  },
  premiumPlan: {
    fontSize: s(14),
    color: colors.textMuted,
    marginTop: 4,
  },
  premiumExpiry: {
    fontSize: s(13),
    color: colors.textHint,
    marginTop: 2,
  },
  trialTag: {
    backgroundColor: colors.successBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  trialTagText: {
    fontSize: s(11),
    fontWeight: '700',
    color: colors.successText,
  },
  manageBtn: {
    marginTop: 12,
    alignItems: 'center',
  },
  manageBtnText: {
    fontSize: s(14),
    color: colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  freeCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  freePlanLabel: {
    fontSize: s(16),
    fontWeight: '700',
    color: colors.textPrimary,
  },
  freeCount: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.textMuted,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.sectionBackground,
    borderRadius: 3,
    marginTop: 10,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  upgradeBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: s(16),
  },
  lockedCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 10,
  },
  lockedText: {
    fontSize: s(14),
    color: colors.textMuted,
    textAlign: 'center',
  },
});
};

export default SettingsScreen;
