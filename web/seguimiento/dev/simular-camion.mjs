// Simula un aviso «En camino» contra el emulador de Realtime Database para
// probar la página: preparado → en camino por 18 de Julio → (opcional) terminado.
// El link vence a los 30 minutos, como el que manda la app.
//
//   node web/seguimiento/dev/simular-camion.mjs [token] [--terminar]
//
// Requiere el emulador (preview «seguimiento» o firebase emulators:start --only hosting,database).
const DB = 'http://127.0.0.1:9000';
const NS = 'rutawater-default-rtdb';
const token = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || 'demoDemoDemoDemoDemo0001';
const finish = process.argv.includes('--terminar');
const now = { '.sv': 'timestamp' };

// Por 18 de Julio, de Plaza Independencia hacia Tres Cruces.
const ROUTE = [
  [-34.9065, -56.1985], [-34.9061, -56.1950], [-34.9057, -56.1915], [-34.9052, -56.1880],
  [-34.9043, -56.1845], [-34.9032, -56.1810], [-34.9020, -56.1775], [-34.9006, -56.1740],
  [-34.8990, -56.1705], [-34.8970, -56.1675], [-34.8950, -56.1650],
];

const request = (method, path, body) => fetch(`${DB}/seguimiento/${token}${path}.json?ns=${NS}`, {
  method,
  // «owner» es el acceso de administrador del emulador (ignora las reglas).
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then((response) => {
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bearing = ([lat1, lng1], [lat2, lng2]) => {
  const rad = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lng2 - lng1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
};

const base = {
  ownerUid: 'simulador', dia: new Date().toLocaleDateString('en-CA'), vence: Date.now() + 30 * 60000,
  actualizado: now, titulo: 'RutaWater',
};
console.log(`Abrí: http://localhost:5050/s/${token}`);

await request('PUT', '', { ...base, estado: 'preparado' });
await sleep(4000);
for (let i = 0; i < ROUTE.length; i += 1) {
  const [lat, lng] = ROUTE[i];
  const rumbo = Math.round(i < ROUTE.length - 1 ? bearing(ROUTE[i], ROUTE[i + 1]) : bearing(ROUTE[i - 1], ROUTE[i])) % 360;
  if (i === 0) await request('PUT', '', { ...base, estado: 'en_camino', lat, lng, precision: 8, rumbo });
  else await request('PATCH', '', { lat, lng, rumbo, actualizado: now });
  await request('POST', '/rastro', { lat, lng, t: now });
  console.log(`punto ${i + 1}/${ROUTE.length}`);
  await sleep(2500);
}
if (finish) {
  await request('PUT', '', { ...base, estado: 'terminado' });
  console.log('terminado');
}
