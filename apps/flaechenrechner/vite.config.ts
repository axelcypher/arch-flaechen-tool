import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tauri erwartet einen festen Port und setzt TAURI_ENV_* Variablen beim Build.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // gemeinsamer Unterbau (packages/core) als Quelltext
  resolve: { alias: { '@core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)) } },
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
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version),
  },
  build: {
    // WebView2 (Windows) ist immergrün; pdf.js benötigt eine aktuelle Engine
    target: 'es2022',
    // ExcelJS und pdf.js werden nur bei Bedarf nachgeladen
    chunkSizeWarningLimit: 4000,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    name: 'flaechenrechner',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
