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

await db.doc('debts/s1').set({
  userId: 'smoke', scopeKey: 'user:smoke', clientId: 'c1', customerId: 'c1', clientName: 'Héctor Murgo', amount: 500,
  createdAt: new Date(),
});

const auditPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rw-mcp-')), 'audit.jsonl');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, '..', 'dist', 'server.cjs')],
  env: {
    ...process.env, RUTAWATER_UID: 'smoke', FIREBASE_PROJECT_ID: 'demo-rutawater', RUTAWATER_MCP_AUDIT: auditPath,
    RUTAWATER_MCP_CARGAS_DIR: path.join(path.dirname(auditPath), 'cargas'),
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
  'abrir_whatsapp', 'actualizar_nota', 'adelantar_visita', 'agenda_del_dia', 'agendar_una_vez', 'agregar_telefono', 'avisar_jonathan', 'borrar_nota_del_dia', 'buscar_clientes', 'cambiar_fecha', 'cambiar_frecuencia',
  'cambiar_posicion', 'clientes_sin_comprar', 'consultar_jonathan', 'crear_cliente', 'crear_nota_del_dia', 'deshacer_fusion', 'deshacer_listo', 'editar_nota_del_dia', 'entregas_del_periodo', 'enviar_comprobante_aquapura', 'excluir_chat', 'fijar_facturacion', 'fijar_productos', 'fusionar_duplicados', 'guardar_contacto', 'historia_cliente', 'leer_respuestas_jonathan', 'leer_whatsapp', 'listar_deudas', 'listar_repartos', 'marcar_favorito', 'marcar_listo', 'marcar_respuesta_aplicada',
  'marcar_revisar_transferencia', 'marcar_whatsapp_atendido', 'pasada_programada', 'quitar_de_la_lista', 'registrar_pago', 'responder_whatsapp', 'sugerir_posicion', 'transcribir_audio', 'transcribir_whatsapp', 'ver_archivo_whatsapp', 'ver_cliente', 'ver_productos',
]);

// abrir_whatsapp valida antes de abrir nada: estos casos fallan sin tocar WhatsApp.
const abrir = (args) => client.callTool({ name: 'abrir_whatsapp', arguments: args });
assert.match((await abrir({ telefono: '1234567', texto: 'x' })).content[0].text, /at least 8|inválido/);
assert.match((await abrir({ telefono: '59899123456', plantilla: 'aviso_manana', texto: 'x' })).content[0].text, /plantilla o texto/);
assert.match((await abrir({ telefono: '59899123456', texto: 'hola', reemplazar: ['chau=>x'] })).content[0].text, /0 veces/);

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
await call('fijar_facturacion', { cliente_id: 'c1', rut: '211234560019', razon_social: 'Carnicería' });
const phone = await call('agregar_telefono', { cliente_id: 'c1', telefono: '099 333 444' });
assert.deepEqual(phone.otras_fichas.map((c) => c.nombre), ['Sulay Fernandez']);

const detail = await call('ver_cliente', { cliente_id: 'c1' });
assert.equal(detail.favorito, true);
assert.equal(detail.notas, 'Pueden ser 2 o 3');
assert.deepEqual([detail.rut, detail.razon_social], ['211234560019', 'Carnicería']);
assert.deepEqual(detail.telefonos, [{ numero: '099 111 222', principal: true }, { numero: '099 333 444', principal: false }]);
assert.deepEqual(detail.parentesco.map((p) => [p.nombre, p.tipo, p.whatsapp]), [['Sulay Fernandez', 'otro', '59899333444']]);
assert.equal(detail.deuda_total, 500);
assert.equal(detail.transferencia_pendiente, false);
assert.equal(detail.mensaje_total_deuda, 'La deuda es de $500. Saludos');

assert.equal((await call('marcar_revisar_transferencia', { cliente_id: 'c1' })).cambiado, true);
assert.equal((await call('marcar_revisar_transferencia', { cliente_id: 'c1' })).cambiado, false);
const paid = await call('registrar_pago', { cliente_id: 'c1', monto: 200, deuda_esperada: 500 });
assert.equal(paid.despues.deuda_total, 300);
const repeated = await client.callTool({ name: 'registrar_pago', arguments: { cliente_id: 'c1', monto: 200, deuda_esperada: 500 } });
assert.equal(repeated.isError, true);
const after = await call('ver_cliente', { cliente_id: 'c1' });
assert.equal(after.transferencia_pendiente, true);
assert.equal(after.deuda_total, 300);

const done = await call('marcar_listo', { cliente_id: 'c1', fecha: tomorrow });
assert.equal(done.antes.visita, tomorrow);

const wrong = await client.callTool({ name: 'marcar_listo', arguments: { cliente_id: 'c1', fecha: tomorrow } });
assert.equal(wrong.isError, true);

