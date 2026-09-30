import { defineConfig } from 'vitest/config';

// Tests aller Pakete und Apps (jede mit eigener Konfiguration)
export default defineConfig({
  test: {
    projects: ['packages/core', 'apps/*'],
  },
});
