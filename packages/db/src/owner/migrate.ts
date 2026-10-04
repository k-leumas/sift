import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Session-level advisory lock held for the whole migrate run (D-30). */
export const MIGRATE_LOCK_KEY = 815309001;

/** Absolute path of the committed migrations (packages/db/migrations). */
export const MIGRATIONS_FOLDER: string = path.join(import.meta.dirname, '../../migrations');

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
const APP_ROLE = 'sift_app';
const DUPLICATE_OBJECT = '42710';

export interface MigrateOptions {
  /** sift_owner connection string. Never logged. */
  ownerUrl: string;
  /** Password for sift_app; created or rotated on every run (D-39). Never logged. */
  appPassword: string;
  migrationsFolder?: string;
  log?: (line: string) => void;
}

export interface MigrateResult {
  /** Journal tags applied by this run, in order. Empty when nothing was pending. */
  applied: string[];
}

interface JournalEntry {
  tag: string;
}

/**
 * Apply pending migrations as sift_owner (D-19, D-30, D-39).
 *
 * One dedicated client runs everything, because the advisory lock is
 * session-level. sift_app is ensured before the migrator runs, since
 * CREATE POLICY ... TO sift_app needs the role to exist.
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
  const log = options.log ?? (() => {});
  const tags = readJournalTags(migrationsFolder);
  // Validates that every journal entry has its SQL file before touching the database.
  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length !== tags.length) {
    throw new Error(
      `Migration journal lists ${tags.length} entries but ${migrations.length} were read`,
    );
  }

  const client = new pg.Client({ connectionString: options.ownerUrl });
  await client.connect();
  let locked = false;
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    locked = true;

    await ensureAppRole(client, options.appPassword, log);

    const before = await appliedCount(client);
    await drizzleMigrate(drizzle({ client }), {
      migrationsFolder,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
    const after = await appliedCount(client);

    const applied = tags.slice(before, after);
    log(
      applied.length === 0
        ? 'No pending migrations'
        : `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
    );
    return { applied };
  } finally {
    try {
      if (locked) {
        await client.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]);
      }
    } finally {
      await client.end();
    }
  }
}

function readJournalTags(migrationsFolder: string): string[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  return journal.entries.map((entry) => entry.tag);
}

async function appliedCount(client: pg.Client): Promise<number> {
  const table = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const exists = await client.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [table],
  );
  if (!exists.rows[0]?.present) {
    return 0;
  }
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * Create sift_app, or rotate its password when it exists (D-39). The password
 * is embedded with client.escapeLiteral() because role DDL takes no bind
 * parameters. The statement text is never logged or put into an error.
 */
async function ensureAppRole(
  client: pg.Client,
  password: string,
  log: (line: string) => void,
): Promise<void> {
  if (password.trim() === '') {
    throw new Error('Missing env var: SIFT_DB_APP_PASSWORD');
  }
  const literal = client.escapeLiteral(password);
  const existing = await client.query('select 1 from pg_catalog.pg_roles where rolname = $1', [
    APP_ROLE,
  ]);

  if (existing.rowCount === 0) {
    try {
      await client.query(
        `CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${literal}`,
      );
      log(`Created role ${APP_ROLE}`);
      return;
    } catch (error) {
      // A concurrent run (another test database, Pitfall 9b) created it first.
      if (sqlState(error) !== DUPLICATE_OBJECT) {
        throw roleError('create', error);
      }
    }
  }

  try {
    await client.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD ${literal}`);
  } catch (error) {
    throw roleError('update', error);
  }
  log(`Updated role ${APP_ROLE} password`);
}

function sqlState(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Rebuild the error from SQLSTATE and the server message only, never the statement. */
function roleError(action: 'create' | 'update', error: unknown): Error {
  const code = sqlState(error) ?? 'unknown';
  const message = error instanceof Error ? error.message : 'unknown error';
  return new Error(`Could not ${action} role ${APP_ROLE} (SQLSTATE ${code}): ${message}`);
}
