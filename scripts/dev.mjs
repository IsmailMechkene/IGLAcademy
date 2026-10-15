import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import esbuild from 'esbuild';

// 1. Initial one-shot build of electron main + preload
await esbuild.build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/splashPreload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist-electron',
  sourcemap: true,
  external: ['electron', 'better-sqlite3'],
  logLevel: 'silent',
});

// 2. Watch electron code for changes
const ctx = await esbuild.context({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/splashPreload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist-electron',
  sourcemap: true,
  external: ['electron', 'better-sqlite3'],
  logLevel: 'info',
});
await ctx.watch();

// 3. Start vite dev server
const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const address = server.httpServer.address();
const port = typeof address === 'object' && address ? address.port : 5173;
console.log(`[dev] vite dev server on http://localhost:${port}`);

// 4. Spawn electron
const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_DEV_SERVER_URL: `http://localhost:${port}` },
});

const cleanup = async () => {
  electron.kill();
  await ctx.dispose();
  await server.close();
  process.exit(0);
};

electron.on('exit', (code) => {
  cleanup().then(() => process.exit(code ?? 0));
});
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
