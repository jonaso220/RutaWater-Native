import { timingSafeEqual } from 'crypto';
import type { Config } from '@netlify/functions';
import type { Firestore } from 'firebase-admin/firestore';
import { EnvironmentReader, getAdminFirestore } from './_shared/firebaseAdmin';
import {
  activateStrictScopeReadsForUser,
  advanceDataScopeMigration,
  advanceStrictScopeActivation,
  DataScopeMigrationError,
  finalizeStrictScopeActivation,
  getDataScopeMigrationStatus,
  restartDataScopeAudit,
  restartStrictScopeActivation,
  sealDataScopeWrites,
} from './_shared/dataScopeMigrationService';

type MigrationAction =
  | 'status'
  | 'advance'
  | 'seal'
  | 'restart_audit'
  | 'activate_user'
  | 'activate_batch'
  | 'restart_activation'
  | 'finalize_activation';

interface MigrationOperations {
  status: typeof getDataScopeMigrationStatus;
  advance: typeof advanceDataScopeMigration;
  seal: typeof sealDataScopeWrites;
  restartAudit: typeof restartDataScopeAudit;
  activateUser: typeof activateStrictScopeReadsForUser;
  activateBatch: typeof advanceStrictScopeActivation;
  restartActivation: typeof restartStrictScopeActivation;
  finalizeActivation: typeof finalizeStrictScopeActivation;
}

interface HandlerDependencies {
  readEnvironment: EnvironmentReader;
  getFirestore: (reader: EnvironmentReader) => Firestore;
  operations?: MigrationOperations;
}

const json = (status: number, body: Record<string, unknown>) => new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const secureSecretMatches = (
  expected: string | undefined,
  supplied: string,
): boolean => {
  if (!expected || expected.length < 32) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
};

const bearerToken = (request: Request): string =>
  /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';

const DEFAULT_OPERATIONS: MigrationOperations = {
  status: getDataScopeMigrationStatus,
  advance: advanceDataScopeMigration,
  seal: sealDataScopeWrites,
  restartAudit: restartDataScopeAudit,
  activateUser: activateStrictScopeReadsForUser,
  activateBatch: advanceStrictScopeActivation,
  restartActivation: restartStrictScopeActivation,
  finalizeActivation: finalizeStrictScopeActivation,
};

export const createMigrateDataScopesHandler = (dependencies: HandlerDependencies) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { status: 'error', code: 'METHOD_NOT_ALLOWED' });
    if (!secureSecretMatches(
      dependencies.readEnvironment('DATA_SCOPE_MIGRATION_TOKEN'),
      bearerToken(request),
    )) {
      return json(401, { status: 'error', code: 'UNAUTHORIZED' });
    }
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json(400, { status: 'error', code: 'INVALID_JSON' });
    }

    const action = body.action as MigrationAction;
    if (![
      'status',
      'advance',
      'seal',
      'restart_audit',
      'activate_user',
      'activate_batch',
      'restart_activation',
      'finalize_activation',
    ].includes(action)) {
      return json(400, { status: 'error', code: 'ACTION_INVALID' });
    }

    let serverProofVerified = false;
    let minimumAppBuild = '';
    if (action === 'seal' || action === 'finalize_activation') {
      minimumAppBuild = dependencies.readEnvironment('DATA_SCOPE_MINIMUM_APP_BUILD')?.trim() || '';
      serverProofVerified = Boolean(minimumAppBuild) && secureSecretMatches(
        dependencies.readEnvironment('DATA_SCOPE_MINIMUM_VERSION_PROOF'),
        typeof body.minimumVersionProof === 'string' ? body.minimumVersionProof : '',
      );
      if (!serverProofVerified) {
        // One closed response covers missing/malformed server configuration and
        // a wrong proof, without disclosing which secret/config value failed.
        return json(403, { status: 'error', code: 'MIGRATION_SEAL_GATE_CLOSED' });
      }
    }

    const operations = dependencies.operations || DEFAULT_OPERATIONS;
    try {
      const db = dependencies.getFirestore(dependencies.readEnvironment);
      if (action === 'status') {
        return json(200, { status: 'ok', migration: await operations.status(db) });
      }
      if (action === 'advance') {
        return json(200, { status: 'ok', migration: await operations.advance(db) });
      }
      if (action === 'seal') {
        return json(200, {
          status: 'ok',
          migration: await operations.seal(db, {
            serverProofVerified,
            minimumAppBuild,
          }),
        });
      }
      if (action === 'restart_audit') {
        return json(200, { status: 'ok', migration: await operations.restartAudit(db) });
      }
      if (action === 'activate_user') {
        return json(200, {
          status: 'ok',
          activation: await operations.activateUser(
            db,
            typeof body.uid === 'string' ? body.uid : '',
          ),
        });
      }
      if (action === 'activate_batch') {
        return json(200, {
          status: 'ok',
          migration: await operations.activateBatch(db, {
            pageSize: typeof body.pageSize === 'number' ? body.pageSize : undefined,
          }),
        });
      }
      if (action === 'restart_activation') {
        return json(200, {
          status: 'ok',
          migration: await operations.restartActivation(db),
        });
      }
      return json(200, {
        status: 'ok',
        migration: await operations.finalizeActivation(db, { serverProofVerified }),
      });
    } catch (error) {
      const code = error instanceof DataScopeMigrationError ? error.code : 'SERVER_ERROR';
      if (code === 'SERVER_ERROR') {
        console.error(
          'migrate-data-scopes error:',
          error instanceof Error ? error.message : 'unknown',
        );
      }
      const status = code === 'MIGRATION_BUSY' ? 409
        : code === 'SERVER_ERROR' ? 500
          : 400;
      return json(status, { status: 'error', code });
    }
  };

export default createMigrateDataScopesHandler({
  readEnvironment: (name) => Netlify.env.get(name) || undefined,
  getFirestore: getAdminFirestore,
});

export const config: Config = {
  path: '/api/migrate-data-scopes',
  method: 'POST',
};
