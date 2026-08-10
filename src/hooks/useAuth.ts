import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { reportError } from '../lib/crashReporting';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { db } from '../config/firebase';
import { Group } from '../types';
import { API_ENDPOINTS } from '../config/api';
import { logoutRevenueCatSession } from '../services/revenueCatSession';
import { cancelScheduledAlarmsForOwner } from '../services/notifications';
import { reportAppCompatibility } from '../services/appCompatibilityHeartbeat';
import { planSessionRetry } from '../utils/sessionRetry';

const MAX_GROUP_RECOVERY_ATTEMPTS = 5;

// Configure Google Sign-In (webClientId from Firebase Console)
GoogleSignin.configure({
  webClientId: '882759838026-bqngl8jrk5kjmbue3p3gtp6ojse9c2m8.apps.googleusercontent.com', // TODO: Replace with actual web client ID from Firebase Console
});

const ensureUserDocument = async (
  firebaseUser: FirebaseAuthTypes.User,
  displayNameOverride?: string,
): Promise<void> => {
  await db.collection('users').doc(firebaseUser.uid).set({
    email: firebaseUser.email || '',
    displayName: displayNameOverride ?? firebaseUser.displayName ?? '',
  }, { merge: true });
};

export const useAuth = () => {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupData, setGroupData] = useState<Group | null>(null);
  // Server-owned rollout gate for canonical scopeKey queries. Version 0 keeps
  // the published userId/groupId listeners; Admin enables v1 only after the
  // additive backfill and minimum-app-version gates are complete.
  const [userScopeReadVersion, setUserScopeReadVersion] = useState(0);
  const [globalScopeReadVersion, setGlobalScopeReadVersion] = useState(0);
  const scopeReadVersion = Math.max(userScopeReadVersion, globalScopeReadVersion);
  const [groupRecoveryRetryNonce, setGroupRecoveryRetryNonce] = useState(0);
  const groupRecoveryRetryCountRef = useRef(0);
  const groupRecoveryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authSessionUidRef = useRef<string | null>(null);

  // Listen to auth state changes + live group membership.
  useEffect(() => {
    let unsubUser: (() => void) | null = null;
    let unsubScopeConfig: (() => void) | null = null;
    let seq = 0;
    let legacyRecoveryAttemptedForUid: string | null = null;
    const unsubscribe = auth().onAuthStateChanged((firebaseUser) => {
      // Invalidate any group lookup still awaiting Firestore from the previous
      // auth session before changing visible account state.
      seq += 1;
      legacyRecoveryAttemptedForUid = null;
      const nextUid = firebaseUser?.uid || null;
      if (authSessionUidRef.current !== nextUid) {
        authSessionUidRef.current = nextUid;
        groupRecoveryRetryCountRef.current = 0;
        setUserScopeReadVersion(0);
        setGlobalScopeReadVersion(0);
      }
      if (groupRecoveryRetryTimerRef.current) {
        clearTimeout(groupRecoveryRetryTimerRef.current);
        groupRecoveryRetryTimerRef.current = null;
      }
      setUser(firebaseUser);
      if (unsubUser) {
        unsubUser();
        unsubUser = null;
      }
      if (unsubScopeConfig) {
        unsubScopeConfig();
        unsubScopeConfig = null;
      }
      if (!firebaseUser) {
        setGroupData(null);
        setUserScopeReadVersion(0);
        setGlobalScopeReadVersion(0);
        setLoading(false);
        return;
      }
      // Every authentication provider (including a restored session) gets an
      // own user document. Merge keeps all group/profile fields untouched and
      // repairs accounts created before this document became mandatory.
      const userRef = db.collection('users').doc(firebaseUser.uid);
      // After the guarded global cutover, accounts created in the future must
      // start on canonical queries even though clients are forbidden from
      // writing their own scopeReadVersion marker. This public config contains
      // only the server-owned version/build, never migration cursors or secrets.
      unsubScopeConfig = db.collection('appConfig').doc('dataScope').onSnapshot(
        (scopeConfig) => {
          setGlobalScopeReadVersion(scopeConfig.data()?.readVersion === 1 ? 1 : 0);
        },
        (e) => {
          if (auth().currentUser) reportError(e, 'Error watching data scope config');
          setGlobalScopeReadVersion(0);
        },
      );
      void ensureUserDocument(firebaseUser)
        .then(() => reportAppCompatibility(firebaseUser)
          .catch((e) => reportError(e, 'Error reporting app compatibility')))
        .catch((e) => reportError(e, 'Error ensuring user doc'));
      // Live subscription to users/{uid}: if the admin expels this user or
      // dissolves the group, the scope switches immediately. This used to be a
      // one-shot read, leaving the session frozen on the old group (listeners
      // in permission-denied, writes failing silently) until an app restart.
      unsubUser = userRef
        .onSnapshot(
          async (userDoc) => {
            const mySeq = ++seq;
            try {
              const data = userDoc.exists ? userDoc.data() : null;
              setUserScopeReadVersion(data?.scopeReadVersion === 1 ? 1 : 0);
              if (data?.groupId) {
                const groupDoc = await db.collection('groups').doc(data.groupId).get();
                if (mySeq !== seq) return; // a newer snapshot superseded this one

                // A stale users/{uid}.groupId used to install a phantom scope
                // when its descriptor had already disappeared. Clear only the
                // membership metadata; all business documents remain intact.
                if (!groupDoc.exists) {
                  setGroupData(null);
                  await userRef.update({ groupId: null, role: null });
                  return;
                }

                const canonicalRole = groupDoc.data()?.adminId === firebaseUser.uid
                  ? 'admin'
                  : 'member';
                setGroupData({
                  groupId: data.groupId,
                  // groups/{id}.adminId is canonical. This repairs legacy
                  // admins whose users doc never received role="admin", and
                  // prevents a stale role field from granting admin UI.
                  role: canonicalRole,
                  code: groupDoc.data()?.code || '',
                });
                if (data.role !== canonicalRole) {
                  await userRef.update({ role: canonicalRole });
                }
              } else {
                const accountState = data?.accountState || 'active';
                const hasRecoverableJoinFence = Boolean(data?.pendingGroupId)
                  && data?.groupMigrationState === 'join_preflight';
                const canAttemptLegacyRecovery = userDoc.exists
                  && accountState === 'active'
                  && data?.familyGroupRecoveryVersion !== 1
                  && (!data?.pendingGroupId || hasRecoverableJoinFence)
                  && groupRecoveryRetryCountRef.current < MAX_GROUP_RECOVERY_ATTEMPTS
                  && legacyRecoveryAttemptedForUid !== firebaseUser.uid;
                if (canAttemptLegacyRecovery) {
                  legacyRecoveryAttemptedForUid = firebaseUser.uid;
                  try {
                    const token = await firebaseUser.getIdToken();
                    const response = await fetch(API_ENDPOINTS.recoverFamilyGroup, {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                    });
                    const payload = await response.json().catch(() => ({})) as {
                      status?: string;
                    };
                    if (mySeq !== seq) return;
                    if (!response.ok) {
                      // Safety conflicts and disabled/deleting accounts are
                      // canonical outcomes. Only transient server failures are
                      // retried; nothing is ever inferred on the phone.
                      if (response.status >= 500) {
                        throw new Error('FAMILY_RECOVERY_TEMPORARILY_UNAVAILABLE');
                      }
                      groupRecoveryRetryCountRef.current = 0;
                      setGroupData(null);
                      return;
                    }
                    if (
                      payload.status === 'recovered' || payload.status === 'already'
                    ) {
                      // The Admin transaction already repaired users/{uid}.
                      // Read it once for a deterministic first render; the live
                      // listener remains canonical for every later change.
                      const repairedUser = await userRef.get();
                      const repairedGroupId = repairedUser.data()?.groupId;
                      if (mySeq !== seq) return;
                      if (typeof repairedGroupId === 'string' && repairedGroupId) {
                        const recoveredGroup = await db
                          .collection('groups')
                          .doc(repairedGroupId)
                          .get();
                        if (mySeq !== seq) return;
                        if (recoveredGroup.exists) {
                          setGroupData({
                            groupId: repairedGroupId,
                            role: recoveredGroup.data()?.adminId === firebaseUser.uid
                              ? 'admin'
                              : 'member',
                            code: recoveredGroup.data()?.code || '',
                          });
                          groupRecoveryRetryCountRef.current = 0;
                          return;
                        }
                      }
                    }
                    groupRecoveryRetryCountRef.current = 0;
                  } catch (recoveryError) {
                    // Recovery is a compatibility repair only. Offline or
                    // backend failure must never alter/clear customer data or
                    // prevent the normal personal scope from loading.
                    if (mySeq !== seq) return;
                    reportError(recoveryError, 'Legacy family recovery error');
                    const retryPlan = planSessionRetry(
                      groupRecoveryRetryCountRef.current,
                      MAX_GROUP_RECOVERY_ATTEMPTS,
                    );
                    groupRecoveryRetryCountRef.current = retryPlan.attemptCount;
                    if (!retryPlan.shouldSchedule) return;
                    legacyRecoveryAttemptedForUid = null;
                    groupRecoveryRetryTimerRef.current = setTimeout(() => {
                      groupRecoveryRetryTimerRef.current = null;
                      setGroupRecoveryRetryNonce((value) => value + 1);
                    }, retryPlan.delayMs);
                  }
                }
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
      // Invalidate a token request or Admin recovery response that outlives
      // this listener generation (retry, foreground reset, or unmount).
      seq += 1;
      if (groupRecoveryRetryTimerRef.current) {
        clearTimeout(groupRecoveryRetryTimerRef.current);
        groupRecoveryRetryTimerRef.current = null;
      }
      if (unsubUser) unsubUser();
      if (unsubScopeConfig) unsubScopeConfig();
      unsubscribe();
    };
  }, [groupRecoveryRetryNonce]);

  // A foreground transition is an explicit new recovery window. This makes a
  // temporarily offline session recover on resume without leaving an
  // unbounded background timer running indefinitely.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const currentUser = auth().currentUser;
      if (currentUser) {
        void reportAppCompatibility(currentUser)
          .catch((e) => reportError(e, 'Error refreshing app compatibility'));
      }
      groupRecoveryRetryCountRef.current = 0;
      if (groupRecoveryRetryTimerRef.current) {
        clearTimeout(groupRecoveryRetryTimerRef.current);
        groupRecoveryRetryTimerRef.current = null;
      }
      setGroupRecoveryRetryNonce((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    try {
      const credential = await auth().signInWithEmailAndPassword(email, password);
      await ensureUserDocument(credential.user);
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
      const credential = await auth().createUserWithEmailAndPassword(email, password);
      // Do not resolve registration before its authorization document exists.
      // The auth listener also backfills every provider/restored session, but
      // awaiting here closes the first-render race for email sign-ups.
      await ensureUserDocument(credential.user);
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
      const userCredential = await auth().signInWithCredential(googleCredential);
      await ensureUserDocument(userCredential.user);
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
      let finalDisplayName = userCredential.user.displayName || '';

      // Apple only sends the name on the first sign-in, so update profile if available
      const fullName = appleAuthRequestResponse.fullName;
      if (fullName && (fullName.givenName || fullName.familyName)) {
        const displayName = [fullName.givenName, fullName.familyName].filter(Boolean).join(' ');
        if (displayName && !userCredential.user.displayName) {
          await userCredential.user.updateProfile({ displayName });
          finalDisplayName = displayName;
        }
      }
      await ensureUserDocument(userCredential.user, finalDisplayName);
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
      const signingOutUserId = auth().currentUser?.uid;
      // RevenueCat is process-wide. Detach the current Firebase UID before the
      // subscription hook unmounts so the next local account cannot inherit
      // CustomerInfo or introductory-offer eligibility from this session.
      await logoutRevenueCatSession()
        .catch((e) => reportError(e, 'RevenueCat Sign-Out Error'));
      if (signingOutUserId) {
        await cancelScheduledAlarmsForOwner(signingOutUserId, true)
          .catch((e) => reportError(e, 'Alarm Sign-Out Cleanup Error'));
      }
      // Clear user first to unmount StoreSync and detach Firestore listeners
      // BEFORE Firebase auth signs out (avoids permission-denied crashes)
      setUser(null);
      setGroupData(null);
      setUserScopeReadVersion(0);
      setGlobalScopeReadVersion(0);
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

    // A forced refresh is preferred, but a still-valid cached token can resume
    // the durable server job after Firebase Auth itself has already gone.
    let tokenResult: FirebaseAuthTypes.IdTokenResult;
    try {
      tokenResult = await currentUser.getIdTokenResult(true);
    } catch (refreshError) {
      // If a previous server attempt deleted Auth but its response/Firestore
      // tail failed, Firebase cannot mint a new token. The still-cached signed
      // token can safely resume the idempotent cleanup; the endpoint validates
      // its signature, expiry, auth_time, and uid again before doing anything.
      try {
        tokenResult = await currentUser.getIdTokenResult(false);
      } catch {
        throw refreshError;
      }
    }
    const cleanupToken = tokenResult.token;

    const callAccountCleanup = async (preflight: boolean) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(API_ENDPOINTS.cleanupDeletedAccount, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cleanupToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ preflight }),
          });
          if (response.ok) return;
          const payload = await response.json().catch(() => ({})) as { code?: string };
          if (payload.code === 'RECENT_LOGIN_REQUIRED') {
            throw new Error('REQUIRES_RECENT_LOGIN');
          }
          if (payload.code === 'SHARED_SCOPE_CHANGED') {
            throw new Error('SHARED_SCOPE_CHANGED');
          }
          throw new Error(`Account cleanup failed (${response.status})`);
        } catch (error) {
          lastError = error;
          if (
            error instanceof Error
            && ['REQUIRES_RECENT_LOGIN', 'SHARED_SCOPE_CHANGED'].includes(error.message)
          ) {
            throw error;
          }
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
      }
      throw lastError || new Error('Account cleanup failed');
    };

    try {
      // Preflight confirms server time plus Admin Auth/Firestore permissions,
      // or authorizes resuming an already-created durable deletion job even
      // when the original login is now older than the new-job limit.
      // The final call owns all membership planning, successor validation, and
      // deletion. The phone performs no destructive Firestore writes, so a
      // network/configuration failure cannot erase customer data first.
      await callAccountCleanup(true);
      await callAccountCleanup(false);

      // Admin deletion does not synchronously evict the SDK's cached token.
      // Clear UI state and the local provider sessions explicitly so no stale
      // authenticated screen or residual write window remains.
      await logoutRevenueCatSession()
        .catch((e) => reportError(e, 'Post-delete RevenueCat sign-out error'));
      await cancelScheduledAlarmsForOwner(currentUser.uid, true)
        .catch((e) => reportError(e, 'Post-delete alarm cleanup error'));
      setUser(null);
      setGroupData(null);
      setUserScopeReadVersion(0);
      setGlobalScopeReadVersion(0);
      await GoogleSignin.signOut().catch(() => {});
      await auth().signOut().catch((e) => reportError(e, 'Post-delete local sign-out error'));
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
    scopeReadVersion,
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
