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
import { Group, UserData } from '../types';

interface SettingsScreenProps {
  user: UserData;
  groupData: Group | null;
  isAdmin: boolean;
  onSignOut: () => void;
  onGroupUpdate: (data: Group | null) => void;
}

const SettingsScreen: React.FC<SettingsScreenProps> = ({
  user,
  groupData,
  isAdmin,
  onSignOut,
  onGroupUpdate,
}) => {
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
                placeholderTextColor="#9CA3AF"
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

      <View style={{ height: 60 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  subsectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  userEmail: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  roleBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    overflow: 'hidden',
  },
  codeCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  codeLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  codeValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#2563EB',
    letterSpacing: 4,
    marginVertical: 8,
  },
  codeHint: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  memberRole: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  removeBtn: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  removeBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 12,
  },
  groupActions: {
    marginTop: 16,
  },
  dangerBtn: {
    backgroundColor: '#FEF2F2',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  dangerBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 14,
  },
  noGroupText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
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
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    color: '#9CA3AF',
    paddingHorizontal: 12,
    fontSize: 13,
  },
  joinRow: {
    flexDirection: 'row',
    gap: 8,
  },
  joinInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    letterSpacing: 3,
    textAlign: 'center',
  },
  joinBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    borderRadius: 10,
    justifyContent: 'center',
  },
  joinBtnDisabled: { opacity: 0.5 },
  joinBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  signOutBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  signOutText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 14,
  },
});

export default SettingsScreen;
