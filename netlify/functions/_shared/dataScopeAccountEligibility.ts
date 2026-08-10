export type DataScopeActivationEligibility = 'eligible' | 'inactive' | 'blocked';

export const dataScopeActivationEligibility = (
  user: Record<string, any>,
): DataScopeActivationEligibility => {
  const accountState = user.accountState;
  // A deletion can still be cancelled before Auth removal. Keep it blocking
  // the irreversible cutover until cleanup finishes and the durable tombstone
  // becomes `deleted`.
  if (accountState === 'deleted') return 'inactive';
  if (accountState === 'deleting') return 'blocked';
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
