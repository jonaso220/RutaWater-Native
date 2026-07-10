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
