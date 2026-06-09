// Verificación de getNextVisitDate — modelo de ciclo anclado al DÍA del
// cliente (no a la fecha real de entrega), con 2 días de gracia para visitas
// no entregadas. Ejecutar: npx tsx tools/test_nextvisit.ts
import { getNextVisitDate } from '../src/utils/helpers';

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const today = new Date();
today.setHours(0, 0, 0, 0);

const addDays = (base: Date, n: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};
const dayName = (d: Date) => DAY_NAMES[d.getDay()];
const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'null');

// Cliente mínimo; el resto de campos no participa en getNextVisitDate.
const mkClient = (freq: string, visitDays: string[], lastVisited: Date | null): any => ({
  freq,
  visitDay: visitDays[0],
  visitDays,
  lastVisited: lastVisited ? lastVisited.toISOString() : undefined,
});

let failures = 0;
const check = (label: string, actual: Date | null, expected: Date) => {
  const ok = actual !== null && actual.getTime() === expected.getTime();
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label}\n     esperado ${iso(expected)} (${expected && dayName(expected)}), obtuvo ${iso(actual)}${actual ? ` (${dayName(actual)})` : ''}`);
};

const todayName = dayName(today);
const dayPlus3 = addDays(today, 3);

console.log(`Hoy: ${iso(today)} (${todayName})\n`);

// ── Multi-día: "Listo" un día no afecta los demás días ──
{
  const c = mkClient('weekly', [todayName, dayName(dayPlus3)], today);
  check('Semanal multi-día: el OTRO día de esta semana se mantiene', getNextVisitDate(c, dayName(dayPlus3)), dayPlus3);
  check('Semanal multi-día: el día servido pasa a la semana próxima', getNextVisitDate(c, todayName), addDays(today, 7));

  const cq = mkClient('biweekly', [todayName, dayName(dayPlus3)], today);
  check('Quincenal multi-día: el OTRO día de la semana activa se mantiene', getNextVisitDate(cq, dayName(dayPlus3)), dayPlus3);
  check('Quincenal multi-día: el día servido vuelve en 14 días', getNextVisitDate(cq, todayName), addDays(today, 14));
}

// ── Entrega a tiempo / temprana (semántica preservada) ──
{
  check('Semanal servido hoy: vuelve en 7 días', getNextVisitDate(mkClient('weekly', [todayName], today), todayName), addDays(today, 7));
  check('Quincenal servido hoy: vuelve en 14 días', getNextVisitDate(mkClient('biweekly', [todayName], today), todayName), addDays(today, 14));

  const target = addDays(today, 2);
  check('Semanal servido temprano: consume el slot próximo (+7)', getNextVisitDate(mkClient('weekly', [dayName(target)], today), dayName(target)), addDays(target, 7));
  check('Quincenal servido temprano: el slot consumido espera 14 días', getNextVisitDate(mkClient('biweekly', [dayName(target)], today), dayName(target)), addDays(target, 14));
}

// ── NUEVO: entrega tarde mantiene el día y el ritmo ──
{
  // Semanal de (hoy+2): tocaba hace 5 días, entregado hace 4 (1 día tarde).
  // Antes: salteaba una semana (+9 días). Ahora: vuelve en su día normal.
  const target = addDays(today, 2);
  check('Semanal servido 1 día tarde: vuelve en su día normal', getNextVisitDate(mkClient('weekly', [dayName(target)], addDays(today, -4)), dayName(target)), target);

  // Quincenal de (día de hoy): tocaba hace 14, entregado hace 13 (1 día tarde).
  // Antes: 20 días sin reparto. Ahora: vuelve HOY (~13 días después de la entrega).
  check('Quincenal servido 1 día tarde: mantiene su ciclo (hoy)', getNextVisitDate(mkClient('biweekly', [todayName], addDays(today, -13)), todayName), today);
}

// ── NUEVO: gracia de 2 días para visitas no entregadas ──
{
  // Semanal de ayer, servido a tiempo la semana pasada, ayer no entregado:
  // dentro de la gracia → sigue pendiente (fecha de ayer ⇒ agrupa en "Hoy").
  const yesterday = addDays(today, -1);
  check('Perdido hace 1 día: sigue pendiente (gracia)', getNextVisitDate(mkClient('weekly', [dayName(yesterday)], addDays(today, -8)), dayName(yesterday)), yesterday);

  // Semanal de hace 3 días, servido a tiempo la semana pasada: fuera de la
  // gracia → salta solo a su próxima semana.
  const threeAgo = addDays(today, -3);
  check('Perdido hace 3 días: salta a la próxima semana', getNextVisitDate(mkClient('weekly', [dayName(threeAgo)], addDays(today, -10)), dayName(threeAgo)), addDays(threeAgo, 7));

  // Quincenal con visita perdida hace 3 días (licencia): salta al próximo
  // ciclo manteniendo la paridad — como si se le hubiera dado Listo.
  check('Quincenal perdido hace 3 días: próximo ciclo (paridad)', getNextVisitDate(mkClient('biweekly', [dayName(threeAgo)], addDays(today, -17)), dayName(threeAgo)), addDays(threeAgo, 14));
}

// ── Sin historial / casos base ──
{
  check('Semanal sin lastVisited: toca hoy', getNextVisitDate(mkClient('weekly', [todayName], null), todayName), today);
  check('Semanal con visita de hace 8 días: toca hoy', getNextVisitDate(mkClient('weekly', [todayName], addDays(today, -8)), todayName), today);
  check('Mensual con visita de hace 28 días: toca hoy', getNextVisitDate(mkClient('monthly', [todayName], addDays(today, -28)), todayName), today);
  check('Quincenal con visita de hace 7 días: espera su ciclo (+7)', getNextVisitDate(mkClient('biweekly', [todayName], addDays(today, -7)), todayName), addDays(today, 7));
}

// ── Guard de 'once' con specificDate malformada (no debe crashear) ──
{
  const cOk: any = { freq: 'once', visitDay: 'Lunes', visitDays: ['Lunes'], specificDate: '2026-06-15' };
  const r1 = getNextVisitDate(cOk, 'Lunes');
  const ok1 = r1 !== null && iso(r1) === '2026-06-15';
  if (!ok1) failures++;
  console.log(`${ok1 ? '✅' : '❌'} Once con fecha válida: devuelve la fecha`);

  const cBad: any = { freq: 'once', visitDay: 'Lunes', visitDays: ['Lunes'], specificDate: '2026-6-9' };
  const r2 = getNextVisitDate(cBad, 'Lunes');
  const ok2 = r2 === null || !isNaN(r2.getTime());
  if (!ok2) failures++;
  console.log(`${ok2 ? '✅' : '❌'} Once con fecha malformada: null o fecha válida, nunca Invalid Date (obtuvo ${r2 === null ? 'null' : iso(r2)})`);
}

console.log(`\n${failures === 0 ? 'TODOS LOS CASOS PASAN' : `${failures} CASOS FALLAN`}`);
process.exit(failures === 0 ? 0 : 1);
