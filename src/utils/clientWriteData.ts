/**
 * Fields that identify a client's owner/scope and determine delete privileges
 * are immutable after creation. Shared-route edits must never reattribute a
 * record to whichever member happened to schedule or edit it.
 */
export const toExistingClientUpdate = (
  createData: Record<string, any>,
): Record<string, any> => {
  const updateData = { ...createData };
  delete updateData.userId;
  delete updateData.groupId;
  delete updateData.scopeKey;
  delete updateData.createdAt;
  delete updateData.isNote;
  return updateData;
};
