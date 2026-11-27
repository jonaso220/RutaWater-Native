// A quién se le manda el aviso y el recordatorio, con qué texto y a qué número.
import type { Client } from '../../src/types';
import { withDefaults } from '../../src/utils/clientDefaults';
import { buildNoticeList, exceptionFor, NoticeRules, Progress, variantFor } from '../src/noticeList';
import { addDays, todayKey, weekdayOf } from '../src/views';

// Las fichas de prueba son semanales de viernes sin visitas previas: su próxima visita es el viernes que viene (u hoy).
const FRIDAY = [0, 1, 2, 3, 4, 5, 6].map((days) => addDays(todayKey(), days)).find((date) => weekdayOf(date) === 'Viernes')!;
const DAY_BEFORE = addDays(FRIDAY, -1);
const TEMPLATE = 'Buenas 👋 Te escribo para recordarte que mañana andaremos por tu casa 🚛💧\n\n¡Saludos! 😃';
const REMINDER = '¡Buenas! 👋 Te escribo de nuevo';

const client = (id: string, order: number, extra: Record<string, unknown> = {}): Client => withDefaults(id, {
  name: `Cliente ${id}`, address: `Calle ${id}`, phone: `09900000${order}`, freq: 'weekly', visitDay: 'Viernes', visitDays: ['Viernes'],
  listOrder: order, listOrders: { Viernes: order }, ...extra,
});
const rules = (excepciones: NoticeRules['excepciones']): NoticeRules => ({
  excepciones, textos: { recordatorio: REMINDER, propios: { saludo: ['Variante 0', 'Variante 1', 'Variante 2'] } },
});
const exception = (clave: string, fichas: string[], extra: Record<string, unknown> = {}) => ({
  clave, nombre: clave, fichas, aviso: true, recordatorio: true, ...extra,
});
const sent = (ids: string[], at = `${DAY_BEFORE}T09:15:00-03:00`): Progress => Object.fromEntries(
  ids.map((id) => [`reparto 1|Reparto 1|${id}`, { status: 'sent', confirmed_at: at }]),
);
const names = (items: Array<{ cliente_id: string }>) => items.map((item) => item.cliente_id);

describe('buildNoticeList: aviso', () => {
  it('manda a los de la fecha, en orden, y saltea estrella, pedido de una vez, notas y excluidos', () => {
    const clients = [
      client('a', 1), client('b', 2, { isStarred: true }), client('c', 3),
      client('d', 4, { freq: 'once', specificDate: FRIDAY }),
      client('n', 5, { isNote: true }), client('e', 6),
    ];
    const list = buildNoticeList({ clients, date: FRIDAY, kind: 'aviso', template: TEMPLATE, rules: rules([exception('fuera', ['c'], { aviso: false, recordatorio: false, motivo: 'lista permanente' })]) });
    expect(names(list.mandar)).toEqual(['a', 'e']);
    expect(list.mandar[0]).toEqual(expect.objectContaining({ texto: TEMPLATE, clave: 'a', destinatario: 'Cliente a', posicion: 1 }));
    expect(list.omitidos.map((item) => [item.cliente_id, item.motivo])).toEqual([
      ['b', 'favorito (estrella)'], ['c', 'excluido: lista permanente'], ['d', 'pedido de una vez'],
    ]);
    expect(list.revisar).toEqual([]);
  });

  it('cambia «por tu casa» y no repite lo que ya salió', () => {
    const clients = [client('a', 1), client('b', 2)];
    const list = buildNoticeList({
      clients, date: FRIDAY, kind: 'aviso', template: TEMPLATE, firstPass: sent(['b']),
      rules: rules([exception('local', ['a'], { reemplazo_por_tu_casa: 'por el local' })]),
    });
    expect(list.mandar).toHaveLength(1);
    expect(list.mandar[0].texto).toContain('andaremos por el local 🚛');
    expect(list.omitidos).toEqual([expect.objectContaining({ cliente_id: 'b', motivo: 'aviso ya enviado' })]);
  });

  it('manda al familiar en lugar del cliente, o a los dos', () => {
    const clients = [client('taller', 1), client('pareja', 2), client('fam1', 90, { visitDays: ['Sábado'], visitDay: 'Sábado' }), client('fam2', 91, { freq: 'on_demand', visitDays: [] })];
    const list = buildNoticeList({
      clients, date: FRIDAY, kind: 'aviso', template: TEMPLATE,
      rules: rules([
        exception('taller', ['taller'], { reemplazo_por_tu_casa: 'por el taller', destinatarios: { modo: 'en_lugar', a: [{ ficha: 'fam1', nombre: 'Familiar Uno' }] } }),
        exception('pareja', ['pareja'], { destinatarios: { modo: 'ademas', a: [{ ficha: 'fam2', nombre: 'Familiar Dos' }] } }),
      ]),
    });
    expect(list.mandar.map((item) => [item.cliente_id, item.destinatario_id, item.clave, item.grupo])).toEqual([
      ['taller', 'fam1', 'taller', undefined],
      ['pareja', 'pareja', 'pareja::dest:cliente-pareja', 'pareja'],
      ['pareja', 'fam2', 'pareja::dest:familiar-dos', 'pareja'],
    ]);
    expect(list.mandar[0].texto).toContain('por el taller');
    expect(list.mandar[0].telefono).not.toBe(list.mandar[1].telefono);
  });

  it('el texto propio rota: una variante distinta cada semana', () => {
    const variants = ['Variante 0', 'Variante 1', 'Variante 2'];
    const weeks = ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25'].map((date) => variantFor(date, variants));
    expect(new Set(weeks.slice(0, 3)).size).toBe(3);
    expect(weeks[3]).toBe(weeks[0]);
    const list = buildNoticeList({ clients: [client('p', 1)], date: FRIDAY, kind: 'aviso', template: TEMPLATE, rules: rules([exception('propio', ['p'], { texto_propio: 'saludo', texto_propio_dia: 'Viernes' })]) });
    expect(list.mandar[0].texto).toBe(variantFor(FRIDAY, variants));
  });

  it('reconoce a la misma persona en otra ficha', () => {
    const listed = client('vieja', 50, { freq: 'on_demand', visitDays: [], name: 'Local', address: 'Calle Uno esq. Calle Dos' });
    const again = client('nueva', 1, { name: 'local', address: 'CALLE UNO esq. Calle Dos' });
    const linked = client('otra', 2, { customerId: 'vieja' });
    const r = rules([{ ...exception('local', ['vieja'], { aviso: false, recordatorio: false }), nombre: 'Local', direccion: 'Calle Uno esq. Calle Dos' }]);
    expect(exceptionFor(again, [listed, again, linked], r)?.clave).toBe('local');
    expect(exceptionFor(linked, [listed, again, linked], r)?.clave).toBe('local');
    expect(exceptionFor(client('x', 3), [listed], r)).toBeNull();
  });
});

