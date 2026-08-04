import { randomUUID } from 'crypto';
import {
  FieldPath,
  Firestore,
  Timestamp,
} from 'firebase-admin/firestore';
import {
  backfillDataScopePage,
  DATA_SCOPE_COLLECTIONS,
} from './dataScopeBackfillService';

const MIGRATION_PATH = 'systemMigrations/dataScopeV1';
const PUBLIC_SCOPE_CONFIG_PATH = 'appConfig/dataScope';
const LEASE_MS = 90_000;
const DEFAULT_ACTIVATION_PAGE_SIZE = 200;
const MAX_ACTIVATION_PAGE_SIZE = 400;

export type DataScopeMigrationPhase =
  | 'backfill'
  | 'audit'
  | 'ready_to_seal'
  | 'sealed_audit'
  | 'verified'
  | 'blocked';

export class DataScopeMigrationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DataScopeMigrationError';
  }
}

interface MigrationState {
  phase: DataScopeMigrationPhase;
  collectionIndex: number;
  cursor: string | null;
  auditNeedsUpdate: number;
  auditMalformed: number;
  orphanedScopes: number;
  writeVersion: number;
  readVersion: number;
  leaseToken?: string;
  leaseExpiresAt?: Timestamp;
  minimumAppBuild?: string;
  activationCursor: string | null;
  activationScanned: number;
  activationEligible: number;
  activationActivated: number;
  activationAlreadyActive: number;
  activationSkippedInactive: number;
  activationBlocked: number;
  activationComplete: boolean;
}

const initialState = (): MigrationState => ({
  phase: 'backfill',
  collectionIndex: 0,
  cursor: null,
  auditNeedsUpdate: 0,
  auditMalformed: 0,
  orphanedScopes: 0,
  writeVersion: 0,
  readVersion: 0,
  activationCursor: null,
  activationScanned: 0,
  activationEligible: 0,
  activationActivated: 0,
  activationAlreadyActive: 0,
  activationSkippedInactive: 0,
  activationBlocked: 0,
  activationComplete: false,
});

const countFrom = (value: unknown): number => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const stateFrom = (data: Record<string, any> | undefined): MigrationState => ({
  phase: data?.phase || 'backfill',
  collectionIndex: Number.isInteger(data?.collectionIndex) ? data.collectionIndex : 0,
  cursor: typeof data?.cursor === 'string' && data.cursor ? data.cursor : null,
  auditNeedsUpdate: countFrom(data?.auditNeedsUpdate),
  auditMalformed: countFrom(data?.auditMalformed),
  orphanedScopes: countFrom(data?.orphanedScopes),
  writeVersion: data?.writeVersion === 1 ? 1 : 0,
  readVersion: data?.readVersion === 1 ? 1 : 0,
  leaseToken: typeof data?.leaseToken === 'string' ? data.leaseToken : undefined,
  leaseExpiresAt: data?.leaseExpiresAt instanceof Timestamp ? data.leaseExpiresAt : undefined,
  minimumAppBuild: typeof data?.minimumAppBuild === 'string'
    ? data.minimumAppBuild
    : undefined,
  activationCursor: typeof data?.activationCursor === 'string' && data.activationCursor
    ? data.activationCursor
    : null,
  activationScanned: countFrom(data?.activationScanned),
  activationEligible: countFrom(data?.activationEligible),
  activationActivated: countFrom(data?.activationActivated),
  activationAlreadyActive: countFrom(data?.activationAlreadyActive),
  activationSkippedInactive: countFrom(data?.activationSkippedInactive),
  activationBlocked: countFrom(data?.activationBlocked),
  activationComplete: data?.activationComplete === true,
});

