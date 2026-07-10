import {
  buildGoogleMapsDirectionsUrl,
  coordinatesFromClient,
} from '../mapsRoute';

describe('Google Maps route helpers', () => {
  test('validates stored client coordinates', () => {
    expect(coordinatesFromClient('-34.9', '-56.2')).toEqual({ lat: -34.9, lng: -56.2 });
    expect(coordinatesFromClient(0, 0)).toBeNull();
    expect(coordinatesFromClient('999', '-56.2')).toBeNull();
  });

  test('builds directions for one client', () => {
    const url = buildGoogleMapsDirectionsUrl({ lat: -34.9, lng: -56.2 });

    expect(url).toContain('destination=-34.9%2C-56.2');
    expect(url).toContain('dir_action=navigate');
    expect(url).not.toContain('waypoints');
  });
});
