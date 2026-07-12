import {
  buildGoogleMapsDirectionsUrl,
  coordinatesFromClient,
  reconcileRouteSession,
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

describe('guided route reconciliation', () => {
  const stop = (clientId: string) => ({
    clientId,
    name: clientId,
    mapsLink: `https://maps.example/${clientId}`,
    coordinates: null,
  });

  test('uses the latest order for all pending clients', () => {
    const original = { stops: [stop('a'), stop('b'), stop('c')], currentIndex: 0 };

    const reconciled = reconcileRouteSession(original, [stop('b'), stop('c'), stop('a')]);

    expect(reconciled.stops.map((item) => item.clientId)).toEqual(['b', 'c', 'a']);
    expect(reconciled.currentIndex).toBe(0);
  });

  test('does not reinsert clients that were already visited or skipped', () => {
    const original = { stops: [stop('a'), stop('b'), stop('c')], currentIndex: 1 };

    const reconciled = reconcileRouteSession(original, [stop('c'), stop('a'), stop('b')]);

    expect(reconciled.stops.map((item) => item.clientId)).toEqual(['a', 'c', 'b']);
    expect(reconciled.currentIndex).toBe(1);
  });

  test('refreshes the destination data of a pending client', () => {
    const original = { stops: [stop('a')], currentIndex: 0 };
    const updated = { ...stop('a'), mapsLink: 'https://maps.example/new-location' };

    const reconciled = reconcileRouteSession(original, [updated]);

    expect(reconciled.stops[0].mapsLink).toBe(updated.mapsLink);
  });
});
