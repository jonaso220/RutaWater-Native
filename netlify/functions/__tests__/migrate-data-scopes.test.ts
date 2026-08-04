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
    DATA_SCOPE_MINIMUM_APP_BUILD: '1.48 (40)',
    DATA_SCOPE_MINIMUM_VERSION_PROOF: VERSION_PROOF,
    ...options.env,
  };
  const operations = {
    status: jest.fn(async () => ({ phase: 'audit' })),
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
      minimumAppBuild: '1.48 (40)',
    });
    expect(JSON.stringify(await response.json())).not.toContain(VERSION_PROOF);
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
