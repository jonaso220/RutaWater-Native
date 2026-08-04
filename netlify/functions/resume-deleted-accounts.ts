import type { Config } from '@netlify/functions';
import { resumeDeletedAccountJobs } from './_shared/accountDeletionWorkerService';
import { getAdminAuth, getAdminFirestore } from './_shared/firebaseAdmin';

const readEnvironment = (name: string): string | undefined =>
  Netlify.env.get(name) || undefined;

export default async function resumeDeletedAccounts(): Promise<Response> {
  const stats = await resumeDeletedAccountJobs({
    db: getAdminFirestore(readEnvironment),
    adminAuth: getAdminAuth(readEnvironment),
    maxJobs: 3,
    pageSize: 2,
    maxRuntimeMs: 24_000,
  });
  // Aggregate counts are useful operationally and contain no account IDs.
  console.log('resume-deleted-accounts:', stats);
  return new Response(null, { status: 204 });
}

export const config: Config = {
  // Hourly stays comfortably within the free invocation allowance while still
  // recovering a phone-side interruption without requiring another login.
  schedule: '17 * * * *',
};
