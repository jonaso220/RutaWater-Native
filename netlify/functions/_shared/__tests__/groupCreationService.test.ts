import {
  GROUP_CREATION_BATCH_SIZE,
  GROUP_CREATION_COLLECTIONS,
  GroupActivationStatus,
  GroupCreationCollection,
  GroupCreationError,
  GroupCreationIdentity,
  GroupMigrationBatchResult,
  GroupCreationOperations,
  generateSecureGroupCode,
  generateSecureGroupId,
  runResumableGroupCreation,
} from '../groupCreationService';

interface BusinessDocument {
  id: string;
  userId: string;
  groupId?: string | null;
  scopeKey?: string;
  payload: string;
}

class StatefulCreationOperations implements GroupCreationOperations {
  readonly groupId = 'group_1234567890abcdef1234567890abcdef';
  readonly code = 'ABC234';
  readonly events: string[] = [];
  readonly collections: Record<GroupCreationCollection, BusinessDocument[]> = {
    clients: [],
    debts: [],
    transfers: [],
  };
  personalSettings: Record<string, unknown> | undefined;
  groupSettings: Record<string, unknown> | undefined;
  currentGroupId: string | null = null;
  pendingGroupId: string | null = null;
  lifecycleState: 'initializing' | 'active' | null = null;
  role: 'admin' | null = null;
  failAfterCommittedBatchOnce = false;
  returnIncompleteActivationOnce = false;
  private failedOnce = false;
  private incompleteActivationReturned = false;
  private activationCalls = 0;
  private readonly migrationOffsets: Record<GroupCreationCollection, number> = {
    clients: 0,
    debts: 0,
    transfers: 0,
  };
  private readonly migrationCompleted: Record<GroupCreationCollection, boolean> = {
    clients: false,
    debts: false,
    transfers: false,
  };

  async initialize(_identity: GroupCreationIdentity) {
    this.events.push('initialize');
    if (this.currentGroupId) {
      if (
        this.currentGroupId === this.groupId
        && this.role === 'admin'
        && this.lifecycleState === 'active'
      ) {
        return { groupId: this.groupId, code: this.code, alreadyActive: true };
      }
      throw new GroupCreationError('ALREADY_IN_GROUP', 'already');
    }
    if (!this.pendingGroupId) {
      this.pendingGroupId = this.groupId;
      this.lifecycleState = 'initializing';
    }
    return { groupId: this.pendingGroupId, code: this.code, alreadyActive: false };
  }

  async migrateNextBatch(input: {
    collectionName: GroupCreationCollection;
    uid: string;
    groupId: string;
  }): Promise<GroupMigrationBatchResult> {
    if (
      this.currentGroupId
      || this.pendingGroupId !== input.groupId
      || this.lifecycleState !== 'initializing'
    ) {
      throw new Error('invalid pending state');
    }
    if (this.migrationCompleted[input.collectionName]) {
      return { scanned: 0, migrated: 0, complete: true };
    }
    const attributed = this.collections[input.collectionName]
      .filter((doc) => doc.userId === input.uid)
      .sort((a, b) => a.id.localeCompare(b.id));
    const offset = this.migrationOffsets[input.collectionName];
    const page = attributed.slice(offset, offset + GROUP_CREATION_BATCH_SIZE);
    const candidates = page.filter((doc) => !doc.groupId);
    candidates.forEach((doc) => {
      doc.groupId = input.groupId;
      doc.scopeKey = `scope:${input.groupId}`;
    });
    this.migrationOffsets[input.collectionName] += page.length;
    const complete = page.length < GROUP_CREATION_BATCH_SIZE;
    this.migrationCompleted[input.collectionName] = complete;
    this.events.push(`migrate:${input.collectionName}:${page.length}:${candidates.length}`);

    // Simulates a batch that committed but whose invocation failed before the
    // response. The next call must resume the same group without duplication.
    if (this.failAfterCommittedBatchOnce && !this.failedOnce && candidates.length > 0) {
      this.failedOnce = true;
      throw new Error('connection lost after commit');
    }
    return { scanned: page.length, migrated: candidates.length, complete };
  }

