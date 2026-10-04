import { spawnSync } from 'node:child_process';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/owner/migrate.ts';
import { SCOPED_TABLE_NAMES } from '../src/schema/index.ts';
import {
  connect,
  dropDatabase,
  freshDatabase,
  requireEnv,
  requireTestDb,
  roleUrl,
  type TestDatabase,
} from './support/db.ts';
import { seedMailboxes, seedScopedRows } from './support/seed.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const BACKUP_FILE = /^sift-\d{8}T\d{6}Z-pre-0004_scoped_tables_force_grants\.dump$/;

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db?.drop();
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

describe('migrate() backups (D-29, D-66)', () => {
  it('backs up before applying pending migrations', async (ctx) => {
    const pgDump = resolvePgDump();
    if (pgDump === undefined) {
      const reason = 'no pg_dump 18: set SIFT_PG_DUMP or install PostgreSQL 18 client tools';
      if (process.env.CI) throw new Error(reason);
      ctx.skip(reason);
      return;
    }
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
