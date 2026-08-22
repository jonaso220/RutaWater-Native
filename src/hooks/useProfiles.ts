import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { db } from '../config/firebase';
import { API_ENDPOINTS } from '../config/api';
import { reportError } from '../lib/crashReporting';
import i18n from '../i18n';
import { recoverProfileIndex } from '../services/profileIndexRecovery';
import { Profile, ProfileMember, PRIMARY_PROFILE_ID } from '../stores/profileStore';
import { switchProfileOptimistically } from '../utils/profileSwitch';

const PROFILE_INDEX_REQUEST_TIMEOUT_MS = 10_000;

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
  // '' = sin nombre guardado; el fallback traducido se resuelve al mostrar.
  const [primaryName, setPrimaryName] = useState<string>('');
  const [storedProfileIds, setStoredProfileIds] = useState<string[]>([]);
  const [profileIdsInitialized, setProfileIdsInitialized] = useState(false);
  const [profileIndexVersion, setProfileIndexVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [profileSyncRetryNonce, setProfileSyncRetryNonce] = useState(0);
  const activeProfileIdRef = useRef<string>(PRIMARY_PROFILE_ID);
  const syncAttemptedForUserRef = useRef<string | null>(null);
  const profileSyncRetryCountRef = useRef(0);
  const profileSyncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileCreateRequestsRef = useRef<Map<string, string>>(new Map());
  const needsLegacyOwnerRepair = customProfiles.some((profile) =>
    profile.ownerId === userId && (!profile.code || !profile.members?.[userId]),
  );

  // Los perfiles se cargan por IDs cacheados y cada documento vuelve a validar
  // memberUids en las reglas. Firestore no puede demostrar de forma segura una
  // regla de membresía para una query `array-contains`, por eso nunca abrimos el
  // listado completo de profiles a usuarios autenticados.
  useEffect(() => {
    if (!userId || !loaded || !profileIdsInitialized) return;
    const ids = [...new Set(storedProfileIds.filter(Boolean))];
    if (ids.length === 0) {
      setCustomProfiles([]);
      return;
    }

    const byId = new Map<string, Profile>();
    const emit = () => {
      setCustomProfiles(ids.map((id) => byId.get(id)).filter((item): item is Profile => !!item));
    };
    const unsubscribers = ids.map((id) => db
      .collection('profiles')
      .doc(id)
      .onSnapshot(
        (doc) => {
          const data = doc.data();
          const memberUids = Array.isArray(data?.memberUids) ? data.memberUids : [];
          const lifecycleState = data?.lifecycleState || 'active';
          if (!doc.exists || !data || lifecycleState !== 'active' || !memberUids.includes(userId)) {
            byId.delete(id);
          } else {
            byId.set(id, {
              id,
              name: data.name || i18n.t('settings.defaultProfileName'),
              isPrimary: false,
              scopeGroupId: id,
              ownerId: data.ownerId,
              code: data.code,
              members: (data.members || {}) as Record<string, ProfileMember>,
              isOwner: data.ownerId === userId,
            });
          }
          emit();
        },
        () => {
          // A stale cache entry after an owner removes/deletes a profile is
          // harmless: canonical rules deny the document and it disappears.
          byId.delete(id);
          emit();
        },
      ));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [loaded, profileIdsInitialized, storedProfileIds, userId]);

  // Perfil activo + nombre del Reparto 1, desde el doc del usuario.
  useEffect(() => {
    if (!userId) return;
    setLoaded(false);
    setProfileIdsInitialized(false);
    setProfileIndexVersion(0);
    setStoredProfileIds([]);
    setCustomProfiles([]);
    syncAttemptedForUserRef.current = null;
    profileSyncRetryCountRef.current = 0;
    if (profileSyncRetryTimerRef.current) {
      clearTimeout(profileSyncRetryTimerRef.current);
      profileSyncRetryTimerRef.current = null;
    }
    const unsub = db
      .collection('users')
      .doc(userId)
      .onSnapshot(
        (doc) => {
          const data = doc.data() || {};
          const nextActiveProfileId = data.activeProfileId || PRIMARY_PROFILE_ID;
          activeProfileIdRef.current = nextActiveProfileId;
          setActiveProfileId(nextActiveProfileId);
          setPrimaryName(data.primaryProfileName || '');
          const hasProfileIds = Array.isArray(data.profileIds);
          setStoredProfileIds(hasProfileIds ? data.profileIds : []);
          setProfileIdsInitialized(hasProfileIds);
          setProfileIndexVersion(
            typeof data.profileIndexVersion === 'number' ? data.profileIndexVersion : 0,
          );
          setLoaded(true);
        },
        () => setLoaded(true),
      );
    return unsub;
  }, [userId]);

  // One-time backend recovery for accounts not yet certified by the versioned
  // server index. A legacy profileIds array may be present but incomplete, so
  // its mere existence cannot skip canonical recovery.
  // Admin queries canonical memberUids, updates the cache transactionally, and
  // returns only this authenticated user's IDs; no profile list is exposed.
  useEffect(() => {
    const syncKey = `${userId}:${profileIndexVersion < 1 ? 'index' : 'legacy-repair'}`;
    if (
      !userId
      || !loaded
      || (profileIndexVersion >= 1 && !needsLegacyOwnerRepair)
      || profileSyncRetryCountRef.current >= 5
      || syncAttemptedForUserRef.current === syncKey
    ) return;
    syncAttemptedForUserRef.current = syncKey;
    let cancelled = false;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('PROFILE_INDEX_TIMEOUT'));
      }, PROFILE_INDEX_REQUEST_TIMEOUT_MS);
    });
    void (async () => {
      try {
        const currentUser = auth().currentUser;
        if (!currentUser || currentUser.uid !== userId) {
          throw new Error('PROFILE_INDEX_AUTH_CHANGED');
        }
        const recovered = await Promise.race([
          recoverProfileIndex({
            user: currentUser,
            expectedUid: userId,
            endpoint: API_ENDPOINTS.syncProfileIds,
            signal: controller.signal,
          }),
          timeoutPromise,
        ]);
        if (cancelled || auth().currentUser?.uid !== userId) return;
        setStoredProfileIds(recovered.profileIds);
        setProfileIdsInitialized(true);
        setProfileIndexVersion(recovered.profileIndexVersion);
        profileSyncRetryCountRef.current = 0;
      } catch (error) {
        if (cancelled) return;
        reportError(error, 'Error recovering profile index');
        // list queries are intentionally denied by rules, so a legacy account
        // depends on this server index. A transient network/function failure
        // must not hide every reparto for the rest of the app session.
        const retryIndex = profileSyncRetryCountRef.current;
        profileSyncRetryCountRef.current += 1;
        if (profileSyncRetryCountRef.current >= 5) return;
        syncAttemptedForUserRef.current = null;
        const retryDelayMs = Math.min(30_000, 1_000 * (2 ** Math.min(retryIndex, 5)));
        profileSyncRetryTimerRef.current = setTimeout(() => {
          profileSyncRetryTimerRef.current = null;
          setProfileSyncRetryNonce((value) => value + 1);
        }, retryDelayMs);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, [loaded, needsLegacyOwnerRepair, profileIndexVersion, profileSyncRetryNonce, userId]);

  useEffect(() => () => {
    if (profileSyncRetryTimerRef.current) {
      clearTimeout(profileSyncRetryTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (profileSyncRetryTimerRef.current) {
        clearTimeout(profileSyncRetryTimerRef.current);
        profileSyncRetryTimerRef.current = null;
      }
      profileSyncRetryCountRef.current = 0;
      syncAttemptedForUserRef.current = null;
      setProfileSyncRetryNonce((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);

  const primary = useMemo<Profile>(
    () => ({
      id: PRIMARY_PROFILE_ID,
      name: primaryName || i18n.t('settings.defaultPrimaryProfile'),
      isPrimary: true,
      scopeGroupId: groupId, // undefined => scope por userId (sin cambios)
      isOwner: true, // Reparto 1 se comparte vía Grupo familiar (en Ajustes), no acá
    }),
    [primaryName, groupId],
  );

  const profiles = useMemo<Profile[]>(() => [primary, ...customProfiles], [primary, customProfiles]);

  const activeProfile = useMemo<Profile>(
    () => profiles.find((p) => p.id === activeProfileId) || (
      activeProfileId === PRIMARY_PROFILE_ID
        ? primary
        : {
          id: activeProfileId,
          name: i18n.t('settings.defaultProfileName'),
          isPrimary: false,
          scopeGroupId: activeProfileId,
          isOwner: false,
        }
    ),
    [profiles, activeProfileId, primary],
  );

  const setActiveProfile = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        await switchProfileOptimistically({
          nextId: id,
          getCurrentId: () => activeProfileIdRef.current,
          applyId: (nextId) => {
            activeProfileIdRef.current = nextId;
            setActiveProfileId(nextId);
          },
          persistId: (nextId) => db
            .collection('users')
            .doc(userId)
            .set({ activeProfileId: nextId }, { merge: true }),
        });
      } catch (e) {
        reportError(e, 'Error setting active profile');
        throw e;
      }
    },
    [userId],
  );

  const createProfile = useCallback(
    async (name: string) => {
      const n = name.trim();
      if (!n || !userId) return;
      try {
        const currentUser = auth().currentUser;
        if (!currentUser || currentUser.uid !== userId) throw new Error('PROFILE_CREATE_AUTH_CHANGED');
        const requestId = profileCreateRequestsRef.current.get(n)
          || db.collection('profileCreateRequests').doc().id;
        profileCreateRequestsRef.current.set(n, requestId);
        const response = await fetch(API_ENDPOINTS.createProfile, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await currentUser.getIdToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: n, requestId }),
        });
        const payload = await response.json().catch(() => ({})) as { status?: string };
        if (!response.ok || payload.status !== 'ok') throw new Error('PROFILE_CREATE_FAILED');
        profileCreateRequestsRef.current.delete(n);
      } catch (e) {
        reportError(e, 'Error creating profile');
        throw e;
      }
    },
    [userId],
  );

  const joinProfile = useCallback(
    async (code: string): Promise<'ok' | 'not_found' | 'already' | 'error'> => {
      const c = code.trim().toUpperCase();
      if (!c || !userId) return 'error';
      try {
        const currentUser = auth().currentUser;
        if (!currentUser) return 'error';
        const token = await currentUser.getIdToken();
        const response = await fetch(API_ENDPOINTS.joinProfile, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: c }),
        });
        const payload = await response.json().catch(() => ({})) as { status?: string };
        if (
          response.ok
          && (payload.status === 'ok' || payload.status === 'not_found' || payload.status === 'already')
        ) {
          return payload.status;
        }
        return 'error';
      } catch (e) {
        reportError(e, 'Error joining profile');
        return 'error';
      }
    },
    [userId],
  );

  const leaveProfile = useCallback(
    async (id: string) => {
      if (!userId || id === PRIMARY_PROFILE_ID) return;
      try {
        const batch = db.batch();
        batch.update(db.collection('profiles').doc(id), {
          memberUids: firestore.FieldValue.arrayRemove(userId),
          [`members.${userId}`]: firestore.FieldValue.delete(),
        });
        batch.set(db.collection('users').doc(userId), {
          profileIds: firestore.FieldValue.arrayRemove(id),
          ...(activeProfileId === id ? { activeProfileId: PRIMARY_PROFILE_ID } : {}),
        }, { merge: true });
        await batch.commit();
        if (activeProfileId === id) {
          activeProfileIdRef.current = PRIMARY_PROFILE_ID;
          setActiveProfileId(PRIMARY_PROFILE_ID);
        }
      } catch (e) {
        reportError(e, 'Error leaving profile');
        throw e;
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
        throw e;
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
        throw e;
      }
    },
    [userId],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      if (!userId || id === PRIMARY_PROFILE_ID) return; // Reparto 1 no se borra
      try {
        const profileRef = db.collection('profiles').doc(id);
        const profileDoc = await profileRef.get();
        const profileData = profileDoc.data();
        if (!profileDoc.exists || profileData?.ownerId !== userId) {
          throw new Error('PROFILE_ARCHIVE_NOT_ALLOWED');
        }
        const ownerMember = profileData.members?.[userId] || {
          role: 'admin',
          name: displayName || '',
          email: email || '',
        };

        // Soft-delete: archive only metadata and revoke shared membership. All
        // clients, debts, transfers, and settings stay byte-for-byte intact so
        // no customer data can disappear because of this UI action.
        const finalBatch = db.batch();
        finalBatch.update(profileRef, {
          lifecycleState: 'archived',
          archivedAt: firestore.FieldValue.serverTimestamp(),
          memberUids: [userId],
          members: {
            [userId]: { ...ownerMember, role: 'admin' },
          },
        });
        finalBatch.set(db.collection('users').doc(userId), {
          profileIds: firestore.FieldValue.arrayRemove(id),
          ...(activeProfileId === id ? { activeProfileId: PRIMARY_PROFILE_ID } : {}),
        }, { merge: true });
        await finalBatch.commit();
        if (activeProfileId === id) {
          activeProfileIdRef.current = PRIMARY_PROFILE_ID;
          setActiveProfileId(PRIMARY_PROFILE_ID);
        }
      } catch (e) {
        reportError(e, 'Error deleting profile');
        throw e;
      }
    },
    [userId, activeProfileId, displayName, email],
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