  async copyPersonalSettings(input: { uid: string; groupId: string }): Promise<void> {
    if (input.groupId !== this.pendingGroupId) throw new Error('wrong group');
    this.events.push('copy-settings');
    if (this.personalSettings) {
      this.groupSettings = {
        ...(this.groupSettings || {}),
        ...this.personalSettings,
      };
    }
  }

  async activate(input: {
    identity: GroupCreationIdentity;
    groupId: string;
    code: string;
  }): Promise<GroupActivationStatus> {
    this.activationCalls += 1;
    this.events.push(`activate:${this.activationCalls}`);
    if (this.returnIncompleteActivationOnce && !this.incompleteActivationReturned) {
      this.incompleteActivationReturned = true;
      return 'incomplete';
    }
    const unscoped = GROUP_CREATION_COLLECTIONS.some((collectionName) =>
      this.collections[collectionName]
        .some((doc) => doc.userId === input.identity.uid && !doc.groupId),
    );
    const settingsMissing = this.personalSettings
      && Object.entries(this.personalSettings)
        .some(([key, value]) => this.groupSettings?.[key] !== value);
    if (unscoped || settingsMissing) return 'incomplete';

    this.currentGroupId = input.groupId;
    this.pendingGroupId = null;
    this.lifecycleState = 'active';
    this.role = 'admin';
    return 'activated';
  }
}

const identity: GroupCreationIdentity = {
  uid: 'owner',
  email: 'owner@example.com',
  displayName: 'Owner',
};

const documents = (prefix: string, count: number): BusinessDocument[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    userId: identity.uid,
    payload: `payload-${index}`,
  }));

