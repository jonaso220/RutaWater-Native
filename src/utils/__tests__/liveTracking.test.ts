import {
  distanceMeters, liveLinks, newTrackingRecord, newTrackingToken, positionFields, shouldAddTrailPoint,
  trackingUrl, withTrackingLink,
} from '../liveTracking';

const TIMESTAMP = { '.sv': 'timestamp' };
const NOW = Date.UTC(2026, 9, 17, 15, 0, 0);
const fix = (extra = {}) => ({ lat: -34.9032181, lng: -56.1810449, precision: 7.6, rumbo: 81.4, at: NOW, ...extra });

test('token de 24 caracteres válidos para las reglas, a partir de bytes aleatorios', () => {
  const token = newTrackingToken((length) => Uint8Array.from({ length }, (_, i) => i * 37));
  expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  expect(newTrackingToken((length) => new Uint8Array(length).fill(255))).toBe('_'.repeat(24));
  expect(trackingUrl(token)).toBe(`https://rutawater.web.app/s/${token}`);
});

test('el link va donde dice {link} o en una línea al final; sin link el mensaje queda igual', () => {
  const url = 'https://rutawater.web.app/s/abc';
  expect(withTrackingLink('Buenas 🚚 ¡Estamos cerca!', url, `Mira el camión en vivo: ${url}`))
    .toBe(`Buenas 🚚 ¡Estamos cerca!\n\nMira el camión en vivo: ${url}`);
  expect(withTrackingLink('Ya salimos. Seguinos acá: {link}', url, 'no se usa'))
    .toBe(`Ya salimos. Seguinos acá: ${url}`);
  expect(withTrackingLink('Ya salimos. {link}\nGracias', null, 'no se usa')).toBe('Ya salimos.\nGracias');
  expect(withTrackingLink('Buenas 🚚', null, 'no se usa')).toBe('Buenas 🚚');
});

test('posición en el formato de las reglas: redondeo y rumbo/precisión solo si son válidos', () => {
  expect(positionFields(fix())).toEqual({ lat: -34.903218, lng: -56.181045, precision: 8, rumbo: 81 });
  expect(positionFields(fix({ rumbo: -1, precision: undefined }))).toEqual(expect.objectContaining({ rumbo: null, precision: null }));
  expect(positionFields(fix({ rumbo: 359.7 })).rumbo).toBe(0);
});

test('un link nuevo sale en camino con una posición reciente, si no queda preparado', () => {
  expect(newTrackingRecord('uid', '2026-10-17', NOW + 1800000, fix(), NOW, TIMESTAMP)).toEqual({
    ownerUid: 'uid', dia: '2026-10-17', vence: NOW + 1800000, actualizado: TIMESTAMP,
    estado: 'en_camino', lat: -34.903218, lng: -56.181045, precision: 8, rumbo: 81,
  });
  const stale = newTrackingRecord('uid', '2026-10-17', NOW + 1800000, fix({ at: NOW - 3 * 60000 }), NOW, TIMESTAMP);
  expect(stale).toEqual({ ownerUid: 'uid', dia: '2026-10-17', vence: NOW + 1800000, actualizado: TIMESTAMP, estado: 'preparado' });
  expect(newTrackingRecord('uid', '2026-10-17', NOW + 1800000, fix({ rumbo: undefined }), NOW, TIMESTAMP))
    .not.toHaveProperty('rumbo');
});

test('los links a punto de vencer dejan de recibir posiciones', () => {
  const links = [{ token: 'a', vence: NOW + 4000 }, { token: 'b', vence: NOW + 60000 }];
  expect(liveLinks(links, NOW).map((link) => link.token)).toEqual(['b']);
});

test('el recorrido suma un punto cada 40 metros o cada minuto', () => {
  const start = fix();
  expect(shouldAddTrailPoint(null, start)).toBe(true);
  expect(shouldAddTrailPoint(start, fix({ lat: start.lat + 0.0002, at: NOW + 15000 }))).toBe(false); // ~22 m
  expect(shouldAddTrailPoint(start, fix({ lat: start.lat + 0.0005, at: NOW + 15000 }))).toBe(true); // ~56 m
  expect(shouldAddTrailPoint(start, fix({ at: NOW + 60000 }))).toBe(true);
  expect(Math.round(distanceMeters(start, { lat: start.lat + 0.001, lng: start.lng }))).toBe(111);
});
