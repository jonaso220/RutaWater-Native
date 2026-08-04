import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { db } from '../config/firebase';
import { API_ENDPOINTS } from '../config/api';
import { reportError } from '../lib/crashReporting';
import { useTranslation } from 'react-i18next';
import { canDissolveGroupAtomically } from '../utils/groupLifecycle';
import {
  createGroupWithRetry,
  GroupCreationRequestError,
} from '../utils/groupCreationRetry';

interface GroupUser {
  uid: string;
  email: string;
  displayName: string;
}

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
      .onSnapshot(
        (snapshot) => {
          const loaded = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          setMembers(loaded);
        },
        () => {
          // Being expelled drops this listener with permission-denied; clear
          // the list instead of leaving stale members on screen.
          setMembers([]);
        },
      );
    return () => unsubscribe();
  }, [groupData?.groupId]);

  const handleCreateGroup = async () => {
    setLoading(true);
    try {
      const result = await createGroupWithRetry(async () => {
        const currentUser = auth().currentUser;
        if (!currentUser) throw new GroupCreationRequestError('AUTH_REQUIRED');
        const token = await currentUser.getIdToken();
        const response = await fetch(API_ENDPOINTS.createGroup, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        const payload = await response.json().catch(() => ({}));
        return { status: response.status, payload };
      });

      onGroupUpdate({ groupId: result.groupId, role: 'admin', code: result.code });
    } catch (e) {
      if (e instanceof GroupCreationRequestError && e.code === 'FREE_MIGRATION_LIMIT') {
        Alert.alert(t('error'), t('settings.createGroupFreeLimit'));
        return;
      }
      reportError(e, 'Error creating group');
      Alert.alert(t('error'), t('settings.createGroupError'));
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    try {
      const currentUser = auth().currentUser;
      if (!currentUser) throw new Error('AUTH_REQUIRED');
      const token = await currentUser.getIdToken();
      const response = await fetch(API_ENDPOINTS.joinGroup, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: joinCode }),
      });
      const payload = await response.json().catch(() => ({})) as { status?: string };
      if (payload.status === 'not_found') {
        Alert.alert(t('error'), t('settings.joinError'));
        return;
      }
      if (payload.status === 'has_personal_data') {
        Alert.alert(t('error'), t('settings.joinHasPersonalData'));
        return;
      }
      if (!response.ok || (payload.status !== 'ok' && payload.status !== 'already')) {
        throw new Error('JOIN_GROUP_FAILED');
      }
      // useAuth observes users/{uid} and switches the scope from the canonical
      // server write. This also covers an idempotent retry whose first response
      // was lost after committing.
      setJoinCode('');
    } catch (e) {
      reportError(e, 'Error joining group');
      Alert.alert(t('error'), t('settings.joinGroupError'));
    } finally {
      setLoading(false);
    }
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
            const gid = groupData.groupId;
            const groupRef = db.collection('groups').doc(gid);
            let shouldRestoreLifecycle = false;
            try {
              // Close the join/write race before reading the final member set.
              // A retry may resume a marker left by an interrupted app process.
              await db.runTransaction(async (transaction) => {
                const current = await transaction.get(groupRef);
                const data = current.data();
                if (!current.exists || data?.adminId !== user.uid || groupData.role !== 'admin') {
                  throw new Error('GROUP_DISSOLVE_PREFLIGHT_FAILED');
                }
                const state = data?.lifecycleState || 'active';
                if (state === 'active') {
                  transaction.update(groupRef, {
                    lifecycleState: 'dissolving',
                    dissolveRequestedBy: user.uid,
                    dissolveRequestedAt: new Date(),
                  });
                  return;
                }
                if (state !== 'dissolving' || data?.dissolveRequestedBy !== user.uid) {
                  throw new Error('GROUP_DISSOLVE_ALREADY_RUNNING');
                }
              });
              shouldRestoreLifecycle = true;

              // Preserve every customer/debt/transfer/settings document byte
              // for byte by turning the old family-group scope into a private
              // custom profile owned by the admin. Only membership metadata
              // changes, and all of it commits atomically.
              const groupRef = db.collection('groups').doc(gid);
              const profileRef = db.collection('profiles').doc(gid);
              const groupSettingsRef = db.collection('settings').doc(gid);
              const personalSettingsRef = db.collection('settings').doc(user.uid);
              const [
                groupDoc,
                profileDoc,
                membersSnap,
                groupSettingsDoc,
                personalSettingsDoc,
              ] = await Promise.all([
                groupRef.get(),
                profileRef.get(),
                db.collection('users').where('groupId', '==', gid).get(),
                groupSettingsRef.get(),
                personalSettingsRef.get(),
              ]);

              if (
                !groupDoc.exists ||
                groupDoc.data()?.adminId !== user.uid ||
                groupDoc.data()?.lifecycleState !== 'dissolving' ||
                groupDoc.data()?.dissolveRequestedBy !== user.uid ||
                groupData.role !== 'admin' ||
                profileDoc.exists
              ) {
                throw new Error('GROUP_DISSOLVE_PREFLIGHT_FAILED');
              }

              const groupCode = groupDoc.data()?.code;
              const groupCodeRef = typeof groupCode === 'string' && groupCode
                ? db.collection('groupCodes').doc(groupCode)
                : null;
              const groupCodeDoc = groupCodeRef ? await groupCodeRef.get() : null;
              if (
                groupDoc.data()?.creationVersion === 'server_resumable_v1'
                && (!groupCodeDoc?.exists || groupCodeDoc.data()?.groupId !== gid)
              ) {
                throw new Error('GROUP_CODE_RESERVATION_MISSING');
              }
              if (groupCodeDoc?.exists && groupCodeDoc.data()?.groupId !== gid) {
                throw new Error('GROUP_CODE_RESERVATION_CHANGED');
              }

              const memberDocs = [...membersSnap.docs];
              if (!memberDocs.some((doc) => doc.id === user.uid)) {
                throw new Error('GROUP_ADMIN_MEMBERSHIP_MISSING');
              }
              if (!canDissolveGroupAtomically(memberDocs.length)) {
                throw new Error('GROUP_TOO_LARGE_FOR_ATOMIC_DISSOLVE');
              }

              const adminDoc = memberDocs.find((doc) => doc.id === user.uid);
              const adminData = adminDoc?.data() || {};
              const originalCreatedAt = groupDoc.data()?.createdAt;
              const privateProfileName =
                adminData.primaryProfileName || t('settings.defaultPrimaryProfile');
              const batch = db.batch();
              batch.set(profileRef, {
                name: privateProfileName,
                ownerId: user.uid,
                memberUids: [user.uid],
                members: {
                  [user.uid]: {
                    role: 'admin',
                    name: user.displayName,
                    email: user.email,
                  },
                },
                // Preserve the descriptor exactly. Some legacy groups predate
                // createdAt; omitting it is safer than inventing metadata and
                // is what the atomic conversion rule verifies.
                ...(originalCreatedAt !== undefined ? { createdAt: originalCreatedAt } : {}),
                lifecycleState: 'active',
                convertedFromFamilyGroup: true,
              });
              memberDocs.forEach((doc) => {
                if (doc.id === user.uid) {
                  batch.set(doc.ref, {
                    groupId: null,
                    role: null,
                    profileIds: firestore.FieldValue.arrayUnion(gid),
                    activeProfileId: gid,
                  }, { merge: true });
                } else {
                  batch.update(doc.ref, { groupId: null, role: null });
                }
              });
              // StoreSync switches from settings/{gid} to settings/{uid} as
              // soon as groupData clears. Copy the effective group settings in
              // the same atomic batch so no catalog/template preference is
              // lost or briefly replaced. Keep settings/{gid} untouched as a
              // historical backup and for the converted profile scope.
              if (groupSettingsDoc.exists) {
                batch.set(personalSettingsRef, {
                  ...(personalSettingsDoc.data() || {}),
                  ...(groupSettingsDoc.data() || {}),
                }, { merge: true });
              }
              if (groupCodeRef && groupCodeDoc?.exists) {
                batch.delete(groupCodeRef);
              }
              batch.delete(groupRef);
              await batch.commit();
              shouldRestoreLifecycle = false;

              onGroupUpdate(null);
            } catch (e) {
              // A failed final batch is fully rolled back. Re-open the group so
              // normal joins/writes can continue; if the app was killed, the
              // next admin retry can resume the same `dissolving` marker.
              if (shouldRestoreLifecycle) {
                try {
                  const current = await groupRef.get();
                  const data = current.data();
                  if (
                    current.exists
                    && data?.adminId === user.uid
                    && data?.lifecycleState === 'dissolving'
                    && data?.dissolveRequestedBy === user.uid
                  ) {
                    await groupRef.update({
                      lifecycleState: 'active',
                      dissolveRequestedBy: firestore.FieldValue.delete(),
                      dissolveRequestedAt: firestore.FieldValue.delete(),
                    });
                  }
                } catch (restoreError) {
                  reportError(restoreError, 'Error restoring group lifecycle');
                }
              }
              reportError(e, 'Error dissolving group');
              Alert.alert(t('error'), t('settings.dissolveError'));
            } finally {
              setLoading(false);
            }
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
