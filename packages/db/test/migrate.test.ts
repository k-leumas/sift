import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/owner/migrate.ts';
import { connect, freshDatabase, requireEnv, type TestDatabase } from './support/db.ts';

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
      expect(rows[0]?.n).toBe(3);
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

  it('applies nothing on a rerun', async () => {
    const result = await migrate({
      ownerUrl: db.ownerUrl,
      appPassword: requireEnv('SIFT_DB_APP_PASSWORD'),
    });
    expect(result.applied).toEqual([]);
  });
});
