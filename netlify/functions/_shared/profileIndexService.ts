import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ensureOwnedProfileCodeReservation } from './profileCreationService';

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const syncProfileIds = async (db: Firestore, uid: string): Promise<string[]> => {
  if (!uid) throw new Error('UID autenticado requerido.');

  const memberProfilesQuery = db.collection('profiles').where('memberUids', 'array-contains', uid);
  const ownedProfilesQuery = db.collection('profiles').where('ownerId', '==', uid);
  const userRef = db.collection('users').doc(uid);
  const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);

  // Owners of pre-reservation profiles are the only principals allowed to
  // normalize their legacy code. Each transaction preserves createdAt/data,
  // reserves the exact code once, and rotates only a real collision.
  const ownedForNormalization = await ownedProfilesQuery.get();
  for (const profile of ownedForNormalization.docs) {
    const state = profile.data().lifecycleState;
    if (state !== undefined && state !== 'active') continue;
    try {
      await ensureOwnedProfileCodeReservation({ db, uid, profileId: profile.id });
    } catch (error) {
      if (error instanceof Error && error.message === 'ACCOUNT_WRITE_BLOCKED') {
        throw new Error('ACCOUNT_DELETION_IN_PROGRESS');
      }
      throw error;
    }
  }

  return db.runTransaction(async (transaction) => {
    // Query and cache write share one transaction. A simultaneous join/leave
    // retries instead of replacing a newer profileIds value with stale data.
    const memberProfiles = await transaction.get(memberProfilesQuery);
    const ownedProfiles = await transaction.get(ownedProfilesQuery);
    const user = await transaction.get(userRef);
    const deletionJob = await transaction.get(deletionJobRef);
    const userData = user.data();
    if (
      deletionJob.exists
      || (userData?.accountState ?? 'active') !== 'active'
    ) {
      throw new Error('ACCOUNT_DELETION_IN_PROGRESS');
    }
    const activeProfiles = new Map<string, QueryDocumentSnapshot>();
    [...memberProfiles.docs, ...ownedProfiles.docs].forEach((doc) => {
      const state = doc.data().lifecycleState;
      if (state === undefined || state === 'active') activeProfiles.set(doc.id, doc);
    });

    // Very old owner profiles predate memberUids/members. Repair only the
    // authenticated owner's own active documents before caching their IDs.
    ownedProfiles.docs.forEach((doc) => {
      if (!activeProfiles.has(doc.id)) return;
      const data = doc.data();
      const memberUids = stringArray(data.memberUids);
      const members = data.members && typeof data.members === 'object' ? data.members : {};
      if (memberUids.includes(uid) && members[uid]) return;
      transaction.update(doc.ref, {
        memberUids: memberUids.includes(uid) ? memberUids : [...memberUids, uid],
        members: {
          ...members,
          [uid]: {
            role: 'admin',
            name: typeof userData.displayName === 'string' ? userData.displayName : '',
            email: typeof userData.email === 'string' ? userData.email : '',
          },
        },
      });
    });

    const profileIds = [...activeProfiles.keys()].sort();

    transaction.set(userRef, {
      profileIds,
      // Versioned server marker: a populated legacy cache is not proof that it
      // contains every canonical membership. Clients cannot forge this field.
      profileIndexVersion: 1,
    }, { merge: true });
    // Reading the user document adds a conflict with join/deletion while merge
    // keeps every unrelated account field.
    return profileIds;
  });
};
