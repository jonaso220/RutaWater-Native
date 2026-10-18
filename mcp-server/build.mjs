import { build } from 'esbuild';

// Un solo archivo con el SDK de MCP, zod y la lógica compartida de src/.
// firebase-admin queda externo y se resuelve desde node_modules de la app.
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['firebase-admin', 'firebase-admin/*', '@react-native-firebase/*'],
  logLevel: 'info',
};

await build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/server.cjs' });
// Script de una sola vez: completa lat/lng de las fichas existentes.
await build({ ...shared, entryPoints: ['scripts/completar-coordenadas.ts'], outfile: 'dist/completar-coordenadas.cjs' });
// Script de una sola vez: nombres y direcciones con el mismo formato.
await build({ ...shared, entryPoints: ['scripts/formato-nombres.ts'], outfile: 'dist/formato-nombres.cjs' });
// Script de una sola vez: direcciones rehechas a partir de las coordenadas.
await build({ ...shared, entryPoints: ['scripts/direcciones-coordenadas.ts'], outfile: 'dist/direcciones-coordenadas.cjs' });
