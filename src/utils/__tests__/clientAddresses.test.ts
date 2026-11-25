import {
  clientAtDayLocation,
  getClientAddresses,
  getClientLocationForDay,
  getDefaultNewAddressType,
  pruneAddressByDay,
  sanitizeAddressByDay,
  sanitizeClientAddresses,
  weekdayOfDateKey,
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
      { id: 'office', type: 'invalid', address: 'Trabajo', mapsLink: ' maps.app.goo.gl/work ' },
    ])).toEqual([
      { id: 'home', type: 'home', address: 'Casa', mapsLink: '', lat: '', lng: '' },
      { id: 'office', type: 'other', address: 'Trabajo', mapsLink: 'https://maps.app.goo.gl/work', lat: '', lng: '' },
    ]);
  });

  test('drops a non-Google URL instead of persisting an unopenable map link', () => {
    expect(sanitizeClientAddresses([
      { id: 'home', type: 'home', address: 'Casa', mapsLink: 'maps.example/work' },
    ])).toEqual([
      { id: 'home', type: 'home', address: 'Casa', mapsLink: '', lat: '', lng: '' },
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

describe('address per visit day', () => {
  const client = {
    address: 'Avenida 2 y C.35',
    mapsLink: 'https://maps.app.goo.gl/casa',
    lat: '-34.9',
    lng: '-56.1',
    addresses: [
      { id: 'casa', type: 'home' as const, address: 'Avenida 2 y C.35', mapsLink: 'https://maps.app.goo.gl/casa', lat: '-34.9', lng: '-56.1' },
      { id: 'taller', type: 'work' as const, address: 'Cd. de la Paz e Inter', mapsLink: 'https://maps.app.goo.gl/taller', lat: '-34.8', lng: '-56.2' },
    ],
    addressByDay: { Martes: 'taller' },
  };

  test('uses the location chosen for that day and leaves the other days alone', () => {
    expect(getClientLocationForDay(client, 'Martes')).toEqual({
      addressId: 'taller', type: 'work', address: 'Cd. de la Paz e Inter',
      mapsLink: 'https://maps.app.goo.gl/taller', lat: '-34.8', lng: '-56.2',
    });
    expect(getClientLocationForDay(client, 'Jueves')).toEqual({
      addressId: 'casa', type: 'home', address: 'Avenida 2 y C.35',
      mapsLink: 'https://maps.app.goo.gl/casa', lat: '-34.9', lng: '-56.1',
    });
    expect(getClientLocationForDay(client).addressId).toBe('casa');
  });

  test('falls back to the card location when the chosen one was deleted', () => {
    const stale = { ...client, addressByDay: { Martes: 'borrada' } };
    expect(getClientLocationForDay(stale, 'Martes').address).toBe('Avenida 2 y C.35');
  });

  test('keeps the location picked when scheduling even if it is not the first one', () => {
    const scheduledAtWork = {
      ...client, address: 'Cd. de la Paz e Inter', mapsLink: 'https://maps.app.goo.gl/taller', lat: '-34.8', lng: '-56.2',
      addressByDay: undefined,
    };
    expect(getClientLocationForDay(scheduledAtWork, 'Lunes')).toMatchObject({ addressId: 'taller', type: 'work' });
  });

  test('gives the same client object when the day changes nothing', () => {
    expect(clientAtDayLocation(client, 'Jueves')).toBe(client);
    expect(clientAtDayLocation(client, 'Martes')).toMatchObject({
      address: 'Cd. de la Paz e Inter', lat: '-34.8', lng: '-56.2', addresses: client.addresses,
    });
  });

  test('keeps only weekdays with a location id', () => {
    expect(sanitizeAddressByDay({ Martes: ' taller ', Funday: 'x', Jueves: '', Lunes: 3 })).toEqual({ Martes: 'taller' });
    expect(sanitizeAddressByDay(['taller'])).toEqual({});
  });

  test('drops choices for days no longer visited or locations no longer saved', () => {
    expect(pruneAddressByDay(
      { Martes: 'taller', Jueves: 'casa', Viernes: 'taller', Lunes: 'borrada' },
      ['Lunes', 'Martes', 'Jueves'],
      client.addresses,
    )).toEqual({ Martes: 'taller', Jueves: 'casa' });
  });

  test('reads the weekday of a date key', () => {
    expect(weekdayOfDateKey('2026-11-24')).toBe('Martes');
    expect(weekdayOfDateKey('2026-11-26')).toBe('Jueves');
    expect(weekdayOfDateKey('')).toBe('');
  });
});
