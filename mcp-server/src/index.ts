// La agenda se calcula en hora local, como en el teléfono del repartidor.
process.env.TZ = process.env.RUTAWATER_TZ || 'America/Montevideo';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getDb, loadConfig } from './config';
import { ReadBudget, setReadBudget } from './readBudget';
import { Store } from './store';
import { createServer } from './tools';

const main = async () => {
  const config = await loadConfig();
  if (!Number.isInteger(config.dailyLoads) || config.dailyLoads < 0) {
    throw new Error('RUTAWATER_MCP_CARGAS_DIARIAS tiene que ser un entero (0 = sin tope).');
  }
  setReadBudget(new ReadBudget(config.loadsDir, config.dailyLoads));
  const store = new Store(getDb(), config.uid);
  const server = createServer(store, config);
  const shutdown = () => {
    store.close();
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await server.connect(new StdioServerTransport());
  console.error(`RutaWater MCP listo (${config.readOnly ? 'solo lectura' : 'lectura y escritura'}).`);
};

main().catch((error) => {
  console.error('RutaWater MCP no pudo iniciar:', error instanceof Error ? error.message : error);
  process.exit(1);
});
