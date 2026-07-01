import { getNextVisitDate, toLocalDateString } from '../helpers';
import { Client } from '../../types';

// Monday 2026-06-29 10:00 local time. The scenarios below revolve around a
// Saturday client (last occurrence Sat 2026-06-27, next Sat 2026-07-04).
const FAKE_NOW = new Date(2026, 5, 29, 10, 0, 0, 0);

beforeEach(() => {
  jest.useFakeTimers({ now: FAKE_NOW.getTime() });
});

afterEach(() => {
  jest.useRealTimers();
});

const makeClient = (over: Partial<Client> = {}): Client =>
  ({
    id: 'c1',
    name: 'Test',
    freq: 'weekly',
    visitDay: 'Sábado',
    visitDays: ['Sábado'],
    specificDate: '',
    lastVisited: null,
    ...over,
  } as Client);

const key = (d: Date | null) => (d ? toLocalDateString(d) : null);

describe('getNextVisitDate — Listo tardío (cliente de sábado marcado el lunes)', () => {
  // The visit was due Sat 06-27; the user taps Listo on Monday 06-29.
  // markAsDone records doneFor = the pending occurrence (06-27).
  const late = (freq: Client['freq']) =>
    makeClient({ freq, lastVisited: new Date(2026, 5, 29, 10, 0) as any, doneFor: '2026-06-27' });

  test('weekly → próximo sábado', () => {
    expect(key(getNextVisitDate(late('weekly'), 'Sábado'))).toBe('2026-07-04');
  });

  test('biweekly → sábado en 2 semanas', () => {
    expect(key(getNextVisitDate(late('biweekly'), 'Sábado'))).toBe('2026-07-11');
  });

  test('triweekly → sábado en 3 semanas', () => {
    expect(key(getNextVisitDate(late('triweekly'), 'Sábado'))).toBe('2026-07-18');
  });

  test('monthly → sábado en 4 semanas', () => {
    expect(key(getNextVisitDate(late('monthly'), 'Sábado'))).toBe('2026-07-25');
  });

  test('sin doneFor (dato legado) la heurística da el mismo resultado', () => {
    const c = makeClient({ lastVisited: new Date(2026, 5, 29, 10, 0) as any });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-04');
  });
});

describe('getNextVisitDate — Listo anticipado (cliente al día, entrega el lunes)', () => {
  // The client is up to date (next pending Sat 07-04) and the user delivers
  // early on Monday 06-29. Without doneFor the completion gets attributed to
  // the PAST Saturday and the client never moves — the bug this field fixes.
  test('con doneFor la visita mostrada se completa y el cliente avanza un ciclo', () => {
    const c = makeClient({
      lastVisited: new Date(2026, 5, 29, 10, 0) as any,
      doneFor: '2026-07-04',
    });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-11');
  });

  test('biweekly anticipado también avanza un ciclo completo', () => {
    const c = makeClient({
      freq: 'biweekly',
      lastVisited: new Date(2026, 5, 29, 10, 0) as any,
      doneFor: '2026-07-11',
    });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-25');
  });

  test('sin doneFor el Listo anticipado NO mueve al cliente (comportamiento legado)', () => {
    const c = makeClient({ lastVisited: new Date(2026, 5, 29, 10, 0) as any });
    // Documents the legacy no-op: attribution lands on the past Saturday, so
    // the next visit stays exactly where it already was.
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-04');
  });
});

describe('getNextVisitDate — guardas de doneFor', () => {
  test('doneFor viejo respecto a un lastVisited más nuevo se ignora', () => {
    // A doneFor from a past cycle with a fresh doneFor-less completion (e.g.
    // written by the webapp) must fall back to the heuristic.
    const c = makeClient({
      lastVisited: new Date(2026, 5, 29, 10, 0) as any,
      doneFor: '2026-05-02',
    });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-04');
  });

  test('doneFor más de un ciclo en el futuro se ignora', () => {
    const c = makeClient({
      lastVisited: new Date(2026, 5, 29, 10, 0) as any,
      doneFor: '2026-08-15',
    });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-04');
  });

  test('doneFor malformado se ignora sin romper', () => {
    const c = makeClient({
      lastVisited: new Date(2026, 5, 29, 10, 0) as any,
      doneFor: 'no-es-fecha',
    });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-04');
  });
});

