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
    const idCol = table === 'mailbox_status' ? 'mailbox_id' : 'id';
    const { rows } = await admin.query<Row>(
      `select ${idCol} as id, mailbox_id, updated_at from ${table}`,
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
