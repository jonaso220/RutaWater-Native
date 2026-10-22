import fs from 'fs';
import os from 'os';
import path from 'path';
import { quotaDay, ReadBudget, ReadLimitError } from '../src/readBudget';

describe('tope diario de cargas completas', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rutawater-cargas-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('el día de la cuota cambia a la medianoche del Pacífico (04:00 en Uruguay en octubre)', () => {
    expect(quotaDay(new Date('2026-10-17T06:59:00Z'))).toBe('2026-10-16');
    expect(quotaDay(new Date('2026-10-17T07:00:00Z'))).toBe('2026-10-17');
  });

  test('suma las cargas de varios procesos y corta al llegar al tope', () => {
    const now = () => new Date('2026-10-16T15:00:00Z');
    const first = new ReadBudget(dir, 2, now);
    const second = new ReadBudget(dir, 2, now);
    first.check('clients de «Reparto 1»');
    first.record('clients de «Reparto 1»', 400);
    second.check('debts de «Reparto 1»');
    second.record('debts de «Reparto 1»', 120);
    expect(() => second.check('clients de «Costa»')).toThrow(ReadLimitError);
    expect(() => first.check('clients de «Costa»')).toThrow(
      /límite diario de 2 cargas.*hoy: 2 cargas, 520 documentos.*clients de «Costa».*04:00 hora de Uruguay/,
    );
  });

  test('al día siguiente de la cuota vuelve a permitir, y en invierno de EE. UU. reinicia a las 05:00', () => {
    let now = new Date('2026-12-01T20:00:00Z');
    const budget = new ReadBudget(dir, 1, () => now);
    budget.record('clients de «Reparto 1»', 10);
    expect(() => budget.check('clients de «Reparto 1»')).toThrow('05:00 hora de Uruguay');
    now = new Date('2026-12-02T08:00:00Z');
    expect(() => budget.check('clients de «Reparto 1»')).not.toThrow();
  });

  test('corta a un proceso que lee demasiado en una hora, sin frenar a los demás', () => {
    let now = new Date('2026-10-22T15:00:00Z');
    const budget = new ReadBudget(dir, 250, () => now, 1000);
    budget.record('clients de «Reparto 1»', 756);
    expect(() => budget.check('debts de «Reparto 1»')).not.toThrow();
    budget.record('debts de «Reparto 1»', 300);
    expect(() => budget.check('clients de «Reparto 1»')).toThrow(/ya leyó 1056 documentos en la última hora/);
    // Otro proceso que leyó mucho no cuenta para este.
    fs.appendFileSync(path.join(dir, '2026-10-22.jsonl'), `${JSON.stringify({ at: now.toISOString(), pid: process.pid + 1, carga: 'x', docs: 5000 })}\n`);
    now = new Date('2026-10-22T16:01:00Z');
    expect(() => budget.check('clients de «Reparto 1»')).not.toThrow();
  });

  test('0 es sin tope', () => {
    const budget = new ReadBudget(dir, 0);
    budget.record('clients de «Reparto 1»', 10);
    expect(() => budget.check('clients de «Reparto 1»')).not.toThrow();
  });
});
