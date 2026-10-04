import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync as readFileSyncBuffer } from 'node:fs';
import { chmod, cp, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BackupFailedError,
  BackupRequiredError,
  MIGRATE_LOCK_KEY,
  MIGRATIONS_FOLDER,
  MigrationOrderError,
  migrate,
} from '../src/owner/migrate.ts';
import { SCOPED_TABLE_NAMES } from '../src/schema/index.ts';
import {
  connect,
  dropDatabase,
  freshDatabase,
  lockAppRole,
  requireEnv,
  requireTestDb,
  roleUrl,
  type TestDatabase,
} from './support/db.ts';
import { seedMailboxes, seedScopedRows } from './support/seed.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const BACKUP_FILE = /^sift-\d{8}T\d{6}Z-pre-0004_scoped_tables_force_grants\.dump$/;

let db: TestDatabase;
let releaseAppRole: (() => Promise<void>) | undefined;

// Several tests compare sift_app's password verifier, which any concurrent
// migrate() in another test file would rotate (apps/worker/test/setup.test.ts).
beforeAll(async () => {
  releaseAppRole = await lockAppRole();
  db = await freshDatabase();
}, 180_000);

afterAll(async () => {
  try {
    await db?.drop();
  } finally {
    await releaseAppRole?.();
  }
});

describe('migrate()', () => {
  it('records every committed migration', async () => {
    const owner = await connect(db.ownerUrl);
    try {
      const { rows } = await owner.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      expect(rows[0]?.n).toBe(5);
    } finally {
      await owner.end();
    }
  });

  it('creates sift_app without superuser or BYPASSRLS', async () => {
    const owner = await connect(db.ownerUrl);
    try {
      const { rows } = await owner.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "select rolsuper, rolbypassrls from pg_roles where rolname = 'sift_app'",
      );
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    } finally {
      await owner.end();
    }
  });

  it('lets sift_app write and read message only under app.mailbox_id', async () => {
    const owner = await connect(db.ownerUrl);
    let mailboxId: string;
    try {
      // mailbox is the unscoped registry: no RLS, so no setting is needed.
      const { rows } = await owner.query<{ id: string }>(
        `insert into mailbox (slug, imap_host, imap_port, imap_username, imap_folder, password_env, labels_apply_as)
         values ('personal', 'bridge.test', 1143, 'personal@example.test', 'INBOX', 'SIFT_TEST_IMAP_PASSWORD', 'proton_labels')
         returning id`,
      );
      mailboxId = rows[0]?.id ?? '';
      expect(mailboxId).not.toBe('');
    } finally {
      await owner.end();
    }

    const app = await connect(db.appUrl);
    try {
      await app.query('begin');
      await app.query("select set_config('app.mailbox_id', $1, true)", [mailboxId]);
      const inserted = await app.query<{ id: string }>(
        'insert into message (mailbox_id) values ($1) returning id',
        [mailboxId],
      );
      const messageId = inserted.rows[0]?.id;
      const read = await app.query<{ id: string; mailbox_id: string }>(
        'select id, mailbox_id from message',
      );
      expect(read.rows).toEqual([{ id: messageId, mailbox_id: mailboxId }]);
      await app.query('commit');
    } finally {
      await app.end();
    }

    const unscoped = await connect(db.appUrl);
    try {
      const { rows } = await unscoped.query<{ n: number }>(
        'select count(*)::int as n from message',
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await unscoped.end();
    }
  });

  it('scopes every mailbox-scoped table to app.mailbox_id for sift_app', async () => {
    const { work } = await seedMailboxes(db.ownerUrl, ['work']);
    if (work === undefined) {
      throw new Error('seedMailboxes returned no id for "work"');
    }
    for (const _table of SCOPED_TABLE_NAMES) {
      await seedScopedRows(db.ownerUrl, work);
    }

    const scoped = await connect(db.appUrl);
    try {
      await scoped.query('begin');
      await scoped.query("select set_config('app.mailbox_id', $1, true)", [work]);
      for (const table of SCOPED_TABLE_NAMES) {
        const { rows } = await scoped.query<{ n: number }>(
          `select count(*)::int as n from "${table}"`,
        );
        expect(rows[0]?.n, `${table} under scope`).toBeGreaterThanOrEqual(1);
      }
      await scoped.query('commit');
    } finally {
      await scoped.end();
    }

    const unscoped = await connect(db.appUrl);
    try {
      for (const table of SCOPED_TABLE_NAMES) {
        const { rows } = await unscoped.query<{ n: number }>(
          `select count(*)::int as n from "${table}"`,
        );
        expect(rows[0]?.n, `${table} without scope`).toBe(0);
      }
    } finally {
      await unscoped.end();
    }
  });

  it('bumps updated_at on UPDATE through the trigger', async () => {
    const { audit } = await seedMailboxes(db.ownerUrl, ['audit']);
    if (audit === undefined) {
      throw new Error('seedMailboxes returned no id for "audit"');
    }
    const { messageId } = await seedScopedRows(db.ownerUrl, audit);

    // A later transaction than the insert, so now() differs.
    const app = await connect(db.appUrl);
    try {
      await app.query('begin');
      await app.query("select set_config('app.mailbox_id', $1, true)", [audit]);
      const { rows } = await app.query<{ bumped: boolean }>(
        `update message set mailbox_id = mailbox_id where id = $1
         returning updated_at > created_at as bumped`,
        [messageId],
      );
      await app.query('commit');
      expect(rows).toEqual([{ bumped: true }]);
    } finally {
      await app.end();
    }
  });

  it('applies nothing on a rerun', async () => {
    const result = await migrate({
      ownerUrl: db.ownerUrl,
      appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
      backup: undefined,
    });
    expect(result).toEqual({ applied: [], backupFile: null });
  });
});

