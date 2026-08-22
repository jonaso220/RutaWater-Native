import {
  getClientPhones,
  getPrimaryClientPhone,
  normalizeEditableClientPhones,
  sanitizeClientPhones,
} from '../clientPhones';

describe('client phones', () => {
  test('uses the legacy phone as the only primary number without a migration', () => {
    expect(getClientPhones({ phone: '099 123 456' })).toEqual([{
      id: 'legacy-primary',
      number: '099 123 456',
      isPrimary: true,
    }]);
  });

  test('keeps exactly one primary and drops empty or duplicate numbers', () => {
    expect(sanitizeClientPhones([
      { id: 'one', number: ' 099 123 456 ', isPrimary: true },
      { id: 'duplicate', number: '+598 99 123 456', isPrimary: false },
      { id: 'empty', number: ' ', isPrimary: false },
      { id: 'two', number: '098 111 222', isPrimary: true },
    ])).toEqual([
      { id: 'one', number: '099 123 456', isPrimary: true },
      { id: 'two', number: '098 111 222', isPrimary: false },
    ]);
  });

  test('treats a legacy phone changed by another app path as the new primary', () => {
    expect(getClientPhones({
      phone: '097 000 000',
      phones: [
        { id: 'old', number: '099 123 456', isPrimary: true },
        { id: 'other', number: '098 111 222', isPrimary: false },
      ],
    })).toEqual([
      { id: 'legacy-primary', number: '097 000 000', isPrimary: true },
      { id: 'old', number: '099 123 456', isPrimary: false },
      { id: 'other', number: '098 111 222', isPrimary: false },
    ]);
  });

  test('returns the selected primary number', () => {
    expect(getPrimaryClientPhone([
      { id: 'one', number: '099 123 456', isPrimary: false },
      { id: 'two', number: '098 111 222', isPrimary: true },
    ])?.number).toBe('098 111 222');
  });

  test('promotes the only non-empty editable row when the old primary is cleared', () => {
    expect(normalizeEditableClientPhones([
      { id: 'old-primary', number: '', isPrimary: true },
      { id: 'secondary', number: '098 111 222', isPrimary: false },
    ])).toEqual([
      { id: 'old-primary', number: '', isPrimary: false },
      { id: 'secondary', number: '098 111 222', isPrimary: true },
    ]);
  });

  test('keeps a single primary when every editable row is empty', () => {
    expect(normalizeEditableClientPhones([
      { id: 'first', number: '', isPrimary: true },
      { id: 'second', number: '', isPrimary: true },
    ])).toEqual([
      { id: 'first', number: '', isPrimary: true },
      { id: 'second', number: '', isPrimary: false },
    ]);
  });
});
