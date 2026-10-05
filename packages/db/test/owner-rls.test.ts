import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCOPED_TABLE_NAMES } from '../src/schema/index.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { seedMailboxes, seedScopedRows } from './support/seed.ts';

/**
 * sift_owner owns the tables but FORCE RLS still applies to it (D-41), so
 * owner work on mail data, such as data migrations and the later purge, only
 * touches the mailbox named by app.mailbox_id (D-70). Every DELETE here runs
 * as sift_owner; the superuser only counts rows.
 */

type ScopedTable = (typeof SCOPED_TABLE_NAMES)[number];
type Counts = Record<ScopedTable, number>;

/** Children first, so a RESTRICT foreign key never blocks a parent delete. */
const MESSAGE_CHILDREN_THEN_MESSAGE: readonly ScopedTable[] = [
  'label',
  'decision',
  'message_location',
  'message_body',
  'message',
];
const CHILD_FIRST: readonly ScopedTable[] = [
  ...MESSAGE_CHILDREN_THEN_MESSAGE,
  ...SCOPED_TABLE_NAMES.filter((t) => !MESSAGE_CHILDREN_THEN_MESSAGE.includes(t)),
];

let db: TestDatabase;
let A: string;
let B: string;
let before: { a: Counts; b: Counts };

/** Per-table row counts for one mailbox, read as the superuser (bypasses RLS). */
async function countsFor(mailboxId: string): Promise<Counts> {
  const admin = await connect(db.adminUrl);
  try {
    const out = {} as Counts;
    for (const table of SCOPED_TABLE_NAMES) {
      const { rows } = await admin.query<{ n: number }>(
        `select count(*)::int as n from ${table} where mailbox_id = $1`,
        [mailboxId],
      );
      out[table] = rows[0]?.n ?? -1;
    }
    return out;
  } finally {
    await admin.end();
  }
}

/** DELETE FROM every scoped table, children first; returns rowCount per table. */
async function deleteAll(owner: pg.Client): Promise<Counts> {
  const out = {} as Counts;
  for (const table of CHILD_FIRST) {
    const result = await owner.query(`delete from ${table}`);
    out[table] = result.rowCount ?? -1;
  }
  return out;
}

beforeAll(async () => {
  db = await freshDatabase();
  const ids = await seedMailboxes(db.ownerUrl, ['owner-a', 'owner-b']);
  A = ids['owner-a'] as string;
  B = ids['owner-b'] as string;
  for (const mailboxId of [A, B, A, B]) {
    await seedScopedRows(db.ownerUrl, mailboxId);
  }
  before = { a: await countsFor(A), b: await countsFor(B) };
});

afterAll(async () => {
  await db?.drop();
});

describe('owner DELETE under FORCE RLS (D-70)', () => {
  it('seeds rows for both mailboxes in every scoped table', () => {
    for (const table of SCOPED_TABLE_NAMES) {
      expect(before.a[table], table).toBeGreaterThan(0);
      expect(before.b[table], table).toBeGreaterThan(0);
    }
  });

  it('an unscoped owner DELETE removes nothing', async () => {
    const owner = await connect(db.ownerUrl);
    try {
      const deleted = await deleteAll(owner);
      for (const table of SCOPED_TABLE_NAMES) {
        expect(deleted[table], table).toBe(0);
      }
    } finally {
      await owner.end();
    }
    expect(await countsFor(A)).toEqual(before.a);
    expect(await countsFor(B)).toEqual(before.b);
  });

  it("an owner DELETE under A removes exactly A's rows and none of B's", async () => {
    const owner = await connect(db.ownerUrl);
    try {
      await owner.query('begin');
      await owner.query("select set_config('app.mailbox_id', $1, true)", [A]);
      // The owner owns the tables, so the append-only ones accept DELETE too.
      const deleted = await deleteAll(owner);
      await owner.query('commit');
      expect(deleted).toEqual(before.a);
    } catch (error) {
      await owner.query('rollback').catch(() => {});
      throw error;
    } finally {
      await owner.end();
    }

    const afterA = await countsFor(A);
    const afterB = await countsFor(B);
    for (const table of SCOPED_TABLE_NAMES) {
      expect(afterA[table], table).toBe(0);
      expect(afterB[table], table).toBe(before.b[table]);
    }

    // The registry row for A stays; deleting mailboxes is not part of Phase 1.
    const admin = await connect(db.adminUrl);
    try {
      const { rows } = await admin.query('select id from mailbox where id = $1', [A]);
      expect(rows).toHaveLength(1);
    } finally {
      await admin.end();
    }
  });
});
