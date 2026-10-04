import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APPEND_ONLY_TABLE_NAMES, SCOPED_TABLE_NAMES } from '../src/schema/index.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { type ScopedRowIds, seedMailboxes, seedScopedRows } from './support/seed.ts';

/**
 * Mailbox isolation at the database level (ISO-03, success criterion 4).
 * Every statement runs on a raw pg client logged in as sift_app with no
 * application `WHERE mailbox_id` filter (D-46), so RLS alone decides what is
 * visible. The superuser connection is used only for ground truth.
 */

type ScopedTable = (typeof SCOPED_TABLE_NAMES)[number];

const APPEND_ONLY = new Set<string>(APPEND_ONLY_TABLE_NAMES);
const MUTABLE_TABLES = SCOPED_TABLE_NAMES.filter((t) => !APPEND_ONLY.has(t));

/** Children first, so a RESTRICT foreign key never masks the RLS result. */
const CHILD_FIRST: readonly ScopedTable[] = [
  'label',
  'decision',
  'message',
  ...SCOPED_TABLE_NAMES.filter((t) => !['label', 'decision', 'message'].includes(t)),
];

/** mailbox_status is keyed by mailbox_id; every other scoped table has an id. */
function selectSql(table: ScopedTable): string {
  return table === 'mailbox_status'
    ? 'select mailbox_id as id, mailbox_id from mailbox_status'
    : `select id, mailbox_id from ${table}`;
}

interface Row {
  id: string;
  mailbox_id: string;
  updated_at?: Date;
}

const sortedIds = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id).sort();

const idColumn = (table: ScopedTable): string => (table === 'mailbox_status' ? 'mailbox_id' : 'id');

/** label and decision reference a message through (mailbox_id, message_id) (D-04). */
function insertStatement(
  table: ScopedTable,
  mailboxId: string | null,
  messageId: string,
): [string, unknown[]] {
  return table === 'label' || table === 'decision'
    ? [`insert into ${table} (mailbox_id, message_id) values ($1, $2)`, [mailboxId, messageId]]
    : [`insert into ${table} (mailbox_id) values ($1)`, [mailboxId]];
}

/**
 * Run `fn` in a transaction with app.mailbox_id set transaction-locally, the
 * way the app's withMailbox does. Rolls back and rethrows on error.
 */
