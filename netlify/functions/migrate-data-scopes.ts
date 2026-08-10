import { timingSafeEqual } from 'crypto';
import type { Config } from '@netlify/functions';
import type { Firestore } from 'firebase-admin/firestore';
import { getAppCompatibilityCoverage } from './_shared/appCompatibilityService';
import {
  appCompatibilityPolicyLabel,
  readAppCompatibilityPolicy,
} from './_shared/appCompatibilityPolicy';
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
  compatibility: typeof getAppCompatibilityCoverage;
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
  compatibility: getAppCompatibilityCoverage,
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

    const requiresCompatibilityGate = [
      'seal',
      'activate_user',
      'activate_batch',
      'finalize_activation',
    ].includes(action);
    const irreversibleActionsEnabled =
      dependencies.readEnvironment('DATA_SCOPE_IRREVERSIBLE_ACTIONS_ENABLED') === 'true';
    if (requiresCompatibilityGate && !irreversibleActionsEnabled) {
      return json(409, {
        status: 'error',
        code: 'IRREVERSIBLE_ACTIONS_DISABLED',
      });
    }
    const compatibilityPolicy = readAppCompatibilityPolicy(dependencies.readEnvironment);

    let serverProofVerified = false;
    let minimumAppBuild = '';
    if (action === 'seal' || action === 'finalize_activation') {
      const configuredMinimumAppBuild =
        dependencies.readEnvironment('DATA_SCOPE_MINIMUM_APP_BUILD')?.trim() || '';
      minimumAppBuild = compatibilityPolicy
        ? appCompatibilityPolicyLabel(compatibilityPolicy)
        : '';
      serverProofVerified = Boolean(minimumAppBuild)
        && configuredMinimumAppBuild === minimumAppBuild
        && secureSecretMatches(
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
      const compatibility = action === 'status' || requiresCompatibilityGate
        ? compatibilityPolicy
          ? await operations.compatibility(db, compatibilityPolicy)
          : null
        : null;
      if (action === 'status') {
        return json(200, {
          status: 'ok',
          migration: await operations.status(db),
          compatibility: compatibilityPolicy && compatibility
            ? {
              configured: true,
              policyVersion: compatibilityPolicy.policyVersion,
              minimumBuilds: compatibilityPolicy.minimumBuilds,
              ...compatibility,
              signalCoverageComplete: compatibility.readyForCutover,
              irreversibleActionsEnabled,
              readyForCutover:
                irreversibleActionsEnabled && compatibility.readyForCutover,
            }
            : {
              configured: false,
              signalCoverageComplete: false,
              irreversibleActionsEnabled,
              readyForCutover: false,
            },
        });
      }
      if (
        requiresCompatibilityGate
        && (!compatibilityPolicy || !compatibility?.readyForCutover)
      ) {
        return json(409, {
          status: 'error',
          code: 'APP_ADOPTION_NOT_VERIFIED',
        });
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
