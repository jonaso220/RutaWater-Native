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
import Ionicons from 'react-native-vector-icons/Ionicons';

const SettingsScreen = () => {
  const { colors, isDark } = useTheme();
  const { fontScale } = useLayout();
  const styles = getStyles(colors, fontScale);
  const { user: firebaseUser, groupData, isAdmin, signOut, deleteAccount, setGroupData } = useAuthContext();
  const { clients, findDuplicateClients, cleanupDuplicates } = useClientsContext();
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
      Alert.alert('Guardado', 'Templates actualizados');
    } catch (e) {
      console.error('Error saving templates:', e);
      Alert.alert('Error', 'No se pudieron guardar los templates');
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
    Alert.alert('Templates reseteados', 'Se usarán los mensajes por defecto');
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
      Alert.alert('Error', 'No se pudo crear el grupo.');
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
        Alert.alert('Error', 'Codigo no encontrado.');
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
      Alert.alert('Error', 'No se pudo unir al grupo.');
    }
    setLoading(false);
  };

  const handleLeaveGroup = () => {
    Alert.alert('Salir del grupo?', 'Tu datos se quedaran en el grupo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: async () => {
          try {
            await db
              .collection('users')
              .doc(user.uid)
              .update({ groupId: null, role: null });
            onGroupUpdate(null);
          } catch (e) {
            Alert.alert('Error', 'No se pudo salir del grupo.');
          }
        },
      },
    ]);
  };

  const handleRemoveMember = (memberId: string, memberName: string) => {
    Alert.alert(
      'Quitar miembro?',
      `Quitar a ${memberName} del grupo?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: async () => {
            try {
              await db
                .collection('users')
                .doc(memberId)
                .update({ groupId: null, role: null });
            } catch (e) {
              Alert.alert('Error', 'No se pudo quitar al miembro.');
            }
          },
        },
      ],
    );
  };

  const handleDissolveGroup = () => {
    Alert.alert(
      'Disolver grupo?',
      'Se eliminara el grupo y todos los miembros seran removidos. Los datos se mantienen.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Disolver',
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
              Alert.alert('Error', 'No se pudo disolver el grupo.');
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
        Alert.alert('Sin datos', 'No hay clientes para exportar.');
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

      Alert.alert('Exportado', `${allClients.length} clientes exportados a CSV`);
    } catch (e) {
      console.error('Error exporting CSV:', e);
      Alert.alert('Error', 'No se pudo exportar. Intenta de nuevo.');
    }
  };

  const handleExportJSON = async () => {
    try {
      const allClients = clients.filter((c) => c.name);
      if (allClients.length === 0 && debts.length === 0 && transfers.length === 0) {
        Alert.alert('Sin datos', 'No hay datos para exportar.');
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
      if (backup.clients.length > 0) counts.push(`${backup.clients.length} clientes`);
      if (backup.debts.length > 0) counts.push(`${backup.debts.length} deudas`);
      if (backup.transfers.length > 0) counts.push(`${backup.transfers.length} transf.`);
      Alert.alert('Backup listo', counts.join(', '));
    } catch (e) {
      console.error('Error exporting JSON:', e);
      Alert.alert('Error', 'No se pudo exportar. Intenta de nuevo.');
    }
  };

  const handleCleanupDuplicates = () => {
    const { staleIds } = findDuplicateClients();
    if (staleIds.length === 0) {
      Alert.alert('Sin duplicados', 'No se encontraron duplicados.');
      return;
    }
    Alert.alert(
      'Limpiar duplicados',
      `Se encontraron ${staleIds.length} clientes duplicados. ¿Eliminar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              const count = await cleanupDuplicates();
              Alert.alert('Listo', `Se eliminaron ${count} duplicados.`);
            } catch (e) {
              console.error('Error cleaning duplicates:', e);
              Alert.alert('Error', 'No se pudieron eliminar los duplicados.');
            }
          },
        },
      ],
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Eliminar cuenta',
      'Se eliminaran permanentemente tu cuenta y todos tus datos (clientes, deudas, transferencias). Esta accion no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar cuenta',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirmar eliminacion',
              'Estas seguro? Todos tus datos seran eliminados permanentemente.',
              [
                { text: 'No, cancelar', style: 'cancel' },
                {
                  text: 'Si, eliminar',
                  style: 'destructive',
                  onPress: async () => {
                    setLoading(true);
                    try {
                      await deleteAccount();
                    } catch (e: any) {
                      if (e.message === 'REQUIRES_RECENT_LOGIN') {
                        Alert.alert(
                          'Sesion expirada',
                          'Por seguridad, necesitas iniciar sesion de nuevo antes de eliminar tu cuenta. Cierra sesion y vuelve a entrar.',
                        );
                      } else {
                        Alert.alert('Error', 'No se pudo eliminar la cuenta. Intenta de nuevo.');
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
                {groupData.role === 'admin' ? 'Admin' : 'Miembro'}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Group section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Grupo Familiar</Text>

        {groupData ? (
          <View>
            {/* Group code */}
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>Codigo del grupo</Text>
              <Text style={styles.codeValue}>{groupData.code}</Text>
              <Text style={styles.codeHint}>
                Comparte este codigo para que otros se unan
              </Text>
            </View>

            {/* Members */}
            <Text style={styles.subsectionTitle}>
              Miembros ({members.length})
            </Text>
            {members.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>
                    {member.displayName || member.email}
                  </Text>
                  <Text style={styles.memberRole}>
                    {member.role === 'admin' ? 'Admin' : 'Miembro'}
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
                    <Text style={styles.removeBtnText}>Quitar</Text>
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
                  <Text style={styles.dangerBtnText}>Salir del grupo</Text>
                </TouchableOpacity>
              )}
              {isAdmin && (
                <TouchableOpacity
                  onPress={handleDissolveGroup}
                  style={styles.dangerBtn}
                >
                  <Text style={styles.dangerBtnText}>Disolver grupo</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View>
            <Text style={styles.noGroupText}>
              No estas en ningun grupo. Crea uno o unite con un codigo.
            </Text>

            <TouchableOpacity
              onPress={handleCreateGroup}
              style={styles.primaryBtn}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Crear Grupo</Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>o</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.joinRow}>
              <TextInput
                style={styles.joinInput}
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder="Codigo"
                placeholderTextColor={colors.textHint}
                autoCapitalize="characters"
                maxLength={6}
              />
              <TouchableOpacity
                onPress={handleJoinGroup}
                style={[styles.joinBtn, !joinCode && styles.joinBtnDisabled]}
                disabled={!joinCode || loading}
              >
                <Text style={styles.joinBtnText}>Unirse</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* WhatsApp Templates */}
      {waLoaded && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mensajes WhatsApp</Text>
          <Text style={styles.templateLabel}>Mensaje "En camino"</Text>
          <TextInput
            style={styles.templateInput}
            value={waEnCamino}
            onChangeText={setWaEnCamino}
            placeholder={DEFAULT_EN_CAMINO}
            placeholderTextColor={colors.textDisabled}
            multiline
            numberOfLines={3}
          />
          <Text style={[styles.templateLabel, { marginTop: 12 }]}>Mensaje de deuda</Text>
          <TextInput
            style={styles.templateInput}
            value={waDeuda}
            onChangeText={setWaDeuda}
            placeholder={DEFAULT_DEUDA}
            placeholderTextColor={colors.textDisabled}
            multiline
            numberOfLines={2}
          />
          <Text style={styles.templateHint}>Usa {'${total}'} para insertar el monto</Text>
          <Text style={[styles.templateLabel, { marginTop: 12 }]}>Mensaje de recordatorio</Text>
          <TextInput
            style={styles.templateInput}
            value={waRecordatorio}
            onChangeText={setWaRecordatorio}
            placeholder={DEFAULT_RECORDATORIO}
            placeholderTextColor={colors.textDisabled}
            multiline
            numberOfLines={4}
          />
          <View style={styles.templateActions}>
            <TouchableOpacity onPress={handleSaveTemplates} style={styles.templateSaveBtn}>
              <Text style={styles.templateSaveBtnText}>Guardar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleResetTemplates} style={styles.templateResetBtn}>
              <Text style={styles.templateResetBtnText}>Restaurar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Export */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Exportar Datos</Text>
        <TouchableOpacity onPress={handleExportCSV} style={styles.exportBtn}>
          <Text style={styles.exportBtnText}><Ionicons name="share-outline" size={16} /> Exportar Clientes (CSV)</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleExportJSON} style={[styles.exportBtn, { marginTop: 8 }]}>
          <Text style={styles.exportBtnText}><Ionicons name="save-outline" size={16} /> Backup Completo (JSON)</Text>
        </TouchableOpacity>
      </View>

      {/* Cleanup duplicates */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mantenimiento</Text>
        <TouchableOpacity onPress={handleCleanupDuplicates} style={styles.exportBtn}>
          <Text style={styles.exportBtnText}>Limpiar duplicados</Text>
        </TouchableOpacity>
        <Text style={styles.deleteAccountHint}>
          Elimina clientes duplicados que quedaron en el directorio.
        </Text>
      </View>

      {/* Sign out */}
      <View style={styles.section}>
        <TouchableOpacity onPress={onSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Cerrar Sesion</Text>
        </TouchableOpacity>
      </View>

      {/* Delete account */}
      <View style={styles.section}>
        <TouchableOpacity
          onPress={handleDeleteAccount}
          style={styles.deleteAccountBtn}
          disabled={loading}
        >
          <Text style={styles.deleteAccountText}>Eliminar cuenta</Text>
        </TouchableOpacity>
        <Text style={styles.deleteAccountHint}>
          Se eliminaran todos tus datos permanentemente.
        </Text>
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
    padding: 16,
  },
  sectionTitle: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 12,
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
    marginTop: 12,
  },
  templateSaveBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  templateSaveBtnText: {
    color: colors.textWhite,
    fontWeight: '700',
    fontSize: s(15),
  },
  templateResetBtn: {
    flex: 1,
    backgroundColor: colors.sectionBackground,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  templateResetBtnText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: s(15),
  },
  exportBtn: {
    backgroundColor: colors.primaryLighter,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  exportBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: s(16),
  },
  signOutBtn: {
    backgroundColor: colors.card,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  signOutText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: s(16),
  },
  deleteAccountBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  deleteAccountText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: s(15),
  },
  deleteAccountHint: {
    color: colors.textHint,
    fontSize: s(13),
    textAlign: 'center',
    marginTop: 4,
  },
});
};

export default SettingsScreen;
