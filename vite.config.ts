import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Packaging output. A watch handle on these folders makes Windows refuse
      // electron-builder's rename (EPERM) while `npm run dev` is running.
      ignored: ['**/release/**', '**/release-*/**', '**/dist-electron/**'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