const publicState = (state: MigrationState) => ({
  phase: state.phase,
  collection: DATA_SCOPE_COLLECTIONS[state.collectionIndex] || null,
  cursor: state.cursor,
  auditNeedsUpdate: state.auditNeedsUpdate,
  auditMalformed: state.auditMalformed,
  orphanedScopes: state.orphanedScopes,
  writeVersion: state.writeVersion,
  readVersion: state.readVersion,
  minimumAppBuild: state.minimumAppBuild || null,
  activation: {
    cursor: state.activationCursor,
    scanned: state.activationScanned,
    eligible: state.activationEligible,
    activated: state.activationActivated,
    alreadyActive: state.activationAlreadyActive,
    skippedInactive: state.activationSkippedInactive,
    blocked: state.activationBlocked,
    complete: state.activationComplete,
  },
});

const persistedState = (state: MigrationState): Record<string, unknown> => ({
  phase: state.phase,
  collectionIndex: state.collectionIndex,
  cursor: state.cursor,
  auditNeedsUpdate: state.auditNeedsUpdate,
  auditMalformed: state.auditMalformed,
  orphanedScopes: state.orphanedScopes,
  writeVersion: state.writeVersion,
  readVersion: state.readVersion,
  activationCursor: state.activationCursor,
  activationScanned: state.activationScanned,
  activationEligible: state.activationEligible,
  activationActivated: state.activationActivated,
  activationAlreadyActive: state.activationAlreadyActive,
  activationSkippedInactive: state.activationSkippedInactive,
  activationBlocked: state.activationBlocked,
  activationComplete: state.activationComplete,
  ...(state.minimumAppBuild ? { minimumAppBuild: state.minimumAppBuild } : {}),
});

const resetActivation = (state: MigrationState): MigrationState => ({
  ...state,
  activationCursor: null,
  activationScanned: 0,
  activationEligible: 0,
  activationActivated: 0,
  activationAlreadyActive: 0,
  activationSkippedInactive: 0,
  activationBlocked: 0,
  activationComplete: false,
});

const workPhase = (phase: DataScopeMigrationPhase): boolean =>
  phase === 'backfill' || phase === 'audit' || phase === 'sealed_audit';

const hasLiveLease = (state: MigrationState, now: number): boolean =>
  Boolean(state.leaseToken && (state.leaseExpiresAt?.toMillis() || 0) > now);

const assertVerified = (state: MigrationState) => {
  if (
    state.phase !== 'verified'
    || state.writeVersion !== 1
    || state.auditNeedsUpdate !== 0
    || state.auditMalformed !== 0
    || state.orphanedScopes !== 0
  ) {
    throw new DataScopeMigrationError('MIGRATION_NOT_VERIFIED', 'El audit sellado no terminó.');
  }
};

type ActivationEligibility = 'eligible' | 'inactive' | 'blocked';

const activationEligibility = (user: Record<string, any>): ActivationEligibility => {
  const accountState = user.accountState;
  if (accountState === 'deleting' || accountState === 'deleted') return 'inactive';
  if (accountState !== undefined && accountState !== null && accountState !== 'active') {
    return 'blocked';
  }
  if (
    (typeof user.pendingGroupId === 'string' && user.pendingGroupId.trim().length > 0)
    || (user.pendingGroupId !== undefined && user.pendingGroupId !== null
      && typeof user.pendingGroupId !== 'string')
    || (typeof user.groupMigrationState === 'string' && user.groupMigrationState.length > 0)
  ) return 'blocked';
  return 'eligible';
};

const releaseOwnedLease = async (
  db: Firestore,
  leaseToken: string,
): Promise<void> => {
  const migrationRef = db.doc(MIGRATION_PATH);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(migrationRef);
    if (stateFrom(snapshot.data()).leaseToken !== leaseToken) return;
    transaction.set(migrationRef, {
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorAt: Timestamp.now(),
    }, { merge: true });
  }).catch(() => {});
};

export const getDataScopeMigrationStatus = async (db: Firestore) => {
  const snapshot = await db.doc(MIGRATION_PATH).get();
  return publicState(stateFrom(snapshot.data()));
};

