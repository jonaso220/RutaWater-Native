import { sortByCreatedAtDesc } from '../sortByCreatedAt';

describe('sortByCreatedAtDesc', () => {
  it('orders newest first across Date, Timestamp-like and invalid values', () => {
    const items = [
      { id: 'old', createdAt: new Date('2026-01-01T10:00:00Z') },
      { id: 'none', createdAt: null },
      { id: 'new', createdAt: { toDate: () => new Date('2026-09-01T10:00:00Z') } },
      { id: 'mid', createdAt: new Date('2026-05-01T10:00:00Z') },
    ];
    expect(sortByCreatedAtDesc(items).map((item) => item.id)).toEqual(['new', 'mid', 'old', 'none']);
  });

  it('keeps snapshot order for equal dates and does not mutate the input', () => {
    const date = new Date('2026-03-03T00:00:00Z');
    const items = [{ id: 'a', createdAt: date }, { id: 'b', createdAt: date }];
    const sorted = sortByCreatedAtDesc(items);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(items);
  });
});