describe('migrate() ordering (drizzle applies only migrations newer than the last one)', () => {
  async function appliedTags(ownerUrl: string): Promise<number> {
    const owner = await connect(ownerUrl);
    try {
      const { rows } = await owner.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      return rows[0]?.n ?? -1;
    } finally {
      await owner.end();
    }
  }

  it('refuses a journal entry dated before the previous one, before touching the database', async () => {
    const fresh = await freshDatabase();
    const folder = await mkdtemp(path.join(tmpdir(), 'sift-migrations-'));
    try {
      const journal = JSON.parse(
        await readFile(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { when: number }[] };
      const lastWhen = journal.entries.at(-1)?.when ?? 0;
      await withExtraMigration(folder, lastWhen - 1);

      const run = migrate({
        ownerUrl: fresh.ownerUrl,
        appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
        migrationsFolder: folder,
        backup: { url: fresh.backupUrl, dir: folder, pgDump: 'sift-pg-dump-must-not-run' },
      });
      await expect(run).rejects.toThrow(MigrationOrderError);
      await expect(run).rejects.toThrow(/0005_test_extra is dated no later than 0004_/);
      expect(await appliedTags(fresh.ownerUrl)).toBe(5);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await fresh.drop();
    }
  });

  it('refuses a pending migration older than the last applied one instead of reporting nothing pending', async () => {
    const fresh = await freshDatabase();
    const folder = await mkdtemp(path.join(tmpdir(), 'sift-migrations-'));
    try {
      const when = Date.now();
      await withExtraMigration(folder, when);
      // The database already ran a migration from another branch dated later
      // than 0005_test_extra (the rebase case): drizzle would skip 0005.
      const owner = await connect(fresh.ownerUrl);
      try {
        await owner.query(
          `update drizzle.__drizzle_migrations set created_at = $1
            where id = (select max(id) from drizzle.__drizzle_migrations)`,
          [when + 60_000],
        );
      } finally {
        await owner.end();
      }

      await expect(
        migrate({
          ownerUrl: fresh.ownerUrl,
          appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
          migrationsFolder: folder,
          backup: { url: fresh.backupUrl, dir: folder, pgDump: 'sift-pg-dump-must-not-run' },
        }),
      ).rejects.toThrow(
        /1 migration\(s\) in the journal are older than the last applied one and would never be applied/,
      );
      expect(await appliedTags(fresh.ownerUrl)).toBe(5);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await fresh.drop();
    }
  });
});

describe('migrate() decides skipped migrations by identity, not by count (WR-04)', () => {
  async function appliedRows(ownerUrl: string): Promise<number> {
    const owner = await connect(ownerUrl);
    try {
      const { rows } = await owner.query<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      return rows[0]?.n ?? -1;
    } finally {
      await owner.end();
    }
  }

  it('refuses a skipped migration when a row from another branch makes the counts match', async () => {
    const fresh = await freshDatabase();
    const folder = await mkdtemp(path.join(tmpdir(), 'sift-migrations-'));
    try {
      const when = Date.now();
      await withExtraMigration(folder, when);
      // feat-1 applied its own 0005 (dated later) to this database; on feat-2
      // the journal has 0005_test_extra instead. 6 rows, 6 journal entries.
      const owner = await connect(fresh.ownerUrl);
      try {
        await owner.query(
          'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
          ['hash-of-0005-from-another-branch', when + 60_000],
        );
      } finally {
        await owner.end();
      }

      await expect(
        migrate({
          ownerUrl: fresh.ownerUrl,
          appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
          migrationsFolder: folder,
          backup: { url: fresh.backupUrl, dir: folder, pgDump: 'sift-pg-dump-must-not-run' },
        }),
      ).rejects.toThrow(/1 migration\(s\) .* would never be applied \(0005_test_extra\)/);
      expect(await appliedRows(fresh.ownerUrl)).toBe(6);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await fresh.drop();
    }
  });

  it('refuses an applied migration whose file was edited afterwards', async () => {
    const fresh = await freshDatabase();
    const folder = await mkdtemp(path.join(tmpdir(), 'sift-migrations-'));
    try {
      await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
      const edited = path.join(folder, '0004_scoped_tables_force_grants.sql');
      await writeFile(
        edited,
        `${await readFile(edited, 'utf8')}\n-- edited after it was applied\n`,
      );

      await expect(
        migrate({
          ownerUrl: fresh.ownerUrl,
          appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
          migrationsFolder: folder,
          backup: { url: fresh.backupUrl, dir: folder, pgDump: 'sift-pg-dump-must-not-run' },
        }),
      ).rejects.toThrow(/\(0004_scoped_tables_force_grants\)/);
      expect(await appliedRows(fresh.ownerUrl)).toBe(5);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await fresh.drop();
    }
  });
});

describe('migrate() backups (D-29, D-66)', () => {
  it('backs up before applying pending migrations', async (ctx) => {
    const pgDump = requirePgDump(ctx);
    if (pgDump === undefined) return;
    const empty = await emptyDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'sift-backup-'));
    try {
      const result = await migrate({
        ownerUrl: empty.ownerUrl,
        appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
        backup: { url: empty.backupUrl, dir, pgDump },
      });

      expect(result.applied).toHaveLength(5);
      expect(result.backupFile).not.toBeNull();
      const file = result.backupFile ?? '';
      expect(path.dirname(file)).toBe(dir);
      expect(path.basename(file)).toMatch(BACKUP_FILE);
      expect(await readMagic(file)).toBe('PGDMP');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await empty.drop();
    }
  });

  it('writes no backup when there are no pending migrations', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sift-backup-'));
    try {
      const result = await migrate({
        ownerUrl: db.ownerUrl,
        appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
        backup: { url: db.backupUrl, dir, pgDump: 'sift-no-pg-dump-needed' },
      });
      expect(result).toEqual({ applied: [], backupFile: null });
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the newest 5 sift-*.dump files and leaves other files alone', async (ctx) => {
    const pgDump = requirePgDump(ctx);
    if (pgDump === undefined) return;
    const empty = await emptyDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'sift-backup-'));
    try {
      const older = [1, 2, 3, 4, 5, 6].map((d) => `sift-2020010${d}T000000Z-pre-0004_old.dump`);
      for (const name of [...older, 'notes.txt']) {
        await writeFile(path.join(dir, name), 'x');
      }

      const result = await migrate({
        ownerUrl: empty.ownerUrl,
        appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
        backup: { url: empty.backupUrl, dir, pgDump },
      });

      const newest = path.basename(result.backupFile ?? '');
      expect(newest).toMatch(BACKUP_FILE);
      const remaining = (await readdir(dir)).sort();
      expect(remaining).toEqual([newest, ...older.slice(2), 'notes.txt'].sort());
    } finally {
      await rm(dir, { recursive: true, force: true });
      await empty.drop();
    }
  });

  it('throws BackupRequiredError and applies nothing without a backup target', async () => {
    const empty = await emptyDatabase();
    try {
      const verifier = await appVerifier();
      await expect(
        migrate({
          ownerUrl: empty.ownerUrl,
          appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
          backup: undefined,
        }),
      ).rejects.toThrow(BackupRequiredError);
      await expect(
        migrate({
          ownerUrl: empty.ownerUrl,
          appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
          backup: undefined,
        }),
      ).rejects.toThrow(
        'SIFT_BACKUP_DATABASE_URL is not set; a backup is required before applying 5 pending migrations',
      );
      expect(await migrationsTableExists(empty.ownerUrl)).toBe(false);
      expect(await appVerifier()).toBe(verifier);
    } finally {
      await empty.drop();
    }
  });

  it('throws BackupFailedError without the password, leaves no file and applies nothing', async (ctx) => {
    const pgDump = requirePgDump(ctx);
    if (pgDump === undefined) return;
    const empty = await emptyDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'sift-backup-'));
    const wrongPassword = `wrong-${randomBytes(8).toString('hex')}`;
    const badUrl = new URL(empty.backupUrl);
    badUrl.password = wrongPassword;
    try {
      const verifier = await appVerifier();
      const error = await migrate({
        ownerUrl: empty.ownerUrl,
        appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
        backup: { url: badUrl.toString(), dir, pgDump },
      }).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(BackupFailedError);
      const message = (error as Error).message;
      expect(message).toMatch(/^pg_dump failed \(exit \d+\)/);
      expect(message).not.toContain(wrongPassword);
      expect(await readdir(dir)).toEqual([]);
      expect(await migrationsTableExists(empty.ownerUrl)).toBe(false);
      expect(await appVerifier()).toBe(verifier);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await empty.drop();
    }
  });

  it('fails on an unwritable backup dir with a chown 1000 hint and applies nothing', async (ctx) => {
    if (process.getuid?.() === 0) {
      ctx.skip('running as root: directory permissions are not enforced for root');
      return;
    }
    const empty = await emptyDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'sift-backup-'));
    await chmod(dir, 0o500);
    try {
      await expect(
        migrate({
          ownerUrl: empty.ownerUrl,
          appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
          backup: { url: empty.backupUrl, dir, pgDump: 'sift-pg-dump-must-not-run' },
        }),
      ).rejects.toThrow(`backup directory ${dir} is not writable; on Linux run: chown 1000 ${dir}`);
      expect(await migrationsTableExists(empty.ownerUrl)).toBe(false);
    } finally {
      await chmod(dir, 0o700);
      await rm(dir, { recursive: true, force: true });
      await empty.drop();
    }
  });

  it('waits for the advisory lock held by another session (D-30)', async () => {
    const holder = await connect(db.ownerUrl);
    try {
      await holder.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
      let settled = false;
      const run = migrate({
        ownerUrl: db.ownerUrl,
        appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
        backup: undefined,
      }).finally(() => {
        settled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await holder.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]);
      await expect(run).resolves.toEqual({ applied: [], backupFile: null });
    } finally {
      await holder.end();
    }
  });

  it('never sends the sift_app password in a statement, only a SCRAM verifier (IN-03)', async () => {
    const appPassword = requireEnv('SIFT_DB_APP_PASSWORD');
    const texts: string[] = [];
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const [first] = args;
      texts.push(typeof first === 'string' ? first : JSON.stringify(first));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof original);
    try {
      await migrate({ ownerUrl: db.ownerUrl, appPassword, backup: undefined });
    } finally {
      spy.mockRestore();
    }
    const roleDdl = texts.filter((text) => /\b(CREATE|ALTER) ROLE sift_app\b/.test(text));
    expect(roleDdl.length).toBeGreaterThan(0);
    for (const text of roleDdl) expect(text).toMatch(/PASSWORD 'SCRAM-SHA-256\$4096:/);
    for (const text of texts) expect(text).not.toContain(appPassword);
  });

  it('rotates the sift_app password on every run without breaking its login (D-39)', async () => {
    const appPassword = requireEnv('SIFT_DB_APP_PASSWORD');
    const first = await appVerifier();
    await migrate({ ownerUrl: db.ownerUrl, appPassword, backup: undefined });
    const second = await appVerifier();
    await migrate({ ownerUrl: db.ownerUrl, appPassword, backup: undefined });
    const third = await appVerifier();

    // SCRAM salts are random per ALTER ROLE, so equal passwords still differ.
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    const app = await connect(db.appUrl);
    try {
      const { rows } = await app.query<{ ok: number }>('select 1 as ok');
      expect(rows).toEqual([{ ok: 1 }]);
    } finally {
      await app.end();
    }
  });

  it('dumps both mailboxes as sift_backup before a later migration (D-66)', async (ctx) => {
    const pgDump = requirePgDump(ctx);
    if (pgDump === undefined) return;
    const fresh = await freshDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'sift-backup-'));
    const folder = await mkdtemp(path.join(tmpdir(), 'sift-migrations-'));
    try {
      const { a, b } = await seedMailboxes(fresh.ownerUrl, ['a', 'b']);
      if (a === undefined || b === undefined) {
        throw new Error('seedMailboxes returned no ids');
      }
      await seedScopedRows(fresh.ownerUrl, a);
      await seedScopedRows(fresh.ownerUrl, b);
      await withExtraMigration(folder);

      const result = await migrate({
        ownerUrl: fresh.ownerUrl,
        appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
        migrationsFolder: folder,
        backup: { url: fresh.backupUrl, dir, pgDump },
      });
      expect(result.applied).toEqual(['0005_test_extra']);
      const file = result.backupFile ?? '';
      expect(path.basename(file)).toMatch(/^sift-\d{8}T\d{6}Z-pre-0005_test_extra\.dump$/);
      expect(await readMagic(file)).toBe('PGDMP');

      const restore = resolvePgRestore();
      if (restore === undefined) {
        const reason = 'no pg_restore 18: cannot read the dump contents';
        if (process.env.CI) throw new Error(reason);
        ctx.skip(reason);
        return;
      }
      const data = restore(file, ['--data-only', '--table=message', '--file=-']);
      expect(data).toContain(a);
      expect(data).toContain(b);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(folder, { recursive: true, force: true });
      await fresh.drop();
    }
  });
});

