import {
  canonicalDataScopeKeyForRecord,
  dataScopeCacheKey,
  dataScopeFields,
  dataScopeQuery,
  hasCanonicalDataScopeKey,
  normalizableBlankGroupScope,
} from '../dataScope';

describe('data scope v1', () => {
  test('uses collision-proof keys for personal and shared data', () => {
    expect(dataScopeFields('uid-1')).toEqual({
      userId: 'uid-1',
      scopeKey: 'user:uid-1',
    });
    expect(dataScopeFields('uid-1', 'route-1')).toEqual({
      userId: 'uid-1',
      groupId: 'route-1',
      scopeKey: 'scope:route-1',
    });
  });

  test('derives scope from groupId, never from creator attribution', () => {
    expect(canonicalDataScopeKeyForRecord({
      userId: 'former-member',
      groupId: 'shared-route',
    })).toBe('scope:shared-route');
    expect(canonicalDataScopeKeyForRecord({ userId: 'owner' })).toBe('user:owner');
    expect(canonicalDataScopeKeyForRecord({ groupId: 'orphan' })).toBeNull();
    expect(canonicalDataScopeKeyForRecord({ userId: ' owner' })).toBeNull();
    expect(canonicalDataScopeKeyForRecord({ userId: 'owner', groupId: '' })).toBeNull();
    expect(normalizableBlankGroupScope({ userId: 'owner', groupId: '   ' })).toEqual({
      scopeKey: 'user:owner',
    });
  });

  test('recognizes malformed and stale keys without changing the record', () => {
    expect(hasCanonicalDataScopeKey({
      userId: 'former-member',
      groupId: 'shared-route',
      scopeKey: 'user:former-member',
    })).toBe(false);
    expect(hasCanonicalDataScopeKey({
      userId: 'former-member',
      groupId: 'shared-route',
      scopeKey: 'scope:shared-route',
    })).toBe(true);
  });

  test('keeps legacy queries until the server-owned adoption marker is enabled', () => {
    expect(dataScopeQuery('uid-1', undefined, 0)).toEqual({
      field: 'userId', value: 'uid-1',
    });
    expect(dataScopeQuery('uid-1', 'route-1', 0)).toEqual({
      field: 'groupId', value: 'route-1',
    });
    expect(dataScopeQuery('uid-1', undefined, 1)).toEqual({
      field: 'scopeKey', value: 'user:uid-1',
    });
    expect(dataScopeQuery('uid-1', 'route-1', 1)).toEqual({
      field: 'scopeKey', value: 'scope:route-1',
      additionalFilter: { field: 'groupId', value: 'route-1' },
    });
  });

  test('v0 cached data is not visible while the first v1 snapshot is pending', () => {
    const legacyKey = dataScopeCacheKey('clients', 'uid-1', 0);
    const strictKey = dataScopeCacheKey('clients', 'uid-1', 1);
    const cache = new Map<string, Array<{ id: string }>>([
      [JSON.stringify(legacyKey), [{ id: 'foreign-attributed-doc' }]],
    ]);

    expect(strictKey).not.toEqual(legacyKey);
    expect(cache.get(JSON.stringify(strictKey)) ?? []).toEqual([]);
  });
});
