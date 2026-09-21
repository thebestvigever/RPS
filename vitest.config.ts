import { defineConfig } from 'vitest/config';

// One Vitest run across the workspace. The engine's tests are the gate:
// spec 11.1-11.4 must be green before any UI work starts (spec 12, M1).
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