/** Processes one bounded, idempotent page and checkpoints it. */
export const advanceDataScopeMigration = async (db: Firestore) => {
  const migrationRef = db.doc(MIGRATION_PATH);
  const leaseToken = randomUUID();
  const now = Date.now();

  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(migrationRef);
    const state = snapshot.exists ? stateFrom(snapshot.data()) : initialState();
    if (!workPhase(state.phase)) return { state, claimed: false };
    if (hasLiveLease(state, now)) {
      throw new DataScopeMigrationError('MIGRATION_BUSY', 'Otra página está en proceso.');
    }
    transaction.set(migrationRef, {
      ...persistedState(state),
      leaseToken,
      leaseExpiresAt: Timestamp.fromMillis(now + LEASE_MS),
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    return { state, claimed: true };
  });

  if (!claimed.claimed) return publicState(claimed.state);
  const state = claimed.state;

  try {
    const collection = DATA_SCOPE_COLLECTIONS[state.collectionIndex];
    if (!collection) {
      throw new DataScopeMigrationError('MIGRATION_STATE_INVALID', 'Colección inválida.');
    }
    const page = await backfillDataScopePage(db, {
      collection,
      cursor: state.cursor || undefined,
      write: state.phase === 'backfill',
    });

    return await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(migrationRef);
      const current = stateFrom(currentSnapshot.data());
      if (current.leaseToken !== leaseToken) {
        throw new DataScopeMigrationError('MIGRATION_LEASE_LOST', 'El lease cambió.');
      }

      const auditNeedsUpdate = state.auditNeedsUpdate
        + (state.phase === 'backfill' ? 0 : page.needsUpdate);
      const auditMalformed = state.auditMalformed
        + (state.phase === 'backfill' ? 0 : page.skippedMalformed);
      const orphanedScopes = state.orphanedScopes
        + (state.phase === 'backfill' ? 0 : page.orphanedScopes);
      let nextState: MigrationState = {
        ...state,
        auditNeedsUpdate,
        auditMalformed,
        orphanedScopes,
        cursor: page.nextCursor,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
      };

      if (!page.nextCursor) {
        const nextCollectionIndex = state.collectionIndex + 1;
        if (nextCollectionIndex < DATA_SCOPE_COLLECTIONS.length) {
          nextState.collectionIndex = nextCollectionIndex;
          nextState.cursor = null;
        } else if (state.phase === 'backfill') {
          nextState = {
            ...nextState,
            phase: 'audit',
            collectionIndex: 0,
            cursor: null,
            auditNeedsUpdate: 0,
            auditMalformed: 0,
            orphanedScopes: 0,
          };
        } else if (auditMalformed > 0 || orphanedScopes > 0) {
          nextState = { ...nextState, phase: 'blocked', cursor: null };
        } else if (auditNeedsUpdate > 0 && state.phase === 'audit') {
          // A compatible legacy write landed during the first audit. Re-run an
          // idempotent write pass before any global write/read gate is enabled.
          nextState = {
            ...nextState,
            phase: 'backfill',
            collectionIndex: 0,
            cursor: null,
            auditNeedsUpdate: 0,
            auditMalformed: 0,
            orphanedScopes: 0,
          };
        } else if (auditNeedsUpdate > 0) {
          nextState = { ...nextState, phase: 'blocked', cursor: null };
        } else {
          nextState = {
            ...nextState,
            phase: state.phase === 'audit' ? 'ready_to_seal' : 'verified',
            collectionIndex: 0,
            cursor: null,
          };
        }
      }

      transaction.set(migrationRef, {
        ...persistedState(nextState),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      return publicState(nextState);
    });
  } catch (error) {
    await releaseOwnedLease(db, leaseToken);
    throw error;
  }
};

