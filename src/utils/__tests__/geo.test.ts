import {
  cheapestInsertion, clientCoordinates, coordinateUpdates, haversineMeters, linksWithoutCoordinates,
  parseMapsCoordinates, resolveMapsCoordinates,
} from '../geo';

describe('parseMapsCoordinates', () => {
  test('reads the shared point from the URLs Google redirects to', () => {
    expect(parseMapsCoordinates('https://maps.google.com/?q=-34.812967,-55.920481&entry=gps&shorturl=1'))
      .toEqual({ lat: -34.812967, lng: -55.920481 });
    expect(parseMapsCoordinates('https://www.google.com/maps/search/-34.851781,+-55.984336?entry=tts'))
      .toEqual({ lat: -34.851781, lng: -55.984336 });
    expect(parseMapsCoordinates('https://www.google.com/maps/place/Casa/@-34.80,-55.90,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-34.8011!4d-55.9022'))
      .toEqual({ lat: -34.8011, lng: -55.9022 });
    expect(parseMapsCoordinates('https://www.google.com/maps/place/Casa/@-34.80,-55.90,17z'))
      .toEqual({ lat: -34.8, lng: -55.9 });
    expect(parseMapsCoordinates('https://consent.google.com/m?continue=https://www.google.com/maps/search/-34.85,%2B-55.98%3Fentry%3Dtts'))
      .toEqual({ lat: -34.85, lng: -55.98 });
  });

  test('does not take a map view or a named place as the point', () => {
    expect(parseMapsCoordinates('https://www.google.com/maps/@-34.83,-56.02,12z')).toBeNull();
    expect(parseMapsCoordinates('https://www.google.com/maps?q=Palacio+Salvo&ftid=0x95:0x5d')).toBeNull();
    expect(parseMapsCoordinates('https://maps.app.goo.gl/REDvKKVAReRLe3fXA')).toBeNull();
    expect(parseMapsCoordinates('https://maps.google.com/?q=0,0')).toBeNull();
    expect(parseMapsCoordinates('https://maps.google.com/?q=-134.8,-55.9')).toBeNull();
  });
});

describe('resolveMapsCoordinates', () => {
  const response = (status: number, location?: string, url = '') => ({
    status, url, headers: { get: (name: string) => (name === 'location' ? location ?? null : null) },
  }) as unknown as Response;

  test('follows manual redirects hop by hop (Node)', async () => {
    const hops: Record<string, Response> = {
      'https://maps.app.goo.gl/abc': response(302, 'https://maps.google.com/maps?q=Casa&ftid=1'),
      'https://maps.google.com/maps?q=Casa&ftid=1': response(302, '/maps/place/Casa/@-34.7,-55.8,17z/data=!3d-34.71!4d-55.81'),
    };
    const fetchImpl = jest.fn(async (url: string) => hops[url]) as unknown as typeof fetch;
    expect(await resolveMapsCoordinates('https://maps.app.goo.gl/abc', { fetchImpl })).toEqual({ lat: -34.71, lng: -55.81 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'HEAD', redirect: 'manual' }));
  });

  test('uses the final URL when fetch follows redirects itself (React Native)', async () => {
    const fetchImpl = (async () => response(200, undefined, 'https://maps.google.com/maps?q=-34.81,-55.92&entry=gps')) as unknown as typeof fetch;
    expect(await resolveMapsCoordinates('https://goo.gl/maps/xyz', { fetchImpl })).toEqual({ lat: -34.81, lng: -55.92 });
  });

  test('null for a named place, no request for a link that already has them', async () => {
    const named = (async () => response(200, undefined, 'https://www.google.com/maps?q=Palacio+Salvo&ftid=1')) as unknown as typeof fetch;
    expect(await resolveMapsCoordinates('https://maps.app.goo.gl/x', { fetchImpl: named })).toBeNull();
    const never = jest.fn() as unknown as typeof fetch;
    expect(await resolveMapsCoordinates('https://maps.google.com/?q=-34.1,-55.2', { fetchImpl: never })).toEqual({ lat: -34.1, lng: -55.2 });
    expect(never).not.toHaveBeenCalled();
  });
});

describe('client coordinates', () => {
  const client = {
    mapsLink: 'https://maps.app.goo.gl/casa', lat: '', lng: '',
    addresses: [
      { id: 'a1', type: 'home' as const, address: 'Casa', mapsLink: 'https://maps.app.goo.gl/casa', lat: '', lng: '' },
      { id: 'a2', type: 'work' as const, address: 'Trabajo', mapsLink: 'https://maps.app.goo.gl/work', lat: '-34.9', lng: '-56.1' },
    ],
  };

  test('top-level point first, else the first address with coordinates', () => {
    expect(clientCoordinates(client)).toEqual({ lat: -34.9, lng: -56.1 });
    expect(clientCoordinates({ ...client, lat: '-34.5', lng: '-55.5' })).toEqual({ lat: -34.5, lng: -55.5 });
    expect(clientCoordinates({ lat: 'x', lng: '1' })).toBeNull();
  });

  test('only the links without coordinates are resolved, and only those fields change', () => {
    expect(linksWithoutCoordinates(client)).toEqual(['https://maps.app.goo.gl/casa']);
    const updates = coordinateUpdates(client, new Map([['https://maps.app.goo.gl/casa', { lat: -34.8129671, lng: -55.92 }]]));
    expect(updates).toEqual({
      addresses: [{ ...client.addresses[0], lat: '-34.812967', lng: '-55.92' }, client.addresses[1]],
      lat: '-34.812967',
      lng: '-55.92',
    });
    expect(coordinateUpdates({ ...client, ...updates }, new Map([['https://maps.app.goo.gl/casa', { lat: 1, lng: 1 }]]))).toBeNull();
  });
});

describe('cheapestInsertion', () => {
  // Una calle de oeste a este, cada ~1 km.
  const route = [0, 1, 2, 3].map((km) => ({ lat: -34.8, lng: -56 + km * 0.011 }));

  test('between the two stops where the detour is smallest', () => {
    const point = { lat: -34.801, lng: -56 + 1.5 * 0.011 };
    const result = cheapestInsertion(route, point)!;
    expect(result.index).toBe(2);
    expect(result.extraMeters).toBeLessThan(50);
  });

  test('before the first or after the last when that is cheaper', () => {
    expect(cheapestInsertion(route, { lat: -34.8, lng: -56.011 })!.index).toBe(0);
    expect(cheapestInsertion(route, { lat: -34.8, lng: -56 + 4 * 0.011 })!.index).toBe(4);
    expect(cheapestInsertion([], route[0])).toBeNull();
  });

  test('haversine in meters', () => {
    expect(Math.round(haversineMeters({ lat: -34.9, lng: -56.2 }, { lat: -34.8, lng: -56.2 }))).toBe(11119);
  });
});
