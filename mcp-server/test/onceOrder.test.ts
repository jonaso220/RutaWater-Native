// Pedidos de una vez cargados desde la app: cuáles ubica el vigilante y cuáles no toca.
import type { Client } from '../../src/types';
import { withDefaults } from '../../src/utils/clientDefaults';
import { planPositionChange } from '../../src/utils/clientOrder';
import { onceKey, onceNotice, orderOnceVisits, pendingOnce } from '../src/onceOrder';
import { dayList } from '../src/views';

// 2026-11-28 es sábado.
const TODAY = '2026-11-27';
const SATURDAY = '2026-11-28';

const fixed = (id: string, order: number, lng: number | null): Client => withDefaults(id, {
  name: `Cliente ${id}`, freq: 'weekly', visitDay: 'Sábado', visitDays: ['Sábado'],
  listOrder: order, listOrders: { Sábado: order }, ...(lng === null ? {} : { lat: -34.78, lng }),
});
const once = (id: string, order: number, lng: number | null, date = SATURDAY, extra: Record<string, unknown> = {}): Client => withDefaults(id, {
  name: `Pedido ${id}`, freq: 'once', visitDay: 'Sábado', visitDays: ['Sábado'], specificDate: date,
  listOrder: order, listOrders: { Sábado: order }, ...(lng === null ? {} : { lat: -34.78, lng }), ...extra,
});
const route = () => [fixed('a', 1, -55.60), fixed('b', 2, -55.59), fixed('c', 3, -55.58), fixed('d', 4, -55.57)];
const names = (clients: Client[]) => clients.map((client) => client.id);

describe('pendingOnce', () => {
  it('toma el pedido que sigue primero del día y deja el que ya movieron', () => {
    const clients = [...route(), once('x', 0, -55.585), once('y', 2.5, -55.575)];
    const result = pendingOnce(clients, TODAY, 7, new Set());
    expect(names(result.porUbicar)).toEqual(['x']);
    expect(names(result.movidas)).toEqual(['y']);
  });

  it('no vuelve a mirar los ya tratados', () => {
    const top = once('x', 0, -55.585);
    const result = pendingOnce([...route(), top], TODAY, 7, new Set([onceKey(top)]));
    expect(result.porUbicar).toEqual([]);
    expect(result.movidas).toEqual([]);
  });

  it('sigue siendo «primero» con una nota u otro pedido sin ubicar por delante', () => {
    const note = withDefaults('n', { name: 'NOTA', isNote: true, freq: 'weekly', visitDay: 'Sábado', visitDays: ['Sábado'], listOrders: { Sábado: -3 } });
    const far = once('z', -2, -55.59, '2026-12-19');
    const clients = [...route(), note, far, once('x', -1, -55.585)];
    const result = pendingOnce(clients, TODAY, 7, new Set());
    expect(names(result.porUbicar)).toEqual(['x']);
  });

  it('un pedido que una herramienta dejó primero corta el bloque de arriba', () => {
    const placed = once('p', -1, -55.61);
    const clients = [...route(), placed, once('x', 0, -55.585)];
    const result = pendingOnce(clients, TODAY, 7, new Set([onceKey(placed)]));
    expect(names(result.movidas)).toEqual(['x']);
  });

  it('ignora los completados y los de fechas pasadas o lejanas', () => {
    const clients = [...route(), once('v', -1, -55.59, '2026-11-21'), once('w', -2, -55.59, SATURDAY, { isCompleted: true }), once('z', -3, -55.59, '2026-12-19')];
    const result = pendingOnce(clients, TODAY, 7, new Set());
    expect(result.porUbicar).toEqual([]);
    expect(result.movidas).toEqual([]);
  });
});