export const sealDataScopeWrites = async (
  db: Firestore,
  input: { serverProofVerified: boolean; minimumAppBuild: string },
) => db.runTransaction(async (transaction) => {
  if (!input.serverProofVerified || !input.minimumAppBuild.trim()) {
    throw new DataScopeMigrationError(
      'MINIMUM_VERSION_REQUIRED',
      'Primero se debe probar en el servidor la versión compatible obligatoria.',
    );
  }
  const ref = db.doc(MIGRATION_PATH);
  const snapshot = await transaction.get(ref);
  const state = stateFrom(snapshot.data());
  if (
    state.phase !== 'ready_to_seal'
    || state.auditNeedsUpdate !== 0
    || state.auditMalformed !== 0
    || state.orphanedScopes !== 0
  ) {
    throw new DataScopeMigrationError('MIGRATION_NOT_READY', 'El audit inicial no está limpio.');
  }
  const next: MigrationState = resetActivation({
    ...state,
    phase: 'sealed_audit',
    collectionIndex: 0,
    cursor: null,
    auditNeedsUpdate: 0,
    auditMalformed: 0,
    orphanedScopes: 0,
    writeVersion: 1,
    readVersion: 0,
    minimumAppBuild: input.minimumAppBuild.trim(),
  });
  transaction.set(ref, {
    ...persistedState(next),
    minimumVersionEnforcedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return publicState(next);
});

export const restartDataScopeAudit = async (db: Firestore) =>
  db.runTransaction(async (transaction) => {
    const ref = db.doc(MIGRATION_PATH);
    const snapshot = await transaction.get(ref);
    const state = stateFrom(snapshot.data());
    if (state.phase !== 'blocked') {
      throw new DataScopeMigrationError('MIGRATION_NOT_BLOCKED', 'La migración no está bloqueada.');
    }
    const next: MigrationState = {
      ...state,
      phase: state.writeVersion === 1 ? 'sealed_audit' : 'backfill',
      collectionIndex: 0,
      cursor: null,
      auditNeedsUpdate: 0,
      auditMalformed: 0,
      orphanedScopes: 0,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    };
    transaction.set(ref, {
      ...persistedState(next),
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return publicState(next);
  });

export const activateStrictScopeReadsForUser = async (
  db: Firestore,
  uid: string,
) => db.runTransaction(async (transaction) => {
  if (!uid) throw new DataScopeMigrationError('UID_REQUIRED', 'UID requerido.');
  const migrationRef = db.doc(MIGRATION_PATH);
  const userRef = db.collection('users').doc(uid);
  const migrationSnapshot = await transaction.get(migrationRef);
  const userSnapshot = await transaction.get(userRef);
  const state = stateFrom(migrationSnapshot.data());
  assertVerified(state);
  if (!userSnapshot.exists || activationEligibility(userSnapshot.data() || {}) !== 'eligible') {
    throw new DataScopeMigrationError('USER_NOT_READY', 'La cuenta no puede activarse ahora.');
  }
  if (userSnapshot.data()?.scopeReadVersion !== 1) {
    transaction.update(userRef, {
      scopeReadVersion: 1,
      scopeReadActivatedAt: Timestamp.now(),
    });
  }
  return { uid, scopeReadVersion: 1 };
});

/**
 * Activates one deterministic users document-id page. The sealed global build
 * proof is the compatibility gate; account lifecycle and migration fences are
 * re-read in the same transaction before each user marker is written.
 */
export const advanceStrictScopeActivation = async (
  db: Firestore,
  options: { pageSize?: number } = {},
) => {
  const pageSize = options.pageSize ?? DEFAULT_ACTIVATION_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_ACTIVATION_PAGE_SIZE) {
    throw new DataScopeMigrationError('ACTIVATION_PAGE_SIZE_INVALID', 'Página inválida.');
  }
  const migrationRef = db.doc(MIGRATION_PATH);
  const leaseToken = randomUUID();
  const now = Date.now();
  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(migrationRef);
    const state = stateFrom(snapshot.data());
    assertVerified(state);
    if (state.readVersion === 1 || state.activationComplete) {
      return { state, claimed: false };
    }
    if (hasLiveLease(state, now)) {
      throw new DataScopeMigrationError('MIGRATION_BUSY', 'Otra página está en proceso.');
    }
    transaction.set(migrationRef, {
      leaseToken,
      leaseExpiresAt: Timestamp.fromMillis(now + LEASE_MS),
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    return { state, claimed: true };
  });
  if (!claimed.claimed) return publicState(claimed.state);

  try {
    let query = db.collection('users')
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (claimed.state.activationCursor) query = query.startAfter(claimed.state.activationCursor);

    return await db.runTransaction(async (transaction) => {
      const migrationSnapshot = await transaction.get(migrationRef);
      const current = stateFrom(migrationSnapshot.data());
      if (current.leaseToken !== leaseToken) {
        throw new DataScopeMigrationError('MIGRATION_LEASE_LOST', 'El lease cambió.');
      }
      assertVerified(current);
      const users = await transaction.get(query);
      let eligible = 0;
      let activated = 0;
      let alreadyActive = 0;
      let skippedInactive = 0;
      let blocked = 0;
      users.docs.forEach((user) => {
        const classification = activationEligibility(user.data() || {});
        if (classification === 'inactive') {
          skippedInactive += 1;
          return;
        }
        if (classification === 'blocked') {
          blocked += 1;
          return;
        }
        eligible += 1;
        if (user.data().scopeReadVersion === 1) {
          alreadyActive += 1;
          return;
        }
        transaction.update(user.ref, {
          scopeReadVersion: 1,
          scopeReadActivatedAt: Timestamp.now(),
        });
        activated += 1;
      });

      const nextCursor = users.size === pageSize
        ? users.docs[users.docs.length - 1]?.id || null
        : null;
      const next: MigrationState = {
        ...current,
        activationCursor: nextCursor,
        activationScanned: current.activationScanned + users.size,
        activationEligible: current.activationEligible + eligible,
        activationActivated: current.activationActivated + activated,
        activationAlreadyActive: current.activationAlreadyActive + alreadyActive,
        activationSkippedInactive: current.activationSkippedInactive + skippedInactive,
        activationBlocked: current.activationBlocked + blocked,
        activationComplete: nextCursor === null,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
      };
      transaction.set(migrationRef, {
        ...persistedState(next),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      return publicState(next);
    });
  } catch (error) {
    await releaseOwnedLease(db, leaseToken);
    throw error;
  }
};

export const restartStrictScopeActivation = async (db: Firestore) =>
  db.runTransaction(async (transaction) => {
    const ref = db.doc(MIGRATION_PATH);
    const snapshot = await transaction.get(ref);
    const state = stateFrom(snapshot.data());
    assertVerified(state);
    if (state.readVersion === 1) {
      throw new DataScopeMigrationError('GLOBAL_READS_ALREADY_ACTIVE', 'La lectura global ya es v1.');
    }
    if (hasLiveLease(state, Date.now())) {
      throw new DataScopeMigrationError('MIGRATION_BUSY', 'Otra página está en proceso.');
    }
    const next = resetActivation(state);
    transaction.set(ref, {
      ...persistedState(next),
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return publicState(next);
  });

/**
 * Closes the post-migration race for future accounts. Once this server-owned
 * gate is committed, rules default every account to strict reads and the
 * compatible app reads the same public, read-only version marker.
 */
export const finalizeStrictScopeActivation = async (
  db: Firestore,
  input: { serverProofVerified: boolean },
) => db.runTransaction(async (transaction) => {
  if (!input.serverProofVerified) {
    throw new DataScopeMigrationError('MINIMUM_VERSION_REQUIRED', 'Falta la prueba del servidor.');
  }
  const migrationRef = db.doc(MIGRATION_PATH);
  const configRef = db.doc(PUBLIC_SCOPE_CONFIG_PATH);
  const snapshot = await transaction.get(migrationRef);
  const state = stateFrom(snapshot.data());
  assertVerified(state);
  if (
    !state.minimumAppBuild
    || !state.activationComplete
    || state.activationBlocked !== 0
  ) {
    throw new DataScopeMigrationError(
      'ACTIVATION_NOT_READY',
      'El barrido de cuentas todavía no terminó limpio.',
    );
  }
  const next: MigrationState = { ...state, readVersion: 1 };
  const activatedAt = Timestamp.now();
  transaction.set(migrationRef, {
    ...persistedState(next),
    globalReadActivatedAt: activatedAt,
    updatedAt: activatedAt,
  }, { merge: true });
  transaction.set(configRef, {
    readVersion: 1,
    minimumAppBuild: state.minimumAppBuild,
    activatedAt,
  });
  return publicState(next);
});
