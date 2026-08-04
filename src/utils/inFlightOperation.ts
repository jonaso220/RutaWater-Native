/**
 * Returns the operation already running for `key`, or starts it once.
 * Every caller awaits the same underlying result, including failures, so a
 * double tap cannot mistake "ignored" for a successful Firestore write.
 */
export const shareInFlightOperation = <T>(
  operations: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const existing = operations.get(key);
  if (existing) return existing;

  let shared: Promise<T>;
  shared = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (operations.get(key) === shared) operations.delete(key);
    });
  operations.set(key, shared);
  return shared;
};

export interface ExclusiveOperationLock {
  current: boolean;
}

/**
 * Starts one exclusive operation synchronously and ignores overlapping calls.
 * This is intended for irreversible UI actions (such as store purchases),
 * where sharing the same promise would make every caller repeat success/error
 * side effects after a double tap.
 */
export const runExclusiveOperation = async <T>(
  lock: ExclusiveOperationLock,
  operation: () => Promise<T>,
): Promise<{ started: false } | { started: true; value: T }> => {
  if (lock.current) return { started: false };
  lock.current = true;
  try {
    return { started: true, value: await operation() };
  } finally {
    lock.current = false;
  }
};
