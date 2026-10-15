import { build } from 'esbuild';

// Un solo archivo con el SDK de MCP, zod y la lógica compartida de src/.
// firebase-admin queda externo y se resuelve desde node_modules de la app.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['firebase-admin', 'firebase-admin/*', '@react-native-firebase/*'],
  logLevel: 'info',
});
