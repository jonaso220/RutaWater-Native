import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  const [storedProfileIds, setStoredProfileIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const backfilledRef = useRef<Set<string>>(new Set());

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
          setStoredProfileIds(Array.isArray(data.profileIds) ? data.profileIds : []);
          setLoaded(true);
        },
        () => setLoaded(true),
      );
    return unsub;
  }, [userId]);

  // Backfill: perfiles propios creados antes de existir el sharing pueden no
  // tener `code`/`members`. Los completamos una sola vez por perfil (ref guard
  // para no regenerar el código en cada snapshot).
  useEffect(() => {
    if (!userId) return;
    customProfiles.forEach((p) => {
      if (p.ownerId !== userId) return;
      const needsCode = !p.code;
      const needsMember = !p.members || !p.members[userId];
      if ((!needsCode && !needsMember) || backfilledRef.current.has(p.id)) return;
      backfilledRef.current.add(p.id);
      const patch: Record<string, any> = {};
      if (needsCode) patch.code = generateCode();
      if (needsMember) {
        patch[`members.${userId}`] = {
          role: 'admin',
          name: displayName || '',
          email: email || '',
        };
        patch.memberUids = firestore.FieldValue.arrayUnion(userId);
      }
      db.collection('profiles')
        .doc(p.id)
        .update(patch)
        .catch((e) => reportError(e, 'Error backfilling profile'));
    });
  }, [customProfiles, userId, displayName, email]);

  // Mantiene `users/{uid}.profileIds` = ids de repartos a los que pertenece el
  // usuario. Lo usan las reglas de Firestore para autorizar las consultas por
  // lista (where('groupId' == perfil)) con una sola lectura del doc del usuario.
  useEffect(() => {
    if (!userId) return;
    const desired = customProfiles.map((p) => p.id);
    const a = [...desired].sort();
    const b = [...storedProfileIds].sort();
    if (a.length === b.length && a.every((v, i) => v === b[i])) return;
    db.collection('users')
      .doc(userId)
      .set({ profileIds: desired }, { merge: true })
      .catch((e) => reportError(e, 'Error syncing profileIds'));
  }, [customProfiles, storedProfileIds, userId]);

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
        // Borrar primero los datos del reparto: las reglas autorizan el delete
        // por dueño del perfil leyendo profiles/{id}, así que el doc del perfil
        // tiene que seguir existiendo mientras se borran. Antes solo se borraba
        // el perfil y clientes/deudas/transferencias quedaban huérfanos e
        // inaccesibles para siempre.
        for (const col of ['clients', 'debts', 'transfers']) {
          let snap = await db.collection(col).where('groupId', '==', id).limit(450).get();
          while (!snap.empty) {
            const batch = db.batch();
            snap.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
            snap = await db.collection(col).where('groupId', '==', id).limit(450).get();
          }
        }
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
