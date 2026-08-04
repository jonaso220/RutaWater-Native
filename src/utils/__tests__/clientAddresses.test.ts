import {
  getClientAddresses,
  getDefaultNewAddressType,
  sanitizeClientAddresses,
} from '../clientAddresses';

describe('client addresses', () => {
  test('uses the legacy location as Casa without requiring a migration', () => {
    expect(getClientAddresses({
      address: 'Av. Italia 1234',
      mapsLink: 'https://maps.app.goo.gl/casa',
      lat: '-34.9',
      lng: '-56.1',
    })).toEqual([{
      id: 'legacy-primary',
      type: 'home',
      address: 'Av. Italia 1234',
      mapsLink: 'https://maps.app.goo.gl/casa',
      lat: '-34.9',
      lng: '-56.1',
    }]);
  });

  test('sanitizes saved locations and drops empty entries', () => {
    expect(sanitizeClientAddresses([
      { id: 'home', type: 'home', address: '  Casa  ', mapsLink: '' },
      { id: 'empty', type: 'work', address: ' ', mapsLink: ' ' },
      { id: 'office', type: 'invalid', address: 'Trabajo', mapsLink: ' https://maps.example/work ' },
    ])).toEqual([
      { id: 'home', type: 'home', address: 'Casa', mapsLink: '', lat: '', lng: '' },
      { id: 'office', type: 'other', address: 'Trabajo', mapsLink: 'https://maps.example/work', lat: '', lng: '' },
    ]);
  });

  test('suggests Casa, Trabajo and then Otro for new locations', () => {
    expect(getDefaultNewAddressType([])).toBe('home');
    expect(getDefaultNewAddressType([{ id: '1', type: 'home', address: '', mapsLink: '' }])).toBe('work');
    expect(getDefaultNewAddressType([
      { id: '1', type: 'home', address: '', mapsLink: '' },
      { id: '2', type: 'work', address: '', mapsLink: '' },
    ])).toBe('other');
  });
});
