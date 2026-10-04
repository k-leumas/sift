import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import {
  BACKUP_KEEP,
  type BackupTarget,
  backupFileName,
  ensureWritableDir,
  pruneBackups,
  writeBackup,
} from './backup.ts';

export { BackupFailedError, type BackupTarget } from './backup.ts';

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
  /**
   * Pre-migration dump (D-29, D-66). A target dumps before applying when
   * anything is pending; `false` skips it (throwaway test databases only);
   * `undefined` with pending migrations throws BackupRequiredError.
   */
  backup: BackupTarget | false | undefined;
  log?: (line: string) => void;
}

export interface MigrateResult {
  /** Journal tags applied by this run, in order. Empty when nothing was pending. */
  applied: string[];
  /** Absolute path of the dump written by this run, or null when none was taken. */
  backupFile: string | null;
}

/** Migrations are pending but no backup target was configured. Nothing was changed. */
export class BackupRequiredError extends Error {
  override name = 'BackupRequiredError';
}

/**
 * A journal migration would never be applied. Drizzle applies a migration only
 * when its journal `when` is newer than the last applied one, so an entry dated
 * older (typically after a rebase of two branches that each generated one) is
 * skipped silently. Nothing was changed.
 */
export class MigrationOrderError extends Error {
  override name = 'MigrationOrderError';
}

interface JournalEntry {
  tag: string;
}

/**
 * Apply pending migrations as sift_owner (D-19, D-29, D-30, D-39, D-66).
 *
 * When anything is pending, a custom-format pg_dump taken as sift_backup is
 * written first and old dumps are pruned to the newest BACKUP_KEEP.
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
  const millis = migrations.map((m) => m.folderMillis);
  for (let i = 1; i < millis.length; i += 1) {
    if ((millis[i] ?? 0) <= (millis[i - 1] ?? 0)) {
      throw new MigrationOrderError(
        `Migration ${tags[i]} is dated no later than ${tags[i - 1]} in meta/_journal.json, so it would never be applied; regenerate it so its "when" is the newest`,
      );
    }
  }

  const client = new pg.Client({ connectionString: options.ownerUrl });
  await client.connect();
  let locked = false;
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    locked = true;

    // Everything that can fail before a change runs first: pending detection,
    // then the required backup. A missing or failed backup leaves the role and
    // the schema untouched (T-01-32).
    const before = await appliedCount(client);
    // Pending exactly as drizzle decides it: newer than the last applied one.
    const last = await lastAppliedMillis(client);
    const isPending = (i: number): boolean => last === null || last < (millis[i] ?? 0);
    const pending = tags.filter((_, i) => isPending(i));
    // Decide by identity, not by count: a journal entry that is neither recorded
    // (by hash) nor pending would be skipped by drizzle. Counting rows misses it
    // when the database also holds a migration this journal does not list (from
    // another branch, or a reverted PR). An applied file edited afterwards has a
    // new hash and lands here too.
    const applied = await appliedHashes(client);
    const skipped = tags.filter((_, i) => !isPending(i) && !applied.has(migrations[i]?.hash ?? ''));
    if (skipped.length > 0) {
      throw new MigrationOrderError(
        `${skipped.length} migration(s) in the journal are older than the last applied one and would never be applied (${skipped.join(', ')}); regenerate them so their "when" is the newest, or restore an applied migration file that was edited`,
      );
    }
    const backupFile =
      pending.length === 0 ? null : await backupBeforeApplying(options.backup, pending, log);

    await ensureAppRole(client, options.appPassword, log);

    await drizzleMigrate(drizzle({ client }), {
      migrationsFolder,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
    const after = await appliedCount(client);
    if (after - before !== pending.length) {
      throw new MigrationOrderError(
        `Expected to apply ${pending.length} migration(s) but ${after - before} were recorded`,
      );
    }

    log(
      pending.length === 0
        ? 'No pending migrations'
        : `Applied ${pending.length} migration(s): ${pending.join(', ')}`,
    );
    return { applied: pending, backupFile };
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

/**
 * Dump through sift_backup, then prune old dumps (D-29, D-66). Pruning runs only
 * after the new dump is complete, so a failure never shrinks the history.
 */
async function backupBeforeApplying(
  backup: BackupTarget | false | undefined,
  pending: readonly string[],
  log: (line: string) => void,
): Promise<string | null> {
  if (backup === false) {
    return null;
  }
  if (backup === undefined) {
    throw new BackupRequiredError(
      `SIFT_BACKUP_DATABASE_URL is not set; a backup is required before applying ${pending.length} pending migrations`,
    );
  }
  const target = pending.at(-1);
  if (target === undefined) {
    return null;
  }
  await ensureWritableDir(backup.dir);
  const file = await writeBackup(backup, backupFileName(new Date(), target));
  const removed = await pruneBackups(backup.dir, BACKUP_KEEP);
  log(`Backup written: ${path.basename(file)}`);
  if (removed.length > 0) {
    log(`Pruned ${removed.length} old backup(s)`);
  }
  return file;
}

function readJournalTags(migrationsFolder: string): string[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  return journal.entries.map((entry) => entry.tag);
}

/** created_at of the newest applied migration (drizzle's own rule), or null when none. */
async function lastAppliedMillis(client: pg.Client): Promise<number | null> {
  const table = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const exists = await client.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [table],
  );
  if (!exists.rows[0]?.present) {
    return null;
  }
  const result = await client.query<{ created_at: string | null }>(
    `select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by created_at desc limit 1`,
  );
  const value = result.rows[0]?.created_at;
  return value === undefined || value === null ? null : Number(value);
}

/** Hashes of every recorded migration (drizzle stores the SQL file's sha256). */
async function appliedHashes(client: pg.Client): Promise<Set<string>> {
  const table = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const exists = await client.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [table],
  );
  if (!exists.rows[0]?.present) {
    return new Set();
  }
  const result = await client.query<{ hash: string }>(
    `select hash from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return new Set(result.rows.map((row) => row.hash));
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
