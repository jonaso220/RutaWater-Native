/**
 * Test: la IA debe buscar primero en LISTA DE CLIENTES antes de crear un cliente nuevo.
 *
 * Cada caso pasa SI el tool elegido NO es `create_new_client` y matchea al cliente
 * esperado por id. Casos negativos (cliente nuevo real) sí esperan `create_new_client`.
 *
 * Uso:
 *   cd local-server && node test-directory-lookup.js
 *
 * Requiere ANTHROPIC_API_KEY en local-server/.env.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: falta ANTHROPIC_API_KEY en local-server/.env');
  process.exit(1);
}

const { parseOrder } = require('./lib/anthropic');

const TODAY = '2026-05-04'; // Lunes

const CLIENTS = [
  {
    id: 'c_barbara',
    name: 'Barbara Silveira',
    address: 'Medanos de Solymar Eden Rok M22 S35, Esquina entre Jaguel e Indiana',
    mapsLink: 'https://maps.app.goo.gl/abc123',
    phone: '',
    notes: '',
    freq: 'on_demand',
    visitDay: '',
    specificDate: '',
    products: {},
  },
  {
    id: 'c_akita',
    name: 'Akita Pinar',
    address: 'Jose P. Varela M. 38 Sol. 20',
    mapsLink: '',
    phone: '',
    notes: 'REPO',
    freq: 'weekly',
    visitDay: 'Lunes',
    specificDate: '',
    products: { b20: 2 },
  },
  {
    id: 'c_plasticos',
    name: 'Plasticos Mica',
    address: 'Av. Italia 4500',
    mapsLink: '',
    phone: '',
    notes: '',
    freq: 'on_demand',
    visitDay: '',
    specificDate: '',
    products: {},
  },
  {
    id: 'c_maria_l',
    name: 'Maria Lopez',
    address: '18 de Julio 1234',
    mapsLink: '',
    phone: '',
    notes: '',
    freq: 'weekly',
    visitDay: 'Martes',
    specificDate: '',
    products: { b12: 1 },
  },
  {
    id: 'c_maria_g',
    name: 'Maria Gonzalez',
    address: 'Rivera 800',
    mapsLink: '',
    phone: '',
    notes: '',
    freq: 'on_demand',
    visitDay: '',
    specificDate: '',
    products: {},
  },
  {
    id: 'c_juan',
    name: 'Juan Pérez',
    address: 'Bulevar España 2100',
    mapsLink: '',
    phone: '099000111',
    notes: '',
    freq: 'on_demand',
    visitDay: '',
    specificDate: '',
    products: {},
  },
  {
    id: 'c_farmacia',
    name: 'Farmacia Central',
    address: 'Plaza Independencia 750',
    mapsLink: '',
    phone: '',
    notes: '',
    freq: 'weekly',
    visitDay: 'Miércoles',
    specificDate: '',
    products: { b20: 3 },
  },
  {
    id: 'c_couste',
    name: 'Manuel Couste',
    address: 'Solano García 2300',
    mapsLink: '',
    phone: '',
    notes: '',
    freq: 'on_demand',
    visitDay: '',
    specificDate: '',
    products: {},
  },
];

// Casos. Cada uno: { name, text, expect: { not_create_new?, tool?, match_id? } }
// - not_create_new: el resultado NO debe ser create_new_client
// - tool: el tool exacto que debe devolver (opcional)
// - match_id: si aplica, debe matchear este id
const CASES = [
  // 1. Caso del bug original: ficha completa, nombre exacto en MAYÚSCULAS.
  {
    name: 'Ficha MAYUSCULAS sin pedido (bug original)',
    text:
      'BARBARA SILVEIRA - MEDANOS DE SOLYMAR EDEN ROK M22 S35  Esquina: ENTRE JAGUEL E INDIANA - https://maps.app.goo.gl/GHxytS6W9Z1i7NHB6?g_st=ic',
    expect: { not_create_new: true, match_id: 'c_barbara' },
  },
  // 2. Ficha completa pidiendo agendar para el lunes.
  {
    name: 'Ficha + agendar lunes',
    text:
      'Agendá a BARBARA SILVEIRA para el lunes con 3 botellones - MEDANOS DE SOLYMAR EDEN ROK M22 S35 - https://maps.app.goo.gl/abc',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_barbara' },
  },
  // 3. Ficha completa pero con dirección distinta a la de la LISTA.
  {
    name: 'Ficha con dirección distinta (mismo nombre)',
    text:
      'Barbara Silveira - Calle Falsa 123, Esquina Avenida Siempreviva - https://maps.app.goo.gl/different',
    expect: { not_create_new: true, match_id: 'c_barbara' },
  },
  // 4. Ficha con maps link diferente.
  {
    name: 'Ficha con maps link distinto',
    text:
      'Barbara Silveira - Medanos de Solymar - https://maps.app.goo.gl/UPDATED_LINK_xyz',
    expect: { not_create_new: true, match_id: 'c_barbara' },
  },
  // 5. Substring (zona/aclaración extra después).
  {
    name: 'Substring: Akita Pinar Viñale',
    text: 'agendá a Akita Pinar Viñale 3 bidones para el martes',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_akita' },
  },
  // 6. Substring con barrio: Plasticos Mica Solymar.
  {
    name: 'Substring: Plasticos Mica Solymar',
    text: 'movélo a Plasticos Mica Solymar al jueves con 2 b20',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_plasticos' },
  },
  // 7. Substring con calle: Maria Lopez del 18 de Julio.
  {
    name: 'Substring: Maria Lopez del 18 de Julio',
    text: 'agendá a Maria Lopez del 18 de Julio para el viernes',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_maria_l' },
  },
  // 8. Sin tildes en el texto vs nombre con tilde en lista (Juan Pérez).
  {
    name: 'Sin tildes vs nombre con tilde',
    text: 'Juan Perez - Bulevar España 2100 - 099000111',
    expect: { not_create_new: true, match_id: 'c_juan' },
  },
  // 9. Nombre en MAYÚSCULAS sin nada más.
  {
    name: 'Solo nombre en MAYUSCULAS',
    text: 'AKITA PINAR',
    expect: { not_create_new: true, match_id: 'c_akita' },
  },
  // 10. Bloque grande con la ficha del directorio + pedido al final.
  {
    name: 'Bloque grande con datos + pedido',
    text:
      'Cliente: BARBARA SILVEIRA\nDirección: MEDANOS DE SOLYMAR EDEN ROK M22 S35\nEsquina: ENTRE JAGUEL E INDIANA\nMaps: https://maps.app.goo.gl/abc\nAgendarle 2 botellones para el miércoles',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_barbara' },
  },
  // 11. Pide actualizar maps link → update_client_data (no create_new_client).
  {
    name: 'Actualizar mapsLink',
    text: 'agregá esta URL a Manuel Couste https://maps.app.goo.gl/MNUEL',
    expect: { not_create_new: true, tool: 'update_client_data', match_id: 'c_couste' },
  },
  // 12. Cliente con pedido ya pendiente, agregar productos → merge_products_into_order.
  {
    name: 'Cliente con pedido + agregar producto',
    text: 'agregale 2 botellones a Farmacia Central',
    expect: { not_create_new: true, tool: 'merge_products_into_order', match_id: 'c_farmacia' },
  },
  // 13. Ficha completa de cliente con pedido ya pendiente.
  {
    name: 'Ficha de cliente con pedido pendiente',
    text:
      'Akita Pinar - Jose P. Varela M. 38 Sol. 20 - movélo al martes con 2 botellones',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_akita' },
  },
  // 14. Nombre con apellido extra inventado.
  {
    name: 'Apellido extra adicional',
    text: 'agendá a Manuel Couste Rodriguez para el jueves',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_couste' },
  },
  // 15. Misma ficha pero el texto dice "cliente nuevo" (debe IGNORAR esa pista).
  {
    name: 'Ficha que dice "cliente nuevo" pero ya existe',
    text:
      'Cliente nuevo: BARBARA SILVEIRA - MEDANOS DE SOLYMAR EDEN ROK M22 S35 - https://maps.app.goo.gl/abc',
    expect: { not_create_new: true, match_id: 'c_barbara' },
  },
  // 16. Ficha + agregale productos (sin día) → merge_products_into_order si tiene pedido / schedule si no.
  {
    name: 'Ficha cliente on_demand + productos sin día',
    text: 'Plasticos Mica - Av. Italia 4500 - sumale 5 botellones',
    expect: { not_create_new: true, match_id: 'c_plasticos' },
  },
  // 17. Solo nombre en minúsculas.
  {
    name: 'Solo nombre minusculas',
    text: 'farmacia central',
    expect: { not_create_new: true, match_id: 'c_farmacia' },
  },
  // 18. Ficha con teléfono distinto.
  {
    name: 'Ficha con teléfono distinto',
    text: 'Juan Pérez - Bulevar España 2100 - tel 099999999',
    expect: { not_create_new: true, match_id: 'c_juan' },
  },
  // 19. Ambigüedad: "Maria" sola → debe report_not_found, NO create_new_client.
  {
    name: 'Ambiguo: solo "Maria"',
    text: 'agendá a Maria para el lunes con un bidón',
    expect: { not_create_new: true, tool: 'report_not_found' },
  },
  // 20. Caso negativo: cliente que NO existe → create_new_client.
  {
    name: 'NEGATIVO: cliente nuevo real',
    text:
      'Patricia Fernandez - Av Brasil 3000, Esquina Berro - https://maps.app.goo.gl/PATRI - 2 botellones para el miércoles',
    expect: { tool: 'create_new_client' },
  },
  // 21. Caso negativo: nombre similar pero diferente. La IA puede crear nuevo
  //     o pedir aclaración (preferir matchear ante duda) — ambos aceptables.
  {
    name: 'NEGATIVO: similar pero distinto (Akita Solar vs Akita Pinar)',
    text: 'Akita Solar - Av Italia 1500 - 1 botellón',
    expect: { tool: ['create_new_client', 'report_not_found'] },
  },
  // 22. Verbo destructivo sobre cliente existente debe ir a report_not_found, NO create_new_client.
  {
    name: 'Verbo destructivo: "borrá a Maria Lopez"',
    text: 'borrá a Maria Lopez del listado',
    expect: { not_create_new: true, tool: 'report_not_found' },
  },
  // 23. Capitalización rara en la entrada (camelCase / random).
  {
    name: 'Capitalización rara',
    text: 'baRbArA siLvEiRa - medanos de solymar',
    expect: { not_create_new: true, match_id: 'c_barbara' },
  },
  // 24. Ficha pero con notas adicionales que no estaban en la lista.
  {
    name: 'Ficha + notas nuevas',
    text:
      'Manuel Couste - Solano García 2300 - llamar antes de ir, queda al fondo',
    expect: { not_create_new: true, match_id: 'c_couste' },
  },
  // 25. Frase con "agregar a" (puede confundir con alta).
  {
    name: '"Agregar a" cliente existente',
    text: 'agregá a Plasticos Mica para el viernes con 4 botellones',
    expect: { not_create_new: true, tool: 'schedule_existing_client', match_id: 'c_plasticos' },
  },
];

function normalize(s) {
  return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function checkCase(testCase, result) {
  const { tool, input } = result;
  const { not_create_new, tool: expectedTool, match_id } = testCase.expect;

  const failures = [];

  if (not_create_new && tool === 'create_new_client') {
    failures.push(`tool=create_new_client (no debía crear nuevo)`);
  }
  if (expectedTool) {
    const allowed = Array.isArray(expectedTool) ? expectedTool : [expectedTool];
    if (!allowed.includes(tool)) {
      failures.push(`tool=${tool} (esperaba ${allowed.join(' o ')})`);
    }
  }
  if (match_id) {
    // Cliente esperado (de la LISTA).
    const expectedClient = CLIENTS.find((c) => c.id === match_id);
    const expectedName = normalize(expectedClient?.name);

    if (tool === 'report_not_found') {
      // Aceptamos como "match correcto" si mentioned_name o reason refieren al cliente esperado.
      const mentioned = normalize(input?.mentioned_name);
      const reason = normalize(input?.reason);
      const refersToExpected =
        (mentioned && (mentioned.includes(expectedName) || expectedName.includes(mentioned))) ||
        (reason && reason.includes(expectedName));
      if (!refersToExpected) {
        failures.push(
          `report_not_found pero no refiere al cliente esperado (${match_id} = "${expectedClient?.name}")`,
        );
      }
    } else if (input?.matched_client_id !== match_id) {
      failures.push(
        `matched_client_id=${input?.matched_client_id || '(none)'} (esperaba ${match_id})`,
      );
    }
  }

  return failures;
}

async function runOne(testCase, idx) {
  const text = testCase.text;
  try {
    const result = await parseOrder({ text, clients: CLIENTS, todayIso: TODAY });
    const failures = checkCase(testCase, result);
    return {
      idx,
      name: testCase.name,
      tool: result.tool,
      input: result.input,
      failures,
      passed: failures.length === 0,
    };
  } catch (err) {
    return {
      idx,
      name: testCase.name,
      tool: 'ERROR',
      input: null,
      failures: [`exception: ${err.message}`],
      passed: false,
    };
  }
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
      const r = results[i];
      const tag = r.passed ? 'PASS' : 'FAIL';
      const matched = r.input?.matched_client_id || r.input?.name || '';
      console.log(
        `[${tag}] #${i + 1} ${r.name} → ${r.tool}${matched ? ` (${matched})` : ''}` +
          (r.failures.length ? `\n       ${r.failures.join(' | ')}` : ''),
      );
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

(async () => {
  console.log(`\nDirectorio (${CLIENTS.length} clientes):`);
  for (const c of CLIENTS) {
    const status = c.freq === 'on_demand' ? 'on_demand' : `${c.freq} ${c.visitDay || c.specificDate}`;
    console.log(`  ${c.id} | ${c.name} | ${c.address} | ${status}`);
  }
  console.log(`\nFecha de prueba: ${TODAY} (Lunes)`);
  console.log(`Casos: ${CASES.length}\n`);

  const results = await runWithConcurrency(CASES, 4, runOne);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  console.log(`\n=========================================`);
  console.log(`RESULTADO: ${passed}/${results.length} pasaron`);
  console.log(`=========================================\n`);

  if (failed.length) {
    console.log(`Fallos detallados:\n`);
    for (const f of failed) {
      console.log(`#${f.idx + 1} ${f.name}`);
      console.log(`  tool: ${f.tool}`);
      if (f.input) console.log(`  input: ${JSON.stringify(f.input)}`);
      console.log(`  fallas: ${f.failures.join(' | ')}\n`);
    }
    process.exit(1);
  }
  process.exit(0);
})();
