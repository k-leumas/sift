import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Host development env (DB passwords, SIFT_TEST_ADMIN_URL). CI sets the same
// variables directly, so the file is optional.
if (existsSync('.env.development')) {
  process.loadEnvFile('.env.development');
}

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    globalSetup: ['packages/db/test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
