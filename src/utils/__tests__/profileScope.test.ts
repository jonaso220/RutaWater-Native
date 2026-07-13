import { belongsToProfileScope } from '../profileScope';

describe('belongsToProfileScope', () => {
  test('Reparto 1 personal incluye solo documentos sin groupId', () => {
    expect(belongsToProfileScope({ userId: 'user-1' }, 'user-1')).toBe(true);
    expect(belongsToProfileScope({ userId: 'user-1', groupId: null }, 'user-1')).toBe(true);
    expect(belongsToProfileScope({ userId: 'user-1', groupId: 'reparto-2' }, 'user-1')).toBe(false);
  });

  test('Reparto 1 personal no incluye documentos de otro usuario', () => {
    expect(belongsToProfileScope({ userId: 'user-2' }, 'user-1')).toBe(false);
  });

  test('un reparto con groupId incluye únicamente su propio alcance', () => {
    expect(belongsToProfileScope(
      { userId: 'user-1', groupId: 'reparto-2' },
      'user-1',
      'reparto-2',
    )).toBe(true);
    expect(belongsToProfileScope(
      { userId: 'user-1', groupId: 'reparto-3' },
      'user-1',
      'reparto-2',
    )).toBe(false);
    expect(belongsToProfileScope({ userId: 'user-1' }, 'user-1', 'reparto-2')).toBe(false);
  });
});
