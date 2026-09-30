import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
