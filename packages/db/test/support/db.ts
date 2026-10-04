import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

/** Provided by packages/db/test/global-setup.ts as inject('testDb'). */
export interface TestDb {
  /** Superuser URL (SIFT_TEST_ADMIN_URL). Test-only; never reaches app code. */
  adminUrl: string;
  runId: string;
  /** Migrated template database every test file clones. */
  templateDb: string;
}

export interface TestDatabase {
  name: string;
  adminUrl: string;
  ownerUrl: string;
  appUrl: string;
  backupUrl: string;
  drop(): Promise<void>;
}

export type DbRole = 'sift_owner' | 'sift_app' | 'sift_backup';

const PASSWORD_VARS: Record<DbRole, string> = {
  sift_owner: 'SIFT_DB_OWNER_PASSWORD',
  sift_app: 'SIFT_DB_APP_PASSWORD',
  sift_backup: 'SIFT_DB_BACKUP_PASSWORD',
};

/** Read a required env var. The error names the variable, never a value. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

/** URL for one of the Sift roles on `database`, using the admin URL's host and port. */
export function roleUrl(adminUrl: string, role: DbRole, database: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = requireEnv(PASSWORD_VARS[role]);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Admin URL pointed at another database. */
export function adminUrlFor(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * The run's test database info. DB tests fail, never skip, when Postgres is
 * not configured.
 */
export function requireTestDb(): TestDb {
  const testDb = inject('testDb');
  if (!testDb) {
    throw new Error(
      'SIFT_TEST_ADMIN_URL is not set: DB tests need Postgres 18 + pgvector with db/bootstrap.sql applied',
    );
  }
  return testDb;
}

let counter = 0;

/** Clone the migrated template into a database of this test file's own (D-47). */
export async function freshDatabase(): Promise<TestDatabase> {
  const { adminUrl, runId, templateDb } = requireTestDb();
  counter += 1;
  // Test files run in separate workers, so the counter alone is not unique.
  const name = `sift_test_${runId}_${counter}_${randomBytes(3).toString('hex')}`;
  const admin = await connect(adminUrl);
  try {
    await admin.query(
      `CREATE DATABASE ${pg.escapeIdentifier(name)} TEMPLATE ${pg.escapeIdentifier(templateDb)} OWNER sift_owner`,
    );
  } finally {
    await admin.end();
  }
  return {
    name,
    adminUrl: adminUrlFor(adminUrl, name),
    ownerUrl: roleUrl(adminUrl, 'sift_owner', name),
    appUrl: roleUrl(adminUrl, 'sift_app', name),
    backupUrl: roleUrl(adminUrl, 'sift_backup', name),
    drop: () => dropDatabase(adminUrl, name),
  };
}

export async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  const admin = await connect(adminUrl);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** A connected client. The caller ends it. */
export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
