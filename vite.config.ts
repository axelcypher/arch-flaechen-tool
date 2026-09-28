import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri erwartet einen festen Port und setzt TAURI_ENV_* Variablen beim Build.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // relative Pfade, damit der Web-Build auch in Unterverzeichnissen läuft
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2022',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
