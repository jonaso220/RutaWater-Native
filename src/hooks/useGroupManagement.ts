import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { useTranslation } from 'react-i18next';

interface GroupUser {
  uid: string;
  email: string;
  displayName: string;
}

const generateCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Firestore batches cap at 500 writes; chunk well under that.
const commitBatchUpdates = async (updates: { ref: any; data: any }[]) => {
  for (let i = 0; i < updates.length; i += 450) {
    const batch = db.batch();
    updates.slice(i, i + 450).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
};

export const useGroupManagement = (
  user: GroupUser,
  groupData: any,
  onGroupUpdate: (data: any) => void,
  setLoading: (loading: boolean) => void,
) => {
  const { t } = useTranslation();
  const [joinCode, setJoinCode] = useState('');
  const [members, setMembers] = useState<any[]>([]);

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
      const updates: { ref: any; data: any }[] = [];
      const collections = ['clients', 'debts', 'transfers'];
      for (const collectionName of collections) {
        const snap = await db
          .collection(collectionName)
          .where('userId', '==', user.uid)
          .get();
        snap.docs.forEach((doc) => updates.push({ ref: doc.ref, data: { groupId } }));
      }
      await commitBatchUpdates(updates);

      onGroupUpdate({ groupId, role: 'admin', code });
    } catch (e) {
      reportError(e, 'Error creating group');
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
      reportError(e, 'Error joining group');
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

              await commitBatchUpdates(updates);

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

  return {
    members,
    joinCode,
    setJoinCode,
    handleCreateGroup,
    handleJoinGroup,
    handleLeaveGroup,
    handleRemoveMember,
    handleDissolveGroup,
  };
};
