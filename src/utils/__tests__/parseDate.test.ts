import { parseDate } from '../helpers';

// parseDate es el conversor canónico Timestamp/Date/{seconds}/string → Date.
// Estos tests fijan el contrato para que las pantallas que dependen de él
// (recencia, deudas, transferencias, export, undo) no diverjan de nuevo.
describe('parseDate', () => {
  const when = new Date(2026, 5, 15, 14, 30, 0, 0);

  it('convierte un Timestamp de Firestore usando .toDate()', () => {
    const timestamp = {
      seconds: Math.floor(when.getTime() / 1000),
      nanoseconds: 0,
      toDate: () => new Date(when.getTime()),
    };
    expect(parseDate(timestamp)?.getTime()).toBe(when.getTime());
  });

  it('convierte un objeto plano {seconds} (dato serializado, sin métodos)', () => {
    const plain = { seconds: Math.floor(when.getTime() / 1000), nanoseconds: 0 };
    const result = parseDate(plain);
    expect(result).toBeInstanceOf(Date);
    expect(result?.getTime()).toBe(Math.floor(when.getTime() / 1000) * 1000);
  });

  it('acepta un Date de JS tal cual (write local sin eco del servidor)', () => {
    expect(parseDate(when)?.getTime()).toBe(when.getTime());
  });

  it('parsea strings ISO', () => {
    const iso = when.toISOString();
    expect(parseDate(iso)?.getTime()).toBe(when.getTime());
  });

  it('parsea yyyy-mm-dd a mediodía LOCAL (sin off-by-one UTC)', () => {
    const result = parseDate('2026-07-05');
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(6);
    expect(result?.getDate()).toBe(5);
    expect(result?.getHours()).toBe(12);
  });

  it('devuelve null para vacíos e inválidos', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('no es una fecha')).toBeNull();
    expect(parseDate(new Date('invalid'))).toBeNull();
  });
});