interface EmptyDatabase {
  ownerUrl: string;
  backupUrl: string;
  drop(): Promise<void>;
}

let emptyCounter = 0;

/** An unmigrated database owned by sift_owner. It inherits vector from template1. */
async function emptyDatabase(): Promise<EmptyDatabase> {
  const { adminUrl, runId } = requireTestDb();
  emptyCounter += 1;
  const name = `sift_test_${runId}_empty_${emptyCounter}`;
  const admin = await connect(adminUrl);
  try {
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)} OWNER sift_owner`);
  } finally {
    await admin.end();
  }
  return {
    ownerUrl: roleUrl(adminUrl, 'sift_owner', name),
    backupUrl: roleUrl(adminUrl, 'sift_backup', name),
    drop: () => dropDatabase(adminUrl, name),
  };
}

/**
 * pg_dump 18 for the backup tests: SIFT_PG_DUMP (a path is relative to the
 * repo root, e.g. scripts/pg-dump-via-compose.sh), else a host pg_dump that
 * reports version 18, else undefined.
 */
function resolvePgDump(): string | undefined {
  const configured = process.env.SIFT_PG_DUMP?.trim();
  if (configured) {
    return configured.includes('/') ? path.resolve(REPO_ROOT, configured) : configured;
  }
  return reportsVersion18('pg_dump') ? 'pg_dump' : undefined;
}

/** pg_dump for a test that needs one: throws under CI, otherwise skips with a reason. */
function requirePgDump(ctx: { skip(note?: string): void }): string | undefined {
  const pgDump = resolvePgDump();
  if (pgDump === undefined) {
    const reason = 'no pg_dump 18: set SIFT_PG_DUMP or install PostgreSQL 18 client tools';
    if (process.env.CI) throw new Error(reason);
    ctx.skip(reason);
  }
  return pgDump;
}

type Restore = (file: string, args: readonly string[]) => string;

/**
 * pg_restore 18: a host binary that reports 18, else the Compose db
 * container when SIFT_PG_DUMP points at the compose wrapper (the dump is fed
 * on stdin), else undefined.
 */
function resolvePgRestore(): Restore | undefined {
  if (reportsVersion18('pg_restore')) {
    return (file, args) => checked(spawnSync('pg_restore', [...args, file], { encoding: 'utf8' }));
  }
  if (path.basename(process.env.SIFT_PG_DUMP?.trim() ?? '') === 'pg-dump-via-compose.sh') {
    return (file, args) =>
      checked(
        spawnSync('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', ...args], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          input: readFileSyncBuffer(file),
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
  }
  return undefined;
}

function checked(result: SpawnSyncReturns<string>): string {
  if (result.status !== 0) {
    throw new Error(`pg_restore failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