describe('orderOnceVisits', () => {
  const account = { uid: 'u', routes: [{ id: 'principal', name: 'Reparto 1' }], settingsDocId: 'u' } as any;
  const setup = (initial: Client[]) => {
    let clients = initial;
    const calls: Array<{ id: string; position: number }> = [];
    const move = jest.fn(async (_db: any, _account: any, list: Client[], id: string, _date: string, position: number) => {
      calls.push({ id, position });
      const day = dayList(list, 'Sábado');
      const before = day.findIndex((client) => client.id === id) + 1;
      const plan = planPositionChange(day, id, position, 'Sábado');
      clients = clients.map((client) => {
        const update = plan.updates.find((item) => item.id === client.id);
        return update ? { ...client, listOrders: { ...client.listOrders, Sábado: update.position } } : client;
      });
      const after = dayList(clients, 'Sábado');
      const index = after.findIndex((client) => client.id === id);
      return {
        cliente_id: id, nombre: after[index].name, reparto: 'Reparto 1', cambiado: true, antes: { posicion: before },
        despues: { posicion: index + 1, anterior: after[index - 1]?.name ?? null, siguiente: after[index + 1]?.name ?? null },
      };
    });
    const run = (extra: Record<string, unknown> = {}) => orderOnceVisits({
      db: {} as any, account, today: TODAY, known: new Set<string>(), loadClients: async () => clients,
      pause: async () => undefined, move: move as any, ...extra,
    });
    return { run, calls, current: () => names(dayList(clients, 'Sábado')) };
  };

  it('lo pone entre las dos paradas donde menos desvío agrega', async () => {
    const { run, calls, current } = setup([...route(), once('x', 0, -55.585)]);
    const results = await run();
    expect(calls).toEqual([{ id: 'x', position: 3 }]);
    expect(current()).toEqual(['a', 'b', 'x', 'c', 'd']);
    expect(results).toEqual([expect.objectContaining({
      cliente_id: 'x', resultado: 'ubicada', antes: 1, posicion: 3, anterior: 'Cliente b', siguiente: 'Cliente c',
    })]);
  });

  it('ubica dos del mismo día de a uno, con la lista ya actualizada', async () => {
    const { run, current } = setup([...route(), once('x', 0, -55.585), once('y', -1, -55.575)]);
    const results = await run();
    expect(results.map((result) => result.resultado)).toEqual(['ubicada', 'ubicada']);
    expect(current()).toEqual(['a', 'b', 'x', 'c', 'y', 'd']);
  });

  it('no mueve nada en modo prueba, si la ficha se está editando o si ya la movieron a mano', async () => {
    const dry = setup([...route(), once('x', 0, -55.585)]);
    expect((await dry.run({ dryRun: true }))[0]).toEqual(expect.objectContaining({ resultado: 'simulada', posicion: 3 }));
    expect(dry.calls).toEqual([]);

    const editing = setup([...route(), once('x', 0, -55.585)]);
    expect((await editing.run({ recentlyEdited: () => true }))[0].resultado).toBe('esperando');
    expect(editing.calls).toEqual([]);

    const byHand = setup([...route(), once('y', 2.5, -55.60)]);
    expect((await byHand.run())[0]).toEqual(expect.objectContaining({ resultado: 'movida_a_mano', posicion: 3 }));
    expect(byHand.calls).toEqual([]);
  });

  it('sin coordenadas lo deja primero y lo dice', async () => {
    const { run, calls } = setup([...route(), once('x', 0, null)]);
    const results = await run();
    expect(results[0].resultado).toBe('sin_coordenadas');
    expect(results[0].motivo).toMatch(/no tiene coordenadas/);
    expect(calls).toEqual([]);
    expect(onceNotice(results)).toMatch(/No pude ubicar este pedido de una vez, quedó primero/);
  });

  it('si el movimiento falla se corta y lo deja para la próxima vuelta', async () => {
    const { run } = setup([...route(), once('x', 0, -55.585), once('y', -1, -55.575)]);
    const results = await run({ move: async () => { throw new Error('El orden de ese día cambió mientras tanto'); } });
    expect(results).toEqual([expect.objectContaining({ cliente_id: 'x', resultado: 'no_se_pudo' })]);
    expect(onceNotice(results)).toBe('');
  });
});

describe('onceNotice', () => {
  it('cuenta dónde quedó cada uno', () => {
    const text = onceNotice([{
      clave: 'x|2026-11-28', cliente_id: 'x', nombre: 'Pedido x', reparto: 'Reparto 1', fecha: SATURDAY,
      resultado: 'ubicada', antes: 1, posicion: 6, anterior: 'Cliente b', siguiente: 'Cliente c', paradas_sin_ubicacion: 1,
    }]);
    expect(text).toContain('Ubiqué en el recorrido el pedido de una vez que cargaste:');
    expect(text).toContain('• Pedido x, sábado 28/11: posición 6, entre Cliente b y Cliente c (1 parada sin ubicación no entraron en la cuenta).');
  });
});
