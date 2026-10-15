// Prueba de punta a punta: levanta dist/server.cjs por stdio (como lo hace un
// cliente MCP) contra el emulador y llama las herramientas. Requiere `npm run build`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', '..', 'package.json'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator) {
  console.log('smoke: sin FIRESTORE_EMULATOR_HOST, se omite.');
  process.exit(0);
}

process.env.TZ = 'America/Montevideo';
const pad = (n) => String(n).padStart(2, '0');
const tomorrowDate = new Date();
tomorrowDate.setDate(tomorrowDate.getDate() + 1);
const tomorrow = `${tomorrowDate.getFullYear()}-${pad(tomorrowDate.getMonth() + 1)}-${pad(tomorrowDate.getDate())}`;
const day = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][tomorrowDate.getDay()];

const db = getFirestore(initializeApp({ projectId: 'demo-rutawater' }, 'smoke'));
await fetch(`http://${emulator}/emulator/v1/projects/demo-rutawater/databases/(default)/documents`, { method: 'DELETE' });
await db.doc('users/smoke').set({ accountState: 'active' });
await db.doc('clients/c1').set({
  userId: 'smoke', scopeKey: 'user:smoke', name: 'Héctor Murgo', phone: '099 111 222', address: 'Calle 5',
  notes: '', freq: 'weekly', visitDay: day, visitDays: [day], specificDate: '', products: { b20: 1 },
  isStarred: false, isCompleted: false, isNote: false, lastVisited: null,
});

await db.doc('clients/c1').update({ relationships: { c2: 'otro' } });
await db.doc('clients/c2').set({
  userId: 'smoke', scopeKey: 'user:smoke', name: 'Sulay Fernandez', phone: '099 333 444', address: 'Calle 6',
  notes: '', freq: 'on_demand', visitDay: '', visitDays: [], specificDate: '', products: {},
  isStarred: false, isCompleted: false, isNote: false, lastVisited: null, relationships: { c1: 'otro' },
});

const auditPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rw-mcp-')), 'audit.jsonl');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, '..', 'dist', 'server.cjs')],
  env: {
    ...process.env, RUTAWATER_UID: 'smoke', FIREBASE_PROJECT_ID: 'demo-rutawater', RUTAWATER_MCP_AUDIT: auditPath,
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const body = result.content[0].text;
  if (result.isError) throw new Error(`${name}: ${body}`);
  return JSON.parse(body);
};

const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
assert.deepEqual(tools, [
  'actualizar_nota', 'agenda_del_dia', 'buscar_clientes', 'deshacer_listo', 'fijar_productos',
  'listar_deudas', 'listar_repartos', 'marcar_favorito', 'marcar_listo', 'ver_cliente', 'ver_productos',
]);

const agenda = await call('agenda_del_dia', { fecha: 'mañana' });
assert.equal(agenda.fecha, tomorrow);
assert.equal(agenda.es_manana, true);
assert.deepEqual(agenda.repartos[0].clientes.map((c) => [c.nombre, c.whatsapp]), [['Héctor Murgo', '59899111222']]);

const [found] = await call('buscar_clientes', { texto: 'hector' });
assert.equal(found.id, 'c1');

const products = await call('fijar_productos', { cliente_id: 'c1', productos: { b20: 3, soda: 6 } });
assert.deepEqual(products.despues, { b20: 3, soda: 6 });
assert.equal((await call('marcar_favorito', { cliente_id: 'c1' })).cambiado, true);
await call('actualizar_nota', { cliente_id: 'c1', nota: 'Pueden ser 2 o 3', nota_esperada: '' });

const detail = await call('ver_cliente', { cliente_id: 'c1' });
assert.equal(detail.favorito, true);
assert.equal(detail.notas, 'Pueden ser 2 o 3');
assert.deepEqual(detail.parentesco.map((p) => [p.nombre, p.tipo, p.whatsapp]), [['Sulay Fernandez', 'otro', '59899333444']]);

const done = await call('marcar_listo', { cliente_id: 'c1', fecha: tomorrow });
assert.equal(done.antes.visita, tomorrow);

const wrong = await client.callTool({ name: 'marcar_listo', arguments: { cliente_id: 'c1', fecha: tomorrow } });
assert.equal(wrong.isError, true);

const audit = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line).tool);
assert.deepEqual(audit, ['fijar_productos', 'marcar_favorito', 'actualizar_nota', 'marcar_listo']);

await client.close();
console.log('smoke: OK (11 herramientas, lectura, escrituras y registro de auditoría)');
process.exit(0);