/** Copy the committed migrations and append a trivial 0005_test_extra dated `when`. */
async function withExtraMigration(folder: string, when: number = Date.now()): Promise<void> {
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: object[] };
  journal.entries.push({
    idx: 5,
    version: '7',
    when,
    tag: '0005_test_extra',
    breakpoints: true,
  });
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(path.join(folder, '0005_test_extra.sql'), 'select 1;\n');
}

/** sift_app's stored SCRAM verifier, read with the superuser test URL. */
async function appVerifier(): Promise<string> {
  const admin = await connect(requireTestDb().adminUrl);
  try {
    const { rows } = await admin.query<{ rolpassword: string }>(
      "select rolpassword from pg_authid where rolname = 'sift_app'",
    );
    const verifier = rows[0]?.rolpassword;
    if (verifier === undefined) {
      throw new Error('sift_app has no stored password');
    }
    return verifier;
  } finally {
    await admin.end();
  }
}

async function migrationsTableExists(ownerUrl: string): Promise<boolean> {
  const owner = await connect(ownerUrl);
  try {
    const { rows } = await owner.query<{ present: boolean }>(
      "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
    );
    return rows[0]?.present === true;
  } finally {
    await owner.end();
  }
}

function reportsVersion18(command: string): boolean {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 && /\b18\.\d+/.test(probe.stdout);
}

async function readMagic(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(5);
    await handle.read(buffer, 0, 5, 0);
    return buffer.toString('latin1');
  } finally {
    await handle.close();
  }
}