describe('getNextVisitDate — ventana de gracia de una visita vencida', () => {
  // Weekly Saturday client last done Sat 06-20; the 06-27 visit was missed.
  const pending = makeClient({ lastVisited: new Date(2026, 5, 20, 10, 0) as any });

  test('hasta 2 días tarde (lunes) la visita sigue pendiente', () => {
    expect(key(getNextVisitDate(pending, 'Sábado'))).toBe('2026-06-27');
  });

  test('al 3er día (martes) salta sola al próximo ciclo', () => {
    jest.setSystemTime(new Date(2026, 5, 30, 10, 0).getTime());
    expect(key(getNextVisitDate(pending, 'Sábado'))).toBe('2026-07-04');
  });
});

describe('getNextVisitDate — clientes multi-día', () => {
  test('Listo del lunes no borra la visita del jueves de la misma semana', () => {
    const c = makeClient({
      visitDay: 'Lunes',
      visitDays: ['Lunes', 'Jueves'],
      lastVisited: new Date(2026, 5, 29, 10, 0) as any,
      doneFor: '2026-06-29',
    });
    expect(key(getNextVisitDate(c, 'Jueves'))).toBe('2026-07-02');
    expect(key(getNextVisitDate(c, 'Lunes'))).toBe('2026-07-06');
  });
});

describe('getNextVisitDate — specificDate como ancla de inicio de un periódico', () => {
  // Agendado desde el directorio con "empieza el <fecha>": specificDate queda
  // como ancla y scheduleFromDirectory resetea lastVisited/doneFor.
  test('ancla futura: la primera visita es la fecha elegida', () => {
    const c = makeClient({ specificDate: '2026-07-11' });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-11');
  });

  test('ancla a dos semanas: la frecuencia no arranca antes', () => {
    const c = makeClient({ freq: 'biweekly', specificDate: '2026-07-18' });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-18');
  });

  test('ancla futura con día distinto: primer día seleccionado en o después', () => {
    // Ancla miércoles 8/7 pero visita los sábados → primera visita sáb 11/7.
    const c = makeClient({ specificDate: '2026-07-08' });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-11');
  });

  test('ancla reciente pasada (sin lastVisited): reaparece en esa semana', () => {
    // Hoy lunes 29/6, ancla sáb 27/6 → la visita del 27 sigue pendiente.
    const c = makeClient({ specificDate: '2026-06-27' });
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-06-27');
  });

  test('tras el primer Listo el ciclo sigue desde la ocurrencia completada', () => {
    // markAsDone limpia specificDate y escribe lastVisited + doneFor.
    const c = makeClient({
      freq: 'biweekly',
      specificDate: '',
      lastVisited: new Date(2026, 6, 11, 10, 0) as any,
      doneFor: '2026-07-11',
    });
    jest.setSystemTime(new Date(2026, 6, 11, 10, 1).getTime());
    expect(key(getNextVisitDate(c, 'Sábado'))).toBe('2026-07-25');
  });
});

describe('getNextVisitDate — casos base sin lastVisited', () => {
  test('cliente nuevo aparece en la próxima ocurrencia del día', () => {
    expect(key(getNextVisitDate(makeClient(), 'Sábado'))).toBe('2026-07-04');
  });

  test("freq 'once' usa specificDate tal cual", () => {
    const c = makeClient({ freq: 'once', specificDate: '2026-07-10' });
    expect(key(getNextVisitDate(c))).toBe('2026-07-10');
  });

  test("freq 'once' con specificDate malformada devuelve null", () => {
    const c = makeClient({ freq: 'once', specificDate: 'garbage' });
    expect(getNextVisitDate(c)).toBeNull();
  });
});