async function inScope<T>(
  client: pg.Client,
  mailboxId: string,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query("select set_config('app.mailbox_id', $1, true)", [mailboxId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

let db: TestDatabase;
let admin: pg.Client;
let app: pg.Client;
const extraClients: pg.Client[] = [];
let A: string;
let B: string;
let C: string;
let seededA: ScopedRowIds[];
let seededB: ScopedRowIds[];
/** Ground truth per table, read as the superuser (bypasses RLS). */
let truth: Record<ScopedTable, Row[]>;

async function readTruth(): Promise<Record<ScopedTable, Row[]>> {
  const out = {} as Record<ScopedTable, Row[]>;
  for (const table of SCOPED_TABLE_NAMES) {
    const { rows } = await admin.query<Row>(
      `select ${idColumn(table)} as id, mailbox_id, updated_at from ${table}`,
    );
    out[table] = rows;
  }
  return out;
}

const rowsOf = (table: ScopedTable, mailboxId: string): Row[] =>
  truth[table].filter((r) => r.mailbox_id === mailboxId);

/** A new sift_app connection that is closed in afterAll. */
async function newAppClient(): Promise<pg.Client> {
  const client = await connect(db.appUrl);
  extraClients.push(client);
  return client;
}

beforeAll(async () => {
  db = await freshDatabase();
  const ids = await seedMailboxes(db.ownerUrl, ['iso-a', 'iso-b', 'iso-c']);
  A = ids['iso-a'] as string;
  B = ids['iso-b'] as string;
  C = ids['iso-c'] as string;
  seededA = [await seedScopedRows(db.ownerUrl, A), await seedScopedRows(db.ownerUrl, A)];
  seededB = [await seedScopedRows(db.ownerUrl, B), await seedScopedRows(db.ownerUrl, B)];
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
  truth = await readTruth();
});

afterAll(async () => {
  for (const client of [app, admin, ...extraClients]) {
    await client?.end().catch(() => {});
  }
  await db?.drop();
});

describe('mailbox isolation as sift_app with no application filter (ISO-03)', () => {
  it('seeds both mailboxes into every scoped table', () => {
    for (const table of SCOPED_TABLE_NAMES) {
      const expected = table === 'mailbox_status' ? 1 : 2;
      expect(rowsOf(table, A), table).toHaveLength(expected);
      expect(rowsOf(table, B), table).toHaveLength(expected);
      expect(rowsOf(table, C), table).toHaveLength(0);
    }
    expect(sortedIds(rowsOf('message', A))).toEqual(seededA.map((s) => s.messageId).sort());
    expect(sortedIds(rowsOf('message', B))).toEqual(seededB.map((s) => s.messageId).sort());
  });

  it('reads under A return only A, in every scoped table', async () => {
    for (const table of SCOPED_TABLE_NAMES) {
      const rows = await inScope(app, A, async (c) => (await c.query<Row>(selectSql(table))).rows);
      expect(rows.length, table).toBeGreaterThanOrEqual(1);
      expect(
        rows.every((r) => r.mailbox_id === A),
        table,
      ).toBe(true);
      expect(sortedIds(rows), table).toEqual(sortedIds(rowsOf(table, A)));
    }
  });

  it('update and delete aimed at B affect 0 rows and leave B unchanged', async () => {
    for (const table of MUTABLE_TABLES) {
      const result = await inScope(app, A, (c) =>
        c.query(`update ${table} set updated_at = updated_at where mailbox_id = $1`, [B]),
      );
      expect(result.rowCount, `update ${table}`).toBe(0);
    }
    for (const table of CHILD_FIRST.filter((t) => !APPEND_ONLY.has(t))) {
      const result = await inScope(app, A, (c) =>
        c.query(`delete from ${table} where mailbox_id = $1`, [B]),
      );
      expect(result.rowCount, `delete ${table}`).toBe(0);
    }
    const after = await readTruth();
    for (const table of SCOPED_TABLE_NAMES) {
      const bAfter = after[table].filter((r) => r.mailbox_id === B);
      expect(bAfter, table).toEqual(
        expect.arrayContaining(rowsOf(table, B).map((r) => expect.objectContaining(r))),
      );
      expect(bAfter, table).toHaveLength(rowsOf(table, B).length);
    }
  });

  it('a fresh connection with no mailbox set reads nothing and cannot insert', async () => {
    const fresh = await newAppClient();
    for (const table of SCOPED_TABLE_NAMES) {
      const { rows } = await fresh.query(selectSql(table));
      expect(rows, table).toHaveLength(0);
    }
    await expect(
      fresh.query('insert into message (mailbox_id) values ($1)', [A]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('cross-mailbox writes and scope edges (D-48)', () => {
  const aMessage = (): string => (seededA[0] as ScopedRowIds).messageId;
  const bMessage = (): string => (seededB[0] as ScopedRowIds).messageId;

  it('inserting a row for B under A fails the RLS check on every scoped table', async () => {
    for (const table of SCOPED_TABLE_NAMES) {
      // label and decision point at A's own message, so RLS, not the FK, is what fails.
      const [sql, params] = insertStatement(table, B, aMessage());
      await expect(
        inScope(app, A, (c) => c.query(sql, params)),
        table,
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('moving an A row to B fails the RLS check on every non-append-only table', async () => {
    for (const table of MUTABLE_TABLES) {
      const aRow = rowsOf(table, A)[0] as Row;
      await expect(
        inScope(app, A, (c) =>
          c.query(`update ${table} set mailbox_id = $1 where ${idColumn(table)} = $2`, [
            B,
            aRow.id,
          ]),
        ),
        table,
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it("an A label or decision pointing at B's message fails the composite FK (D-04)", async () => {
    for (const table of ['label', 'decision'] as const) {
      await expect(
        inScope(app, A, (c) =>
          c.query(`insert into ${table} (mailbox_id, message_id) values ($1, $2)`, [A, bMessage()]),
        ),
        table,
      ).rejects.toMatchObject({ code: '23503' });
    }
  });

  it('a reused connection after a committed scope reads nothing, without error', async () => {
    const reused = await newAppClient();
    const first = await inScope(reused, A, (c) => c.query(selectSql('message')));
    expect(first.rows.length).toBeGreaterThan(0);

    const { rows } = await reused.query<{ setting: string | null }>(
      "select current_setting('app.mailbox_id', true) as setting",
    );
    expect(rows[0]?.setting).toBe('');
    for (const table of SCOPED_TABLE_NAMES) {
      const result = await reused.query(selectSql(table));
      expect(result.rows, table).toHaveLength(0);
    }
    await expect(
      reused.query('insert into message (mailbox_id) values ($1)', [A]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('a non-UUID app.mailbox_id errors with 22P02 and never returns rows', async () => {
    await expect(
      inScope(app, 'not-a-uuid', (c) => c.query('select * from message')),
    ).rejects.toMatchObject({ code: '22P02' });
    for (const table of SCOPED_TABLE_NAMES) {
      await expect(
        inScope(app, 'not-a-uuid', (c) => c.query(selectSql(table))),
        table,
      ).rejects.toMatchObject({ code: '22P02' });
    }
  });

  it("the upper-case spelling of A's UUID scopes to A (uuid, not text, equality)", async () => {
    const upper = A.toUpperCase();
    expect(upper).not.toBe(A);
    for (const table of SCOPED_TABLE_NAMES) {
      const { rows } = await inScope(app, upper, (c) => c.query<Row>(selectSql(table)));
      expect(sortedIds(rows), table).toEqual(sortedIds(rowsOf(table, A)));
    }
  });

  it('an empty mailbox C reads 0 rows from every scoped table', async () => {
    for (const table of SCOPED_TABLE_NAMES) {
      const { rows } = await inScope(app, C, (c) => c.query<Row>(selectSql(table)));
      expect(rows, table).toHaveLength(0);
    }
  });

  it("an unfiltered update under A touches exactly A's rows", async () => {
    const result = await inScope(app, A, (c) => c.query('update message set updated_at = now()'));
    expect(result.rowCount).toBe(seededA.length);
    expect(result.rowCount).toBe(rowsOf('message', A).length);

    const after = await readTruth();
    const bAfter = after.message.filter((r) => r.mailbox_id === B);
    const bBefore = rowsOf('message', B);
    expect(sortedIds(bAfter)).toEqual(sortedIds(bBefore));
    for (const row of bBefore) {
      const now = bAfter.find((r) => r.id === row.id);
      expect(now?.updated_at?.getTime(), row.id).toBe(row.updated_at?.getTime());
    }
  });

  it('update and delete on append-only tables fail the privilege check (D-40)', async () => {
    for (const table of APPEND_ONLY_TABLE_NAMES) {
      await expect(
        inScope(app, A, (c) => c.query(`update ${table} set updated_at = now()`)),
        `update ${table}`,
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        inScope(app, A, (c) => c.query(`delete from ${table}`)),
        `delete ${table}`,
      ).rejects.toMatchObject({ code: '42501' });
    }
    // Even under the row's own mailbox the rows are still there.
    const after = await readTruth();
    for (const table of APPEND_ONLY_TABLE_NAMES) {
      expect(sortedIds(after[table]), table).toEqual(sortedIds(truth[table]));
    }
  });

  it('a NULL mailbox_id fails RLS as sift_app and NOT NULL as the superuser (ISO-01)', async () => {
    await expect(
      inScope(app, A, (c) => c.query('insert into message (mailbox_id) values (null)')),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.query('insert into message (mailbox_id) values (null)'),
    ).rejects.toMatchObject({ code: '23502' });
  });
});