describe('resumable group creation orchestration', () => {
  test('migrates more than 500 documents in <=450-write batches and activates last', async () => {
    const operations = new StatefulCreationOperations();
    operations.collections.clients.push(...documents('client', 1001));
    operations.collections.debts.push(...documents('debt', 501));
    operations.collections.transfers.push(...documents('transfer', 3));
    const existingProfileDocument: BusinessDocument = {
      id: 'profile-client',
      userId: identity.uid,
      groupId: 'existing-profile',
      payload: 'must stay in its original scope',
    };
    operations.collections.clients.push(existingProfileDocument);
    operations.personalSettings = { catalog: ['water'], template: 'hello' };
    operations.groupSettings = { backendOnly: true };

    const result = await runResumableGroupCreation(identity, operations);

    expect(result).toEqual({ groupId: operations.groupId, code: operations.code });
    for (const collectionName of GROUP_CREATION_COLLECTIONS) {
      expect(
        operations.collections[collectionName]
          .filter((doc) => doc !== existingProfileDocument)
          .every((doc) => doc.groupId === operations.groupId),
      ).toBe(true);
    }
    expect(existingProfileDocument.groupId).toBe('existing-profile');
    expect(existingProfileDocument.payload).toBe('must stay in its original scope');
    expect(operations.personalSettings).toEqual({ catalog: ['water'], template: 'hello' });
    expect(operations.groupSettings).toEqual({
      backendOnly: true,
      catalog: ['water'],
      template: 'hello',
    });
    expect(operations.currentGroupId).toBe(operations.groupId);
    expect(operations.pendingGroupId).toBeNull();

    const migratedCounts = operations.events
      .filter((event) => event.startsWith('migrate:'))
      .map((event) => Number(event.split(':')[3]));
    expect(Math.max(...migratedCounts)).toBeLessThanOrEqual(GROUP_CREATION_BATCH_SIZE);
    expect(operations.events.at(-1)).toBe('activate:1');
    expect(operations.events.indexOf('copy-settings')).toBeLessThan(
      operations.events.indexOf('activate:1'),
    );
  });

  test('resumes the same pending group after a partially committed invocation', async () => {
    const operations = new StatefulCreationOperations();
    operations.collections.clients.push(...documents('client', 700));
    operations.failAfterCommittedBatchOnce = true;

    await expect(runResumableGroupCreation(identity, operations)).rejects.toThrow(
      'connection lost after commit',
    );
    expect(operations.pendingGroupId).toBe(operations.groupId);
    expect(operations.currentGroupId).toBeNull();
    expect(operations.lifecycleState).toBe('initializing');
    expect(operations.collections.clients.filter((doc) => doc.groupId === operations.groupId))
      .toHaveLength(450);

    const retry = await runResumableGroupCreation(identity, operations);
    expect(retry).toEqual({ groupId: operations.groupId, code: operations.code });
    expect(operations.collections.clients).toHaveLength(700);
    expect(operations.collections.clients.every((doc) => doc.groupId === operations.groupId))
      .toBe(true);
    expect(operations.currentGroupId).toBe(operations.groupId);
  });

  test('cooperatively yields at a page boundary and resumes its durable cursor', async () => {
    const operations = new StatefulCreationOperations();
    operations.collections.clients.push(...documents('client', 1001));

    await expect(runResumableGroupCreation(identity, operations, {
      shouldYield: () => operations.events
        .filter((event) => event.startsWith('migrate:clients')).length >= 2,
    })).rejects.toMatchObject({ code: 'RETRY_REQUIRED' });
    expect(operations.pendingGroupId).toBe(operations.groupId);
    expect(operations.collections.clients.filter((document) => document.groupId)).toHaveLength(900);
    const migratedIdsAfterYield = operations.collections.clients
      .filter((document) => document.groupId)
      .map((document) => document.id);
    expect(new Set(migratedIdsAfterYield).size).toBe(900);

    await expect(runResumableGroupCreation(identity, operations)).resolves.toEqual({
      groupId: operations.groupId,
      code: operations.code,
    });
    expect(operations.collections.clients).toHaveLength(1001);
    expect(operations.collections.clients.every((document) =>
      document.groupId === operations.groupId
      && document.scopeKey === `scope:${operations.groupId}`)).toBe(true);
    expect(operations.currentGroupId).toBe(operations.groupId);
  });

  test('keeps completed cursor progress when activation must be retried', async () => {
    const operations = new StatefulCreationOperations();
    operations.collections.clients.push(...documents('client', 901));
    operations.returnIncompleteActivationOnce = true;

    await expect(runResumableGroupCreation(identity, operations)).rejects.toMatchObject({
      code: 'RETRY_REQUIRED',
    });
    const migrationEventsAfterFirstAttempt = operations.events
      .filter((event) => event.startsWith('migrate:')).length;

    await runResumableGroupCreation(identity, operations);

    expect(operations.events).toContain('activate:1');
    expect(operations.events.at(-1)).toBe('activate:2');
    expect(operations.events.filter((event) => event.startsWith('migrate:'))).toHaveLength(
      migrationEventsAfterFirstAttempt,
    );
    expect(operations.currentGroupId).toBe(operations.groupId);
  });

  test('does not reserve or migrate when the user already belongs to another group', async () => {
    const operations = new StatefulCreationOperations();
    operations.currentGroupId = 'foreign-group';
    operations.role = 'admin';
    operations.lifecycleState = 'active';
    operations.collections.clients.push(...documents('client', 1));

    await expect(runResumableGroupCreation(identity, operations)).rejects.toMatchObject({
      code: 'ALREADY_IN_GROUP',
    });
    expect(operations.pendingGroupId).toBeNull();
    expect(operations.collections.clients[0].groupId).toBeUndefined();
    expect(operations.events).toEqual(['initialize']);
  });

  test('a retry after successful activation is idempotent and performs no migration', async () => {
    const operations = new StatefulCreationOperations();
    operations.collections.clients.push(...documents('client', 1));
    const first = await runResumableGroupCreation(identity, operations);
    const eventCount = operations.events.length;
    const second = await runResumableGroupCreation(identity, operations);

    expect(second).toEqual(first);
    expect(operations.events.slice(eventCount)).toEqual(['initialize']);
    expect(operations.collections.clients).toHaveLength(1);
  });

  test('uses cryptographically generated values with the server-only formats', () => {
    const ids = new Set(Array.from({ length: 20 }, generateSecureGroupId));
    const codes = new Set(Array.from({ length: 20 }, generateSecureGroupCode));
    expect(ids.size).toBe(20);
    expect(codes.size).toBe(20);
    ids.forEach((id) => expect(id).toMatch(/^group_[a-f0-9]{32}$/));
    codes.forEach((code) => expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/));
  });
});
