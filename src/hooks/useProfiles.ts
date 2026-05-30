import { useState, useEffect, useMemo, useCallback } from 'react';
import firestore from '@react-native-firebase/firestore';
import { db } from '../config/firebase';
import { reportError } from '../lib/crashReporting';
import { Profile, ProfileMember, PRIMARY_PROFILE_ID } from '../stores/profileStore';

const generateCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

/**
 * Maneja la lista de perfiles del usuario, el perfil activo, y el ABM.
 *
 * - Reparto 1 (primary) es IMPLÍCITO: no vive en Firestore, usa el scope actual
 *   del usuario (`groupId` real, o userId si no tiene grupo). Su nombre se puede
 *   editar y se guarda en `users/{uid}.primaryProfileName`.
 * - Los perfiles nuevos viven en la colección `profiles`
 *   ({ name, ownerId, memberUids[], createdAt }) y su id se usa como groupId de
 *   scope para sus datos.
 * - El perfil activo se guarda en `users/{uid}.activeProfileId`.
 */
export const useProfiles = (
  userId: string,
  groupId: string | undefined,
  displayName?: string | null,
  email?: string | null,
) => {
  const [customProfiles, setCustomProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>(PRIMARY_PROFILE_ID);
  const [primaryName, setPrimaryName] = useState<string>('Reparto 1');
  const [loaded, setLoaded] = useState(false);

  // Perfiles propios (donde el usuario es miembro).
  useEffect(() => {
    if (!userId) return;
    const unsub = db
      .collection('profiles')
      .where('memberUids', 'array-contains', userId)
      .onSnapshot(
        (snap) => {
          const list = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name || 'Reparto',
              isPrimary: false,
              scopeGroupId: d.id,
              ownerId: data.ownerId,
              code: data.code,
              members: (data.members || {}) as Record<string, ProfileMember>,
              isOwner: data.ownerId === userId,
            } as Profile;
          });
          setCustomProfiles(list);
        },
        (e) => reportError(e, 'Error loading profiles'),
      );
    return unsub;
  }, [userId]);

  // Perfil activo + nombre del Reparto 1, desde el doc del usuario.
  useEffect(() => {
    if (!userId) return;
    const unsub = db
      .collection('users')
      .doc(userId)
      .onSnapshot(
        (doc) => {
          const data = doc.data() || {};
          setActiveProfileId(data.activeProfileId || PRIMARY_PROFILE_ID);
          setPrimaryName(data.primaryProfileName || 'Reparto 1');
          setLoaded(true);
        },
        () => setLoaded(true),
      );
    return unsub;
  }, [userId]);

  const primary = useMemo<Profile>(
    () => ({
      id: PRIMARY_PROFILE_ID,
      name: primaryName,
      isPrimary: true,
      scopeGroupId: groupId, // undefined => scope por userId (sin cambios)
      isOwner: true, // Reparto 1 se comparte vía Grupo familiar (en Ajustes), no acá
    }),
    [primaryName, groupId],
  );

  const profiles = useMemo<Profile[]>(() => [primary, ...customProfiles], [primary, customProfiles]);

  const activeProfile = useMemo<Profile>(
    () => profiles.find((p) => p.id === activeProfileId) || primary,
    [profiles, activeProfileId, primary],
  );

  const setActiveProfile = useCallback(
    async (id: string) => {
      if (!userId) return;
      setActiveProfileId(id); // optimista
      try {
        await db.collection('users').doc(userId).set({ activeProfileId: id }, { merge: true });
      } catch (e) {
        reportError(e, 'Error setting active profile');
      }
    },
    [userId],
  );

  const createProfile = useCallback(
    async (name: string) => {
      const n = name.trim();
      if (!n || !userId) return;
      try {
        await db.collection('profiles').add({
          name: n,
          ownerId: userId,
          code: generateCode(),
          memberUids: [userId],
          members: {
            [userId]: { role: 'admin', name: displayName || '', email: email || '' },
          },
          createdAt: new Date(),
        });
      } catch (e) {
        reportError(e, 'Error creating profile');
      }
    },
    [userId, displayName, email],
  );

  const joinProfile = useCallback(
    async (code: string): Promise<'ok' | 'not_found' | 'already' | 'error'> => {
      const c = code.trim().toUpperCase();
      if (!c || !userId) return 'error';
      try {
        const snap = await db.collection('profiles').where('code', '==', c).limit(1).get();
        if (snap.empty) return 'not_found';
        const doc = snap.docs[0];
        const data = doc.data();
        if ((data.memberUids || []).includes(userId)) return 'already';
        await doc.ref.update({
          memberUids: firestore.FieldValue.arrayUnion(userId),
          [`members.${userId}`]: { role: 'member', name: displayName || '', email: email || '' },
        });
        return 'ok';
      } catch (e) {
        reportError(e, 'Error joining profile');
        return 'error';
      }
    },
    [userId, displayName, email],
  );

  const leaveProfile = useCallback(
    async (id: string) => {
      if (!userId || id === PRIMARY_PROFILE_ID) return;
      try {
        await db
          .collection('profiles')
          .doc(id)
          .update({
            memberUids: firestore.FieldValue.arrayRemove(userId),
            [`members.${userId}`]: firestore.FieldValue.delete(),
          });
        if (activeProfileId === id) {
          await db
            .collection('users')
            .doc(userId)
            .set({ activeProfileId: PRIMARY_PROFILE_ID }, { merge: true });
          setActiveProfileId(PRIMARY_PROFILE_ID);
        }
      } catch (e) {
        reportError(e, 'Error leaving profile');
      }
    },
    [userId, activeProfileId],
  );

  const removeMember = useCallback(
    async (profileId: string, memberUid: string) => {
      if (!userId || !profileId || memberUid === userId) return;
      try {
        await db
          .collection('profiles')
          .doc(profileId)
          .update({
            memberUids: firestore.FieldValue.arrayRemove(memberUid),
            [`members.${memberUid}`]: firestore.FieldValue.delete(),
          });
      } catch (e) {
        reportError(e, 'Error removing member');
      }
    },
    [userId],
  );

  const renameProfile = useCallback(
    async (id: string, name: string) => {
      const n = name.trim();
      if (!n || !userId) return;
      try {
        if (id === PRIMARY_PROFILE_ID) {
          await db.collection('users').doc(userId).set({ primaryProfileName: n }, { merge: true });
        } else {
          await db.collection('profiles').doc(id).set({ name: n }, { merge: true });
        }
      } catch (e) {
        reportError(e, 'Error renaming profile');
      }
    },
    [userId],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      if (!userId || id === PRIMARY_PROFILE_ID) return; // Reparto 1 no se borra
      try {
        await db.collection('profiles').doc(id).delete();
        if (activeProfileId === id) {
          await db
            .collection('users')
            .doc(userId)
            .set({ activeProfileId: PRIMARY_PROFILE_ID }, { merge: true });
          setActiveProfileId(PRIMARY_PROFILE_ID);
        }
      } catch (e) {
        reportError(e, 'Error deleting profile');
      }
    },
    [userId, activeProfileId],
  );

  return {
    profiles,
    activeProfile,
    activeProfileId,
    loaded,
    setActiveProfile,
    createProfile,
    renameProfile,
    deleteProfile,
    joinProfile,
    leaveProfile,
    removeMember,
  };
};
