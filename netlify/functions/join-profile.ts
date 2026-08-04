import type { Config } from '@netlify/functions';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import { getAdminAuth, getAdminFirestore } from './_shared/firebaseAdmin';
import {
  allowJoinAttempt,
  confirmJoinAuthUser,
  createJoinEndpointHandler,
} from './_shared/joinEndpoint';
import { joinProfileByCode } from './_shared/joinService';

export const createJoinProfileHandler = createJoinEndpointHandler;

export default createJoinProfileHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getAuthUser: confirmJoinAuthUser,
  allowAttempt: allowJoinAttempt,
  getFirestore: getAdminFirestore,
  join: joinProfileByCode,
  logLabel: 'join-profile',
});

export const config: Config = {
  path: '/api/join-profile',
};
