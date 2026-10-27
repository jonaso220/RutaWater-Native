import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rutawater-historial-'));
process.env.RUTAWATER_HISTORIAL_DIR = dir;

// eslint-disable-next-line import/first
import { DeliveryRow, loadPhotoRows, mergeHistory, summarizeHistory } from '../src/deliveries';

const catalog = [{ id: 'b20', nombre: '20L' }, { id: 'soda', nombre: 'Soda' }];
const photo = (fecha: string, registros: Array<Record<string, unknown>>) =>
  fs.writeFileSync(path.join(dir, `${fecha}.json`), JSON.stringify({ fecha, registros }));
const record = (fecha: string, extra: Partial<DeliveryRow> = {}): DeliveryRow => ({
  fecha, cliente_id: 'ana', customer_id: 'ana', nombre: 'Ana', direccion: 'Calle 1', entrega: true,
  productos: { b20: 2 }, origen: 'registro', fuente: 'assistant', ...extra,
});

describe('historia de entregas', () => {
  beforeAll(() => {
    photo('2026-10-07', [{ id: 'ana', nombre: 'Ana', productos: { '20L': 2, Soda: 6 } }, { id: 'otro', productos: { '20L': 1 } }]);
    photo('2026-10-14', [{ id: 'ana', nombre: 'Ana', productos: { '20L': 2 } }]);
    photo('2026-10-21', [{ id: 'ana', nombre: 'Ana', productos: { '20L': 2 } }]);
    photo('2026-10-28', [{ id: 'ana', nombre: 'Ana', productos: { '20L': 2 } }]);
  });

  test('las fotos pasan los nombres de producto a id y se filtran por cliente y fecha', () => {
    const rows = loadPhotoRows(catalog, { ids: new Set(['ana']), desde: '2026-10-07', hasta: '2026-10-14' });
    expect(rows.map((row) => [row.fecha, row.productos, row.origen])).toEqual([
      ['2026-10-07', { b20: 2, soda: 6 }, 'foto'], ['2026-10-14', { b20: 2 }, 'foto'],
    ]);
  });

  test('el registro gana sobre la foto; desde que registra la app, la foto sin registro no cuenta', () => {
    const photos = loadPhotoRows(catalog, { ids: new Set(['ana']) });
    const records = [record('2026-10-21', { entrega: false, productos: {} })];
    expect(mergeHistory(records, photos, '').map((row) => [row.fecha, row.origen]))
      .toEqual([['2026-10-07', 'foto'], ['2026-10-14', 'foto'], ['2026-10-21', 'registro'], ['2026-10-28', 'foto']]);
    expect(mergeHistory(records, photos, '2026-10-21').map((row) => row.fecha))
      .toEqual(['2026-10-07', '2026-10-14', '2026-10-21']);
  });

  test('resumen: qué suele llevar, cada cuánto y cuántas veces no necesitó', () => {
    const rows = mergeHistory([record('2026-10-21', { entrega: false, productos: {} }), record('2026-10-28')],
      loadPhotoRows(catalog, { ids: new Set(['ana']) }), '');
    const summary = summarizeHistory({ id: 'ana', name: 'Ana' } as any, rows, '2026-10-28');
    expect(summary).toMatchObject({
      visitas_registradas: 4, desde: '2026-10-07', ultima_entrega: '2026-10-28', no_necesito: 1,
      entregas_90_dias: 3, productos_90_dias: { b20: 6, soda: 6 },
      suele_llevar: { productos: { b20: 2 }, veces: 2, de: 3 }, dias_entre_entregas: 14,
    });
    expect(summary.ultimas[0]).toEqual({ fecha: '2026-10-28', productos: { b20: 2 } });
    expect(summary.ultimas[1]).toEqual({ fecha: '2026-10-21', no_necesito: true });
    expect(summary.ultimas[3]).toMatchObject({ segun: expect.stringContaining('agenda') });
  });
});
