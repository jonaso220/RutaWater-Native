import { parseMoneyInput } from '../helpers';

describe('parseMoneyInput — formato rioplatense', () => {
  test('enteros simples', () => {
    expect(parseMoneyInput('500')).toBe(500);
    expect(parseMoneyInput(' 1500 ')).toBe(1500);
    expect(parseMoneyInput('$ 800')).toBe(800);
  });

  test('coma como separador decimal', () => {
    expect(parseMoneyInput('150,50')).toBe(150.5);
    expect(parseMoneyInput('0,99')).toBe(0.99);
    expect(parseMoneyInput('1500,5')).toBe(1500.5);
  });

  test('punto de miles (el caso que parseFloat rompía)', () => {
    expect(parseMoneyInput('1.500')).toBe(1500);
    expect(parseMoneyInput('12.000')).toBe(12000);
    expect(parseMoneyInput('1.234.567')).toBe(1234567);
  });

  test('miles con punto + decimales con coma', () => {
    expect(parseMoneyInput('1.500,75')).toBe(1500.75);
    expect(parseMoneyInput('12.345,05')).toBe(12345.05);
  });

  test('punto decimal estilo calculadora (1-2 decimales)', () => {
    expect(parseMoneyInput('150.50')).toBe(150.5);
    expect(parseMoneyInput('99.9')).toBe(99.9);
    expect(parseMoneyInput('1.5')).toBe(1.5);
  });

  test('entradas inválidas devuelven NaN (el caller las rechaza)', () => {
    expect(parseMoneyInput('')).toBeNaN();
    expect(parseMoneyInput('   ')).toBeNaN();
    expect(parseMoneyInput('abc')).toBeNaN();
    expect(parseMoneyInput('12a')).toBeNaN();
    expect(parseMoneyInput('1,2,3')).toBeNaN();
    expect(parseMoneyInput('1.50.0')).toBeNaN();
    expect(parseMoneyInput('-100')).toBeNaN();
    expect(parseMoneyInput(null)).toBeNaN();
    expect(parseMoneyInput(undefined)).toBeNaN();
  });

  test('redondea a 2 decimales', () => {
    expect(parseMoneyInput('10,999')).toBe(11);
  });
});
