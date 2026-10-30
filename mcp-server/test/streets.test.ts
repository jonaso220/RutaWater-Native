// Dirección armada con las calles del mapa: usa la zona guardada sin consultar Overpass.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addressFromMap } from '../src/streets';

const way = (id: number, name: string, nodes: number[], points: Array<[number, number]>) => ({
  type: 'way', id, nodes, tags: { highway: 'residential', name }, geometry: points.map(([lat, lon]) => ({ lat, lon })),
});

describe('dirección desde el mapa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calles-'));
  beforeAll(() => {
    process.env.RUTAWATER_CALLES_DIR = dir;
    fs.writeFileSync(path.join(dir, 'calles-zona.json'), JSON.stringify({ elements: [
      way(1, 'Calle Uno', [1, 2, 3, 4], [[-34.8, -55.91], [-34.8, -55.902], [-34.8, -55.898], [-34.8, -55.89]]),
      way(2, 'Calle Dos', [10, 2, 11], [[-34.81, -55.902], [-34.8, -55.902], [-34.79, -55.902]]),
      way(3, 'Calle Tres', [20, 3, 21], [[-34.81, -55.898], [-34.8, -55.898], [-34.79, -55.898]]),
    ] }));
  });
  afterAll(() => {
    delete process.env.RUTAWATER_CALLES_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const offline = (async () => { throw new Error('sin red'); }) as unknown as typeof fetch;

  test('calle y esquinas; manzana y solar de la actual', async () => {
    const point = { lat: -34.80005, lng: -55.9 };
    const kept = await addressFromMap(point, 'Calle Uno M. 5 Sol. 7', offline);
    expect(kept.direccion).toBe('Calle Uno M. 5 Sol. 7 esq. Calle Tres y Calle Dos');
    expect(kept.dudas).toEqual([]);
    const moved = await addressFromMap(point, '', offline);
    expect(moved).toMatchObject({ direccion: 'Calle Uno esq. Calle Tres y Calle Dos', dudas: [] });
  });

  test('fuera de las zonas guardadas consulta el mapa, y si falla avisa', async () => {
    await expect(addressFromMap({ lat: -34.5, lng: -55.5 }, '', offline)).rejects.toThrow('pasá la dirección escrita');
  });
});
