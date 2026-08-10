import type { Firestore } from 'firebase-admin/firestore';
import { DataScopeMigrationError } from '../_shared/dataScopeMigrationService';
import { createMigrateDataScopesHandler } from '../migrate-data-scopes';

const MIGRATION_TOKEN = 'migration-token-abcdefghijklmnopqrstuvwxyz';
const VERSION_PROOF = 'version-proof-abcdefghijklmnopqrstuvwxyz';
const fakeDb = {} as Firestore;

const request = (
  method: string,
  body: unknown = {},
  token = MIGRATION_TOKEN,
) => new Request('https://rutawater-api.netlify.app/api/migrate-data-scopes', {
  method,
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: method === 'POST' ? JSON.stringify(body) : undefined,
});

const makeHandler = (
  options: {
    env?: Record<string, string | undefined>;
    operationOverrides?: Record<string, any>;
  } = {},
) => {
  const env = {
    DATA_SCOPE_MIGRATION_TOKEN: MIGRATION_TOKEN,
    DATA_SCOPE_MINIMUM_APP_BUILD: 'policy=1;ios>=55;android>=22',
    DATA_SCOPE_MINIMUM_VERSION_PROOF: VERSION_PROOF,
    DATA_SCOPE_COMPATIBILITY_POLICY_VERSION: '1',
    DATA_SCOPE_MINIMUM_IOS_BUILD: '55',
    DATA_SCOPE_MINIMUM_ANDROID_BUILD: '22',
    DATA_SCOPE_COMPATIBILITY_MAX_AGE_DAYS: '30',
    DATA_SCOPE_IRREVERSIBLE_ACTIONS_ENABLED: 'true',
    ...options.env,
  };
  const operations = {
    status: jest.fn(async () => ({ phase: 'audit' })),
    compatibility: jest.fn(async () => ({
      eligible: 9,
      compatible: 9,
      missing: 0,
      incompatible: 0,
      stale: 0,
      policyMismatch: 0,
      overflow: 0,
      inactiveAccounts: 0,
      blockedAccounts: 0,
      readyForCutover: true,
    })),
    advance: jest.fn(async () => ({ phase: 'ready_to_seal' })),
    seal: jest.fn(async () => ({ phase: 'sealed_audit' })),
    restartAudit: jest.fn(async () => ({ phase: 'backfill' })),
    activateUser: jest.fn(async () => ({ uid: 'user-1', scopeReadVersion: 1 })),
    activateBatch: jest.fn(async () => ({ activation: { complete: false } })),
    restartActivation: jest.fn(async () => ({ activation: { complete: false } })),
    finalizeActivation: jest.fn(async () => ({ readVersion: 1 })),
    ...options.operationOverrides,
  };
  const dependencies = {
    readEnvironment: jest.fn((name: string) => env[name as keyof typeof env]),
    getFirestore: jest.fn(() => fakeDb),
    operations,
  };
  return {
    handler: createMigrateDataScopesHandler(dependencies as any),
    dependencies,
    operations,
  };
};

