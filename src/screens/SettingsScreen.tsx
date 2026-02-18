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
} from 'react-native';
import { db } from '../config/firebase';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { ThemeColors } from '../theme/colors';

const SettingsScreen = () => {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const { user: firebaseUser, groupData, isAdmin, signOut, deleteAccount, setGroupData } = useAuthContext();
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
              // Remove all members
              for (const member of members) {
                await db
                  .collection('users')
                  .doc(member.id)
                  .update({ groupId: null, role: null });
              }

              // Clear groupId from data
              const batch = db.batch();
              let count = 0;
              const clientsSnap = await db
                .collection('clients')
                .where('groupId', '==', groupData.groupId)
                .get();
              for (const doc of clientsSnap.docs) {
                batch.update(doc.ref, { groupId: null });
                count++;
                if (count >= 450) break;
              }

              await batch.commit();

              // Delete group doc
              await db
                .collection('groups')
                .doc(groupData.groupId)
                .delete();

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

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  subsectionTitle: {
    fontSize: 15,
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
    fontSize: 22,
    fontWeight: '700',
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  userEmail: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  roleBadge: {
    fontSize: 13,
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
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '600',
  },
  codeValue: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 4,
    marginVertical: 8,
  },
  codeHint: {
    fontSize: 13,
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
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  memberRole: {
    fontSize: 13,
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
    fontSize: 14,
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
    fontSize: 16,
  },
  noGroupText: {
    fontSize: 16,
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
    fontSize: 18,
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
    fontSize: 15,
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
    fontSize: 20,
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
    fontSize: 16,
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
    fontSize: 16,
  },
  deleteAccountBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  deleteAccountText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 15,
  },
  deleteAccountHint: {
    color: colors.textHint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
});

export default SettingsScreen;
