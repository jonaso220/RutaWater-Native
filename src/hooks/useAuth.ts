import { useState, useEffect } from 'react';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { db } from '../config/firebase';
import { Group } from '../types';

// Configure Google Sign-In (webClientId from Firebase Console)
GoogleSignin.configure({
  webClientId: '882759838026-XXXXXXX.apps.googleusercontent.com', // TODO: Replace with actual web client ID from Firebase Console
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

  const signOut = async () => {
    try {
      await GoogleSignin.signOut();
      await auth().signOut();
    } catch (error) {
      console.error('Sign-Out Error:', error);
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
    signOut,
    getDataScope,
    setGroupData,
  };
};
