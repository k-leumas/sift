import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { CATALOG_ALLOWLIST, collectCatalogViolations } from './support/catalog.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';

type Setup = (db: TestDatabase) => Promise<void>;

/** Run SQL statements on `url` in order. */
async function run(url: string, ...statements: string[]): Promise<void> {
  const client = await connect(url);
  try {
    for (const sql of statements) {
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

/**
 * Clone the migrated template, apply `setup`, and collect violations as the
 * superuser (which sees every relation and role).
 */
async function violationsAfter(
  setup?: Setup,
  allowlist?: Record<string, string>,
): Promise<string[]> {
  const db = await freshDatabase();
  try {
    await setup?.(db);
    const admin: pg.Client = await connect(db.adminUrl);
    try {
      return await collectCatalogViolations(admin, allowlist);
    } finally {
      await admin.end();
    }
  } finally {
    await db.drop();
  }
}

describe('catalog schema check (success criterion 3)', () => {
  it('reports no violations on the migrated schema', async () => {
    expect(await violationsAfter()).toEqual([]);
  });

  it('reports a rogue table without mailbox_id or RLS', async () => {
    const violations = await violationsAfter((db) =>
      run(db.ownerUrl, 'create table rogue_note (id uuid primary key default uuidv7(), body text)'),
    );
    expect(violations.length).toBeGreaterThan(0);
    const rogue = violations.filter((v) => v.startsWith('public.rogue_note:'));
    expect(rogue.some((v) => v.includes('mailbox_id'))).toBe(true);
    expect(rogue).toContain('public.rogue_note: row level security is not enabled');
    expect(rogue).toContain('public.rogue_note: row level security is not forced');
    expect(rogue).toContain('public.rogue_note: has 0 policies, expected exactly 1');
  });

  it('reports a nullable mailbox_id (ISO-01 empty edge)', async () => {
    const violations = await violationsAfter((db) =>
      run(db.ownerUrl, 'alter table message alter column mailbox_id drop not null'),
    );
    expect(violations).toContain('public.message: mailbox_id is not NOT NULL');
  });

  it('reports a stale allowlist entry and a blank reason', async () => {
    const violations = await violationsAfter(undefined, {
      ...CATALOG_ALLOWLIST,
      'public.ghost_table': 'never created',
      'public.mailbox': '   ',
    });
    expect(violations).toEqual([
      'allowlist: public.mailbox has a blank reason',
      'allowlist: public.ghost_table does not exist (stale entry)',
    ]);
  });
});