describe('migrate-data-scopes Netlify Function', () => {
  test('rejects unsupported methods, invalid actions and bad operator tokens before Firestore', async () => {
    const { handler, dependencies } = makeHandler();
    expect((await handler(request('GET'))).status).toBe(405);
    expect((await handler(request('POST', { action: 'status' }, 'short'))).status).toBe(401);
    expect((await handler(request('POST', { action: 'destroy' }))).status).toBe(400);
    expect(dependencies.getFirestore).not.toHaveBeenCalled();
  });

  test('keeps seal closed when either server-owned build or proof configuration is missing', async () => {
    const noBuild = makeHandler({ env: { DATA_SCOPE_MINIMUM_APP_BUILD: '' } });
    const noProof = makeHandler({ env: { DATA_SCOPE_MINIMUM_VERSION_PROOF: 'too-short' } });
    const wrongProof = makeHandler();

    for (const response of [
      await noBuild.handler(request('POST', { action: 'seal', minimumVersionProof: VERSION_PROOF })),
      await noProof.handler(request('POST', { action: 'seal', minimumVersionProof: VERSION_PROOF })),
      await wrongProof.handler(request('POST', {
        action: 'seal',
        minimumVersionProof: `${VERSION_PROOF}-wrong`,
        minimumVersionEnforced: true,
        minimumAppBuild: 'spoofed',
      })),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        status: 'error',
        code: 'MIGRATION_SEAL_GATE_CLOSED',
      });
    }
    expect(noBuild.dependencies.getFirestore).not.toHaveBeenCalled();
    expect(noProof.dependencies.getFirestore).not.toHaveBeenCalled();
    expect(wrongProof.operations.seal).not.toHaveBeenCalled();
  });

  test('uses only the configured build and timing-safe proof result when sealing', async () => {
    const { handler, operations } = makeHandler();
    const response = await handler(request('POST', {
      action: 'seal',
      minimumVersionProof: VERSION_PROOF,
      minimumVersionEnforced: false,
      minimumAppBuild: 'attacker-body-build',
    }));

    expect(response.status).toBe(200);
    expect(operations.seal).toHaveBeenCalledWith(fakeDb, {
      serverProofVerified: true,
      minimumAppBuild: 'policy=1;ios>=55;android>=22',
    });
    expect(JSON.stringify(await response.json())).not.toContain(VERSION_PROOF);
  });

  test('reports adoption coverage and blocks irreversible actions when it is incomplete', async () => {
    const blocked = makeHandler({
      operationOverrides: {
        compatibility: jest.fn(async () => ({
          eligible: 9,
          compatible: 8,
          missing: 1,
          incompatible: 0,
          stale: 0,
          policyMismatch: 0,
          overflow: 0,
          inactiveAccounts: 0,
          blockedAccounts: 0,
          readyForCutover: false,
        })),
      },
    });
    const status = await blocked.handler(request('POST', { action: 'status' }));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      compatibility: {
        configured: true,
        minimumBuilds: { ios: 55, android: 22 },
        irreversibleActionsEnabled: true,
        compatible: 8,
        missing: 1,
        readyForCutover: false,
      },
    });

    for (const action of ['seal', 'activate_user', 'activate_batch', 'finalize_activation']) {
      const body = action === 'seal' || action === 'finalize_activation'
        ? { action, minimumVersionProof: VERSION_PROOF }
        : { action };
      const response = await blocked.handler(request('POST', body));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        status: 'error',
        code: 'APP_ADOPTION_NOT_VERIFIED',
      });
    }
    expect(blocked.operations.seal).not.toHaveBeenCalled();
    expect(blocked.operations.activateUser).not.toHaveBeenCalled();
    expect(blocked.operations.activateBatch).not.toHaveBeenCalled();
    expect(blocked.operations.finalizeActivation).not.toHaveBeenCalled();
  });

  test('keeps the adoption gate closed when the server policy is incomplete', async () => {
    const { handler, operations } = makeHandler({
      env: { DATA_SCOPE_MINIMUM_IOS_BUILD: '' },
    });
    const response = await handler(request('POST', { action: 'activate_user', uid: 'user-1' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: 'error',
      code: 'APP_ADOPTION_NOT_VERIFIED',
    });
    expect(operations.compatibility).not.toHaveBeenCalled();
    expect(operations.activateUser).not.toHaveBeenCalled();
  });

  test('keeps irreversible actions disabled while heartbeat evidence is being collected', async () => {
    const { handler, operations } = makeHandler({
      env: { DATA_SCOPE_IRREVERSIBLE_ACTIONS_ENABLED: 'false' },
    });
    const status = await handler(request('POST', { action: 'status' }));
    expect(await status.json()).toMatchObject({
      compatibility: { irreversibleActionsEnabled: false },
    });
    expect(operations.compatibility).toHaveBeenCalledTimes(1);
    operations.compatibility.mockClear();

    for (const action of ['seal', 'activate_user', 'activate_batch', 'finalize_activation']) {
      const response = await handler(request('POST', {
        action,
        minimumVersionProof: VERSION_PROOF,
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        status: 'error',
        code: 'IRREVERSIBLE_ACTIONS_DISABLED',
      });
    }
    expect(operations.compatibility).not.toHaveBeenCalled();
    expect(operations.seal).not.toHaveBeenCalled();
    expect(operations.activateUser).not.toHaveBeenCalled();
    expect(operations.activateBatch).not.toHaveBeenCalled();
    expect(operations.finalizeActivation).not.toHaveBeenCalled();
  });

  test('dispatches resumable activation actions and requires the proof again for global cutover', async () => {
    const { handler, operations } = makeHandler();
    await handler(request('POST', { action: 'activate_batch', pageSize: 25 }));
    await handler(request('POST', { action: 'restart_activation' }));
    const denied = await handler(request('POST', { action: 'finalize_activation' }));
    const finalized = await handler(request('POST', {
      action: 'finalize_activation', minimumVersionProof: VERSION_PROOF,
    }));

    expect(operations.activateBatch).toHaveBeenCalledWith(fakeDb, { pageSize: 25 });
    expect(operations.restartActivation).toHaveBeenCalledWith(fakeDb);
    expect(denied.status).toBe(403);
    expect(finalized.status).toBe(200);
    expect(operations.finalizeActivation).toHaveBeenCalledWith(fakeDb, {
      serverProofVerified: true,
    });
  });

  test('returns stable conflict codes and never exposes backend error details', async () => {
    const busy = makeHandler({
      operationOverrides: {
        advance: jest.fn(async () => {
          throw new DataScopeMigrationError('MIGRATION_BUSY', 'private lease token');
        }),
      },
    });
    const response = await busy.handler(request('POST', { action: 'advance' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'error', code: 'MIGRATION_BUSY' });
  });
});
