export interface MapCoordinates {
  lat: number;
  lng: number;
}

export interface RouteMapStop {
  clientId: string;
  name: string;
  mapsLink: string;
  coordinates: MapCoordinates | null;
}

export interface RouteSession {
  stops: RouteMapStop[];
  currentIndex: number;
}

const sameCoordinates = (a: MapCoordinates | null, b: MapCoordinates | null): boolean =>
  a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

const sameStop = (a: RouteMapStop, b: RouteMapStop): boolean =>
  a.clientId === b.clientId &&
  a.name === b.name &&
  a.mapsLink === b.mapsLink &&
  sameCoordinates(a.coordinates, b.coordinates);

/**
 * Keep the already visited/skipped prefix of a guided route, while replacing
 * every pending stop with the latest ordered client list. This makes manual
 * position changes (and location edits) take effect without restarting the
 * route.
 */
export const reconcileRouteSession = <T extends RouteSession>(
  session: T,
  orderedStops: RouteMapStop[],
): T => {
  const completedPrefix = session.stops.slice(0, session.currentIndex);
  const completedIds = new Set(completedPrefix.map((stop) => stop.clientId));
  let pendingStops = orderedStops.filter((stop) => !completedIds.has(stop.clientId));
  const currentStop = session.stops[session.currentIndex];

  // A successful "Listo" write removes the current client from the live list
  // before the completion callback advances the route. Keep that stop at the
  // cursor until the callback runs; otherwise the session points at the next
  // client early and the callback is rejected as if a different card had been
  // completed.
  if (currentStop && !pendingStops.some((stop) => stop.clientId === currentStop.clientId)) {
    pendingStops = [currentStop, ...pendingStops];
  }

  const stops = [...completedPrefix, ...pendingStops];
  if (
    session.currentIndex === completedPrefix.length &&
    stops.length === session.stops.length &&
    stops.every((stop, index) => sameStop(stop, session.stops[index]))
  ) {
    return session;
  }

  return { ...session, stops, currentIndex: completedPrefix.length };
};

const isValidCoordinates = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180 &&
  !(lat === 0 && lng === 0);

const toCoordinates = (latValue: string, lngValue: string): MapCoordinates | null => {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return isValidCoordinates(lat, lng) ? { lat, lng } : null;
};

export const coordinatesFromClient = (
  latValue: string | number | null | undefined,
  lngValue: string | number | null | undefined,
): MapCoordinates | null => toCoordinates(String(latValue ?? ''), String(lngValue ?? ''));

const coordinateValue = ({ lat, lng }: MapCoordinates): string => `${lat},${lng}`;

export const buildGoogleMapsDirectionsUrl = (destination: MapCoordinates): string => {
  const params = new URLSearchParams({
    api: '1',
    destination: coordinateValue(destination),
    travelmode: 'driving',
    dir_action: 'navigate',
  });

  return `https://www.google.com/maps/dir/?${params.toString()}`;
};