describe('buildNoticeList: recordatorio', () => {
  it('va solo a quien recibió el aviso, con la hora desde la que cuenta una respuesta', () => {
    const clients = [client('a', 1), client('b', 2), client('c', 3), client('d', 4)];
    const list = buildNoticeList({
      clients, date: FRIDAY, kind: 'recordatorio', template: TEMPLATE,
      firstPass: sent(['a', 'c', 'd']), secondPass: sent(['d'], `${DAY_BEFORE}T18:05:00-03:00`),
      rules: rules([exception('solo-aviso', ['c'], { recordatorio: false, motivo: 'segundo mensaje' })]),
    });
    expect(list.mandar).toEqual([expect.objectContaining({ cliente_id: 'a', texto: REMINDER, frenar_si_escribio_desde: `${DAY_BEFORE} 09:15` })]);
    expect(list.omitidos.map((item) => [item.cliente_id, item.motivo])).toEqual([
      ['c', 'sin recordatorio: segundo mensaje'], ['d', 'recordatorio ya enviado'],
    ]);
    expect(list.revisar).toEqual([expect.objectContaining({ cliente_id: 'b', motivo: expect.stringContaining('sin aviso inicial verificado') })]);
  });

  it('a quien se le marca Listo si no contesta no se le manda y se avisa desde cuándo mirar', () => {
    const clients = [client('s', 1)];
    const list = buildNoticeList({
      clients, date: FRIDAY, kind: 'recordatorio', template: TEMPLATE, firstPass: sent(['s']),
      rules: rules([exception('silencio', ['s'], { recordatorio: false, si_no_contesta: 'listo', motivo: 'Listo si no contestó' })]),
    });
    expect(list.mandar).toEqual([]);
    expect(list.omitidos).toEqual([expect.objectContaining({ cliente_id: 's', accion: 'listo_si_no_contesto', desde: `${DAY_BEFORE} 09:15` })]);
  });
});

describe('setNoticeException', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { setNoticeException, readNoticeRules } = require('../src/noticeFiles');
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-'));
    process.env.RUTAWATER_AVISOS_DIR = dir;
    fs.writeFileSync(path.join(dir, 'avisos-excepciones.json'), JSON.stringify({ version: 1, excepciones: [], textos: { recordatorio: REMINDER } }));
  });
  afterEach(() => { delete process.env.RUTAWATER_AVISOS_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

  it('crea la excepción para todas las fichas de la persona y la saca cuando vuelve a lo común', () => {
    const a = client('a', 1, { name: 'Local', address: 'Calle Uno' });
    const again = client('a2', 50, { name: 'Local', address: 'Calle Uno', freq: 'on_demand', visitDays: [] });
    const all = [a, again, client('b', 2)];
    const first = setNoticeException(a, all, { recordatorio: false, motivo: 'no quiere el segundo mensaje' }, '2026-11-27');
    expect(first).toEqual(expect.objectContaining({ cambiado: true, fichas: 2, despues: { aviso: true, recordatorio: false, texto: 'por tu casa' } }));
    expect(readNoticeRules().excepciones[0]).toEqual(expect.objectContaining({ fichas: ['a', 'a2'], recordatorio: false, motivo: 'no quiere el segundo mensaje (Jonathan, 2026-11-27)' }));
    expect(setNoticeException(a, all, { recordatorio: false }, '2026-11-27').cambiado).toBe(false);
    expect(setNoticeException(again, all, { texto_por_tu_casa: 'por el local' }, '2026-11-28').despues.texto).toBe('por el local');
    expect(setNoticeException(a, all, { aviso: false }, '2026-11-28').despues).toEqual({ aviso: false, recordatorio: false, texto: 'por el local' });
    setNoticeException(a, all, { aviso: true, recordatorio: true, texto_por_tu_casa: '' }, '2026-11-29');
    expect(readNoticeRules().excepciones).toEqual([]);
    expect(readNoticeRules().textos.recordatorio).toBe(REMINDER);
  });
});
