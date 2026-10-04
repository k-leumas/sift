import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/owner/migrate.ts';
import { adminUrlFor, connect, requireEnv, roleUrl, type TestDb } from './support/db.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    testDb: TestDb | null;
  }
}

const BOOTSTRAP_HINT =
  'Run: docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -f /docker-entrypoint-initdb.d/10-sift-bootstrap.sql';

let adminUrl: string | undefined;
let runId: string | undefined;

/**
 * Migrate one throwaway template database per run with the real migrate()
 * as sift_owner (D-47). Test files clone it through freshDatabase().
 */
export async function setup(project: TestProject): Promise<void> {
  const url = process.env.SIFT_TEST_ADMIN_URL;
  if (url === undefined || url.trim() === '') {
    // Non-DB suites still run; DB tests fail through requireTestDb().
    project.provide('testDb', null);
    return;
  }
  adminUrl = url;
  runId = randomBytes(4).toString('hex');
  const templateDb = `sift_test_${runId}_tpl`;

  await assertBootstrapped(url);

  const admin = await connect(url);
  try {
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(templateDb)} OWNER sift_owner`);
  } finally {
    await admin.end();
  }

  try {
    await migrate({
      ownerUrl: roleUrl(url, 'sift_owner', templateDb),
      appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
      // Throwaway template: there is nothing to restore, so no dump is taken.
      backup: false,
    });
    await terminateConnections(url, templateDb);
  } catch (error) {
    await teardown();
    throw error;
  }

  project.provide('testDb', { adminUrl: url, runId, templateDb });
}

/** Drop every database this run created (template and clones). */
export async function teardown(): Promise<void> {
  if (adminUrl === undefined || runId === undefined) {
    return;
  }
  const admin = await connect(adminUrl);
  try {
    const { rows } = await admin.query<{ datname: string }>(
      'select datname from pg_database where starts_with(datname, $1)',
      [`sift_test_${runId}`],
    );
    for (const { datname } of rows) {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(datname)} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}

async function assertBootstrapped(url: string): Promise<void> {
  const admin = await connect(url);
  try {
    const roles = await admin.query<{ n: number }>(
      "select count(*)::int as n from pg_roles where rolname in ('sift_owner', 'sift_backup')",
    );
    if (roles.rows[0]?.n !== 2) {
      throw new Error(
        `Postgres is not bootstrapped: roles sift_owner/sift_backup missing. ${BOOTSTRAP_HINT}`,
      );
    }
  } finally {
    await admin.end();
  }

  const template1 = await connect(adminUrlFor(url, 'template1'));
  try {
    const ext = await template1.query("select 1 from pg_extension where extname = 'vector'");
    if (ext.rowCount === 0) {
      throw new Error(
        `Postgres is not bootstrapped: template1 lacks extension vector. ${BOOTSTRAP_HINT}`,
      );
    }
  } finally {
    await template1.end();
  }
}

async function terminateConnections(url: string, database: string): Promise<void> {
  const admin = await connect(url);
  try {
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [database],
    );
  } finally {
    await admin.end();
  }
}
