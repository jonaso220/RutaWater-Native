import type { Config } from '@netlify/functions';
import { verifyFirebaseIdToken } from './_shared/firebaseAuth';
import { getAdminAuth, getAdminFirestore } from './_shared/firebaseAdmin';
import {
  allowJoinAttempt,
  confirmJoinAuthUser,
  createJoinEndpointHandler,
} from './_shared/joinEndpoint';
import { joinGroupByCode } from './_shared/joinService';

const { resolveAiPlan } = require('./_shared/aiQuota');

export const createJoinGroupHandler = createJoinEndpointHandler;

export default createJoinGroupHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  verifyToken: verifyFirebaseIdToken,
  getAuth: getAdminAuth,
  getAuthUser: confirmJoinAuthUser,
  allowAttempt: allowJoinAttempt,
  getFirestore: getAdminFirestore,
  authorize: async ({ db, uid, readEnvironment }) => (
    await resolveAiPlan({ db, uid, readEnvironment })
  ) !== 'free',
  join: joinGroupByCode,
  logLabel: 'join-group',
});

export const config: Config = {
  path: '/api/join-group',
};
