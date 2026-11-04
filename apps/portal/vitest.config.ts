import { defineConfig } from 'vitest/config';

// Worker tests run in Node against real local D1/R2 bindings from Miniflare
// (see src/worker/test/harness.ts). Client tests opt into jsdom per file with
// `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
