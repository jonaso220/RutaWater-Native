import {
  FieldValue,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';
import {
  generateProfileId,
  generateProfileInviteCode,
  normalizeInviteCode,
  PROFILE_CODE_RESERVATION_VERSION,
} from './profileInviteCode';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const MAX_COLLISION_RETRIES = 12;

const isActive = (data: DocumentData): boolean =>
  data.lifecycleState === undefined || data.lifecycleState === 'active';

const accountCanWrite = (data: DocumentData | undefined): boolean => {
  const state = data?.accountState;
  const pendingGroupId = data?.pendingGroupId;
  return (state === undefined || state === null || state === 'active')
    && !(typeof pendingGroupId === 'string' && pendingGroupId.trim());
};

const normalizedName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 80 ? name : null;
};

export interface CreatedProfileResult {
  profileId: string;
  code: string;
  created: boolean;
}

interface CreateProfileInput {
  db: Firestore;
  uid: string;
  name: string;
  requestId: string;
  generateId?: () => string;
  generateCode?: () => string;
}

type CreateAttempt = CreatedProfileResult | { collision: true };

export const createProfileForOwner = async ({
  db,
  uid,
  name,
  requestId,
  generateId = generateProfileId,
  generateCode = generateProfileInviteCode,
}: CreateProfileInput): Promise<CreatedProfileResult> => {
  const cleanName = normalizedName(name);
  if (!uid || !cleanName || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('PROFILE_CREATE_INPUT_INVALID');
  }

  const requestRef = db.collection('profileCreateRequests').doc(`${uid}_${requestId}`);
  const userRef = db.collection('users').doc(uid);
  const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt += 1) {
    const profileId = generateId();
    const code = generateCode();
    if (!/^profile_[a-f0-9]{32}$/.test(profileId) || !normalizeInviteCode(code)) {
      throw new Error('PROFILE_CREATE_GENERATOR_INVALID');
    }

    const result = await db.runTransaction<CreateAttempt>(async (transaction) => {
      const [requestDoc, userDoc, deletionJob] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(userRef),
        transaction.get(deletionJobRef),
      ]);
      const userData = userDoc.data() || {};
      if (deletionJob.exists || !accountCanWrite(userData)) {
        throw new Error('ACCOUNT_WRITE_BLOCKED');
      }

      if (requestDoc.exists) {
        const requestData = requestDoc.data() || {};
        if (
          requestData.ownerId !== uid
          || typeof requestData.profileId !== 'string'
          || !normalizeInviteCode(requestData.code)
        ) throw new Error('PROFILE_CREATE_REQUEST_CORRUPT');
        const existingProfile = await transaction.get(
          db.collection('profiles').doc(requestData.profileId),
        );
        if (!existingProfile.exists || existingProfile.data()?.ownerId !== uid) {
          throw new Error('PROFILE_CREATE_REQUEST_CORRUPT');
        }
        transaction.set(userRef, {
          profileIds: FieldValue.arrayUnion(requestData.profileId),
          profileIndexVersion: 1,
        }, { merge: true });
        return {
          profileId: requestData.profileId,
          code: requestData.code,
          created: false,
        };
      }

      const profileRef = db.collection('profiles').doc(profileId);
      const codeRef = db.collection('profileCodes').doc(code);
      const [profileDoc, codeDoc] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(codeRef),
      ]);
      if (profileDoc.exists || codeDoc.exists) return { collision: true };

      const ownerMember = {
        role: 'admin',
        name: typeof userData.displayName === 'string' ? userData.displayName : '',
        email: typeof userData.email === 'string' ? userData.email : '',
      };
      transaction.create(profileRef, {
        name: cleanName,
        ownerId: uid,
        code,
        memberUids: [uid],
        members: { [uid]: ownerMember },
        createdAt: FieldValue.serverTimestamp(),
        lifecycleState: 'active',
        creationVersion: PROFILE_CODE_RESERVATION_VERSION,
        codeReservationVersion: PROFILE_CODE_RESERVATION_VERSION,
      });
      transaction.create(codeRef, {
        profileId,
        ownerId: uid,
        state: 'active',
        reservationVersion: PROFILE_CODE_RESERVATION_VERSION,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(requestRef, {
        ownerId: uid,
        profileId,
        code,
        name: cleanName,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(userRef, {
        profileIds: FieldValue.arrayUnion(profileId),
        profileIndexVersion: 1,
      }, { merge: true });
      return { profileId, code, created: true };
    });

    if (!('collision' in result)) return result;
  }
  throw new Error('PROFILE_CREATE_COLLISION_LIMIT');
};

interface NormalizeProfileCodeInput {
  db: Firestore;
  uid: string;
  profileId: string;
  generateCode?: () => string;
}

export const ensureOwnedProfileCodeReservation = async ({
  db,
  uid,
  profileId,
  generateCode = generateProfileInviteCode,
}: NormalizeProfileCodeInput): Promise<string | null> => {
  let forceNewCode = false;
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt += 1) {
    const generatedCode = generateCode();
    if (!normalizeInviteCode(generatedCode)) throw new Error('PROFILE_CODE_GENERATOR_INVALID');

    const result = await db.runTransaction<string | 'collision' | null>(async (transaction) => {
      const profileRef = db.collection('profiles').doc(profileId);
      const userRef = db.collection('users').doc(uid);
      const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);
      const [profile, user, deletionJob] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(userRef),
        transaction.get(deletionJobRef),
      ]);
      const profileData = profile.data() || {};
      if (!profile.exists || profileData.ownerId !== uid || !isActive(profileData)) return null;
      if (deletionJob.exists || !accountCanWrite(user.data())) {
        throw new Error('ACCOUNT_WRITE_BLOCKED');
      }

      const legacyCode = normalizeInviteCode(profileData.code);
      const candidate = !forceNewCode && legacyCode ? legacyCode : generatedCode;
      const codeRef = db.collection('profileCodes').doc(candidate);
      const reservation = await transaction.get(codeRef);
      const reservationData = reservation.data() || {};
      if (reservation.exists && reservationData.profileId !== profileId) return 'collision';

      if (!reservation.exists) {
        transaction.create(codeRef, {
          profileId,
          ownerId: uid,
          state: 'active',
          reservationVersion: PROFILE_CODE_RESERVATION_VERSION,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else if (
        reservationData.ownerId !== uid
        || reservationData.state !== 'active'
        || reservationData.reservationVersion !== PROFILE_CODE_RESERVATION_VERSION
      ) {
        // This reservation already belongs to the same profile, so repairing
        // its server-owned metadata is safe and does not rotate a customer's
        // existing invite code. A reservation owned by another profile took
        // the collision branch above and can never be overwritten here.
        transaction.set(codeRef, {
          profileId,
          ownerId: uid,
          state: 'active',
          reservationVersion: PROFILE_CODE_RESERVATION_VERSION,
        }, { merge: true });
      }
      if (
        profileData.code !== candidate
        || profileData.codeReservationVersion !== PROFILE_CODE_RESERVATION_VERSION
      ) {
        transaction.update(profileRef, {
          code: candidate,
          codeReservationVersion: PROFILE_CODE_RESERVATION_VERSION,
        });
      }
      return candidate;
    });

    if (result === 'collision') {
      forceNewCode = true;
      continue;
    }
    return result;
  }
  throw new Error('PROFILE_CODE_COLLISION_LIMIT');
};
