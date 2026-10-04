import { defineConfig } from 'drizzle-kit';

// Paths are relative to the repo root, where `pnpm db:generate` runs.
// Generate only; migrations are applied by `sift migrate`, never by kit (D-19).
export default defineConfig({
  dialect: 'postgresql',
  schema: 'packages/db/src/schema/index.ts',
  out: 'packages/db/migrations',
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  entities: { roles: true },
});
