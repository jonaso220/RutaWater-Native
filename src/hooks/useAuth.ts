import { useState, useEffect } from 'react';
import { reportError } from '../lib/crashReporting';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { db } from '../config/firebase';
import { Group } from '../types';
import { ALL_DAYS } from '../constants/products';

// Configure Google Sign-In (webClientId from Firebase Console)
GoogleSignin.configure({
  webClientId: '882759838026-bqngl8jrk5kjmbue3p3gtp6ojse9c2m8.apps.googleusercontent.com', // TODO: Replace with actual web client ID from Firebase Console
});

export const useAuth = () => {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupData, setGroupData] = useState<Group | null>(null);

  // Listen to auth state changes + live group membership.
  useEffect(() => {
    let unsubUser: (() => void) | null = null;
    let seq = 0;
    const unsubscribe = auth().onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
      if (unsubUser) {
        unsubUser();
        unsubUser = null;
      }
      if (!firebaseUser) {
        setGroupData(null);
        setLoading(false);
        return;
      }
      // Live subscription to users/{uid}: if the admin expels this user or
      // dissolves the group, the scope switches immediately. This used to be a
      // one-shot read, leaving the session frozen on the old group (listeners
      // in permission-denied, writes failing silently) until an app restart.
      unsubUser = db
        .collection('users')
        .doc(firebaseUser.uid)
        .onSnapshot(
          async (userDoc) => {
            const mySeq = ++seq;
            try {
              const data = userDoc.exists ? userDoc.data() : null;
              if (data?.groupId) {
                // Fetch group code from groups collection
                let code = '';
                const groupDoc = await db.collection('groups').doc(data.groupId).get();
                if (groupDoc.exists) {
                  code = groupDoc.data()?.code || '';
                }
                if (mySeq !== seq) return; // a newer snapshot superseded this one
                setGroupData({
                  groupId: data.groupId,
                  role: data.role || 'member',
                  code,
                });
              } else {
                setGroupData(null);
              }
            } catch (e) {
              reportError(e, 'Error loading group data');
              if (mySeq === seq) setGroupData(null);
            } finally {
              if (mySeq === seq) setLoading(false);
            }
          },
          (e) => {
            // After sign-out the listener can drop with permission-denied;
            // that's only a real error while someone is still signed in.
            if (auth().currentUser) {
              reportError(e, 'Error watching user doc');
            }
            setLoading(false);
          },
        );
    });
    return () => {
      if (unsubUser) unsubUser();
      unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    try {
      await auth().signInWithEmailAndPassword(email, password);
    } catch (error: any) {
      // If user not found, try creating account
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        throw error;
      }
      reportError(error, 'Email Sign-In Error');
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    try {
      await auth().createUserWithEmailAndPassword(email, password);
    } catch (error) {
      reportError(error, 'Email Sign-Up Error');
      throw error;
    }
  };

  const signInWithGoogle = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('No idToken received');
      const googleCredential = auth.GoogleAuthProvider.credential(idToken);
      await auth().signInWithCredential(googleCredential);
    } catch (error) {
      reportError(error, 'Google Sign-In Error');
      throw error;
    }
  };

  const signInWithApple = async () => {
    try {
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
      });

      const { identityToken, nonce } = appleAuthRequestResponse;
      if (!identityToken) throw new Error('No identityToken received from Apple');

      const appleCredential = auth.AppleAuthProvider.credential(identityToken, nonce);
      const userCredential = await auth().signInWithCredential(appleCredential);

      // Apple only sends the name on the first sign-in, so update profile if available
      const fullName = appleAuthRequestResponse.fullName;
      if (fullName && (fullName.givenName || fullName.familyName)) {
        const displayName = [fullName.givenName, fullName.familyName].filter(Boolean).join(' ');
        if (displayName && !userCredential.user.displayName) {
          await userCredential.user.updateProfile({ displayName });
        }
      }
    } catch (error: any) {
      if (error.code === appleAuth.Error.CANCELED) {
        // User cancelled, don't throw
        return;
      }
      reportError(error, 'Apple Sign-In Error');
      throw error;
    }
  };

  const signOut = async () => {
    try {
      // Clear user first to unmount StoreSync and detach Firestore listeners
      // BEFORE Firebase auth signs out (avoids permission-denied crashes)
      setUser(null);
      setGroupData(null);
      // Wait for React to process the unmount
      await new Promise((r) => setTimeout(r, 100));
      await GoogleSignin.signOut().catch(() => {});
      await auth().signOut();
    } catch (error) {
      reportError(error, 'Sign-Out Error');
    }
  };

  const deleteAccount = async () => {
    const currentUser = auth().currentUser;
    if (!currentUser) throw new Error('No user logged in');

    const uid = currentUser.uid;

    // Delete every doc of `col` matching `field == value` that passes the
    // filter, in batches under Firestore's 500-write cap.
    const deleteMatching = async (
      col: string,
      field: string,
      value: string,
      shouldDelete: (data: any) => boolean,
    ) => {
      const snap = await db.collection(col).where(field, '==', value).get();
      const refs = snap.docs.filter((d) => shouldDelete(d.data())).map((d) => d.ref);
      for (let i = 0; i < refs.length; i += 450) {
        const batch = db.batch();
        refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
    };

    try {
      const collections = ['clients', 'debts', 'transfers'];

      // 1. Family group: only the admin dissolves it and deletes its shared
      //    data. A member must NOT touch group data (it stays with the group)
      //    and must NOT leave before the deletions below — the security rules
      //    resolve scopes from users/{uid}, so leaving first revokes access
      //    mid-flight and the account is left half-deleted.
      if (groupData?.groupId && groupData.role === 'admin') {
        for (const col of collections) {
          await deleteMatching(col, 'groupId', groupData.groupId, () => true);
        }
        const membersSnap = await db
          .collection('users')
          .where('groupId', '==', groupData.groupId)
          .get();
        for (const doc of membersSnap.docs) {
          if (doc.id !== uid) {
            await db.collection('users').doc(doc.id).update({ groupId: null, role: null });
          }
        }
        await db.collection('groups').doc(groupData.groupId).delete();
      }

      // 2. Personal data: only unscoped docs. Docs scoped to a reparto or left
      //    behind in a group belong to that team and must survive (the rules
      //    deny deleting them anyway, which would abort the whole batch).
      for (const col of collections) {
        await deleteMatching(col, 'userId', uid, (data) => !data.groupId);
      }

      // 3. Per-user docs keyed by uid.
      await db.collection('settings').doc(uid).delete();
      await db.collection('aiUsage').doc(uid).delete();
      await db.collection('premiumOverrides').doc(uid).delete();
      for (const day of ALL_DAYS) {
        await db.collection('daily_loads').doc(`${uid}_${day}`).delete();
      }

      // 4. The user doc goes last: the rules read users/{uid} to resolve
      //    group/reparto scopes for everything above.
      try {
        await db.collection('users').doc(uid).delete();
      } catch {
        // If the deployed rules still forbid deleting user docs, scrub it so
        // no group/reparto references survive the account.
        await db.collection('users').doc(uid).set({});
      }

      // 5. Firebase Auth account.
      await currentUser.delete();
    } catch (error: any) {
      // If requires recent login, re-throw with specific message
      if (error.code === 'auth/requires-recent-login') {
        throw new Error('REQUIRES_RECENT_LOGIN');
      }
      throw error;
    }
  };

  const isAdmin = !groupData || groupData.role === 'admin';

  const getDataScope = () => {
    if (groupData?.groupId) {
      return { groupId: groupData.groupId };
    }
    return { userId: user?.uid || '' };
  };

  return {
    user,
    loading,
    groupData,
    isAdmin,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    signOut,
    deleteAccount,
    getDataScope,
    setGroupData,
  };
};