const scheduled = await call('agendar_una_vez', { cliente_id: 'c2', fecha: 'mañana', productos: { b12: 1 } });
assert.equal(scheduled.cambiado, true);
assert.deepEqual(scheduled.despues, { ficha_id: 'c2', ficha: 'misma', fecha: tomorrow, dia: day, productos: { b12: 1 }, nota: '', favorito: false });
assert.equal((await call('agendar_una_vez', { cliente_id: 'c2', fecha: tomorrow, productos: { b12: 1 } })).cambiado, false);
const withOnce = await call('agenda_del_dia', { fecha: 'mañana' });
assert.equal(withOnce.repartos[0].clientes[0].nombre, 'Sulay Fernandez');
assert.equal(withOnce.repartos[0].clientes[0].una_vez, true);

// Sin coordenadas no sugiere; con coordenadas ubica y cambiar_posicion lo aplica.
const blind = await call('sugerir_posicion', { cliente_id: 'c2', fecha: 'mañana' });
assert.equal(blind.posicion, null);
assert.match(blind.motivo, /no tiene coordenadas/);
await call('deshacer_listo', { cliente_id: 'c1' });
await db.doc('clients/c1').update({ lat: '-34.8', lng: '-56', listOrders: { [day]: 1 } });
await db.doc('clients/c2').update({ lat: '-34.8', lng: '-55.98' });
await db.doc('clients/c3').set({
  userId: 'smoke', scopeKey: 'user:smoke', name: 'Nilda Pérez', phone: '', address: 'Calle 9', lat: '-34.8', lng: '-55.96',
  notes: '', freq: 'weekly', visitDay: day, visitDays: [day], specificDate: '', products: {}, listOrders: { [day]: 5 },
  isStarred: false, isCompleted: false, isNote: false, lastVisited: null,
});
await new Promise((resolve) => setTimeout(resolve, 300));
const suggestion = await call('sugerir_posicion', { cliente_id: 'c2', fecha: 'mañana' });
assert.equal(suggestion.posicion, 2);
assert.deepEqual(suggestion.anterior, { id: 'c1', nombre: 'Héctor Murgo', posicion: 1 });
const moved = await call('cambiar_posicion', { cliente_id: 'c2', fecha: 'mañana', posicion: suggestion.posicion });
assert.deepEqual(moved.despues, { dia: day, posicion: 2, anterior: 'Héctor Murgo', siguiente: 'Nilda Pérez' });
await new Promise((resolve) => setTimeout(resolve, 200));
const reordered = await call('agenda_del_dia', { fecha: 'mañana' });
assert.deepEqual(reordered.repartos[0].clientes.map((c) => c.nombre), ['Héctor Murgo', 'Sulay Fernandez', 'Nilda Pérez']);

const note = await call('crear_nota_del_dia', { fecha: 'mañana', texto: 'Llevar cambio' });
assert.equal((await call('crear_nota_del_dia', { fecha: 'mañana', texto: 'Llevar cambio' })).cambiado, false);
await new Promise((resolve) => setTimeout(resolve, 200));
const withNote = await call('agenda_del_dia', { fecha: 'mañana' });
const first = withNote.repartos[0].clientes[0];
assert.deepEqual([first.id, first.es_nota, first.notas], [note.cliente_id, true, 'Llevar cambio']);
assert.equal((await call('editar_nota_del_dia', { nota_id: note.cliente_id, texto: 'Llevar cambio de 1000' })).despues, 'Llevar cambio de 1000');
const noteLast = await call('cambiar_posicion', { cliente_id: note.cliente_id, fecha: 'mañana', posicion: 10000 });
assert.deepEqual([noteLast.despues.posicion, noteLast.despues.siguiente], [4, null]);
await new Promise((resolve) => setTimeout(resolve, 200));
const noteAtEnd = (await call('agenda_del_dia', { fecha: 'mañana' })).repartos[0].clientes;
assert.equal(noteAtEnd[noteAtEnd.length - 1].id, note.cliente_id);
assert.match((await client.callTool({ name: 'borrar_nota_del_dia', arguments: { nota_id: 'c1' } })).content[0].text, /no es una nota/);
assert.equal((await call('borrar_nota_del_dia', { nota_id: note.cliente_id })).antes.texto, 'Llevar cambio de 1000');

const audit = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line).tool);
assert.deepEqual(audit, [
  'fijar_productos', 'marcar_favorito', 'actualizar_nota', 'fijar_facturacion', 'agregar_telefono', 'marcar_revisar_transferencia', 'registrar_pago', 'marcar_listo',
  'agendar_una_vez', 'deshacer_listo', 'cambiar_posicion', 'crear_nota_del_dia', 'editar_nota_del_dia', 'cambiar_posicion', 'borrar_nota_del_dia',
]);

await client.close();
console.log('smoke: OK (46 herramientas, lectura, escrituras, pagos, transferencias, visitas de una vez, posición en el recorrido y registro de auditoría)');
process.exit(0);
