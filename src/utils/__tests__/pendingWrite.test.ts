import { awaitWriteWithinGrace } from '../pendingWrite';

describe('awaitWriteWithinGrace', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports an acknowledgement that arrives within the grace period', async () => {
    const outcome = awaitWriteWithinGrace(Promise.resolve(), 1500);
    await expect(outcome).resolves.toBe('acknowledged');
  });

  it('reports a rejection that arrives within the grace period', async () => {
    const outcome = awaitWriteWithinGrace(Promise.reject(new Error('permission-denied')), 1500);
    await expect(outcome).resolves.toBe('failed');
  });

  it('stops waiting for an unacknowledged (offline) write after the grace period', async () => {
    const outcome = awaitWriteWithinGrace(new Promise<void>(() => {}), 1500);
    jest.advanceTimersByTime(1499);
    await Promise.resolve();
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(outcome).resolves.toBe('pending');
  });

  it('ignores a late rejection once the grace period resolved as pending', async () => {
    let reject: (error: Error) => void = () => {};
    const write = new Promise<void>((_resolve, rejectWrite) => { reject = rejectWrite; });
    write.catch(() => {});
    const outcome = awaitWriteWithinGrace(write, 1500);
    jest.advanceTimersByTime(1500);
    await expect(outcome).resolves.toBe('pending');
    reject(new Error('late'));
    await Promise.resolve();
    await expect(outcome).resolves.toBe('pending');
  });
});
