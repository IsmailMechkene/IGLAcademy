import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist-electron',
  sourcemap: true,
  minify: !isWatch,
  external: ['electron', 'better-sqlite3'],
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build-electron] watching for changes...');
} else {
  await esbuild.build(options);
  console.log('[build-electron] done');
}
