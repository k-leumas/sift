import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/owner/migrate.ts';
import { SCOPED_TABLE_NAMES } from '../src/schema/index.ts';
import { connect, freshDatabase, requireEnv, type TestDatabase } from './support/db.ts';
import { seedMailboxes, seedScopedRows } from './support/seed.ts';

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
    });
    expect(result.applied).toEqual([]);
  });
});
