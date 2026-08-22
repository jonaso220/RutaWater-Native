import { switchProfileOptimistically } from '../profileSwitch';

describe('switchProfileOptimistically', () => {
  test('aplica el reparto nuevo antes de que termine la escritura remota', async () => {
    let activeId = 'reparto-1';
    let finishPersist!: () => void;
    const persistId = jest.fn(() => new Promise<void>((resolve) => {
      finishPersist = resolve;
    }));

    const switching = switchProfileOptimistically({
      nextId: 'reparto-2',
      getCurrentId: () => activeId,
      applyId: (id) => { activeId = id; },
      persistId,
    });

    expect(activeId).toBe('reparto-2');
    expect(persistId).toHaveBeenCalledWith('reparto-2');

    finishPersist();
    await expect(switching).resolves.toBeUndefined();
  });

  test('revierte al reparto anterior si falla la persistencia', async () => {
    let activeId = 'reparto-1';
    const failure = new Error('offline');

    await expect(switchProfileOptimistically({
      nextId: 'reparto-2',
      getCurrentId: () => activeId,
      applyId: (id) => { activeId = id; },
      persistId: async () => { throw failure; },
    })).rejects.toBe(failure);

    expect(activeId).toBe('reparto-1');
  });

  test('un fallo viejo no pisa una selección posterior', async () => {
    let activeId = 'reparto-1';
    let rejectPersist!: (error: Error) => void;
    const failure = new Error('offline');

    const switching = switchProfileOptimistically({
      nextId: 'reparto-2',
      getCurrentId: () => activeId,
      applyId: (id) => { activeId = id; },
      persistId: () => new Promise<void>((_resolve, reject) => {
        rejectPersist = reject;
      }),
    });
    activeId = 'reparto-3';
    rejectPersist(failure);

    await expect(switching).rejects.toBe(failure);
    expect(activeId).toBe('reparto-3');
  });
});
