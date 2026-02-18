import { useState, useEffect } from 'react';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { db } from '../config/firebase';
import { Group } from '../types';

// Configure Google Sign-In (webClientId from Firebase Console)
GoogleSignin.configure({
  webClientId: '882759838026-bqngl8jrk5kjmbue3p3gtp6ojse9c2m8.apps.googleusercontent.com', // TODO: Replace with actual web client ID from Firebase Console
});

export const useAuth = () => {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupData, setGroupData] = useState<Group | null>(null);

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await loadGroupData(firebaseUser.uid);
      } else {
        setGroupData(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const loadGroupData = async (uid: string) => {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        if (data?.groupId) {
          setGroupData({
            groupId: data.groupId,
            role: data.role || 'member',
            code: data.code || '',
          });
          return;
        }
      }
      setGroupData(null);
    } catch (e) {
      console.error('Error loading group data:', e);
      setGroupData(null);
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
      console.error('Google Sign-In Error:', error);
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
      console.error('Apple Sign-In Error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await GoogleSignin.signOut().catch(() => {});
      await auth().signOut();
    } catch (error) {
      console.error('Sign-Out Error:', error);
    }
  };

  const deleteAccount = async () => {
    const currentUser = auth().currentUser;
    if (!currentUser) throw new Error('No user logged in');

    const uid = currentUser.uid;
    const scope = groupData?.groupId
      ? { field: 'groupId', value: groupData.groupId }
      : { field: 'userId', value: uid };

    try {
      // If user is in a group, leave/dissolve it first
      if (groupData?.groupId) {
        if (groupData.role === 'admin') {
          // Admin: remove all members from group, delete group doc
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
        } else {
          // Member: just leave
          await db.collection('users').doc(uid).update({ groupId: null, role: null });
        }
      }

      // Delete user's data in batches
      const collections = ['clients', 'debts', 'transfers'];
      for (const col of collections) {
        let snap = await db
          .collection(col)
          .where(scope.field, '==', scope.value)
          .limit(450)
          .get();
        while (!snap.empty) {
          const batch = db.batch();
          snap.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
          snap = await db
            .collection(col)
            .where(scope.field, '==', scope.value)
            .limit(450)
            .get();
        }
      }

      // Delete user doc from Firestore
      await db.collection('users').doc(uid).delete();

      // Delete Firebase Auth account
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
    signInWithGoogle,
    signInWithApple,
    signOut,
    deleteAccount,
    getDataScope,
    setGroupData,
  };
};
