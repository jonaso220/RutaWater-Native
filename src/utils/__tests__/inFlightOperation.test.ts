import { runExclusiveOperation, shareInFlightOperation } from '../inFlightOperation';

describe('shareInFlightOperation', () => {
  test('shares one successful operation between concurrent callers', async () => {
    const operations = new Map<string, Promise<string>>();
    let resolve!: (value: string) => void;
    const work = jest.fn(() => new Promise<string>((done) => { resolve = done; }));

    const first = shareInFlightOperation(operations, 'save', work);
    const second = shareInFlightOperation(operations, 'save', work);

    expect(second).toBe(first);
    expect(work).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
    resolve('saved');
    await expect(Promise.all([first, second])).resolves.toEqual(['saved', 'saved']);
    expect(operations.has('save')).toBe(false);
  });

  test('shares the rejection and permits a later retry', async () => {
    const operations = new Map<string, Promise<void>>();
    const failure = new Error('write failed');
    const failingWork = jest.fn(async () => { throw failure; });

    const first = shareInFlightOperation(operations, 'save', failingWork);
    const second = shareInFlightOperation(operations, 'save', failingWork);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(failingWork).toHaveBeenCalledTimes(1);

    const retry = jest.fn(async () => {});
    await expect(shareInFlightOperation(operations, 'save', retry)).resolves.toBeUndefined();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('runExclusiveOperation', () => {
  test('a double tap invokes an irreversible operation only once', async () => {
    const lock = { current: false };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const purchase = jest.fn(async () => pending);

    const first = runExclusiveOperation(lock, purchase);
    const second = runExclusiveOperation(lock, purchase);

    await expect(second).resolves.toEqual({ started: false });
    expect(purchase).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toEqual({ started: true, value: undefined });
  });

  test('purchase and restore are serialized by the same billing lock', async () => {
    const lock = { current: false };
    let release!: () => void;
    const purchase = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const restore = jest.fn(async () => true);

    const first = runExclusiveOperation(lock, purchase);
    await expect(runExclusiveOperation(lock, restore)).resolves.toEqual({ started: false });
    expect(restore).not.toHaveBeenCalled();
    release();
    await first;

    await expect(runExclusiveOperation(lock, restore)).resolves.toEqual({
      started: true,
      value: true,
    });
  });
});
