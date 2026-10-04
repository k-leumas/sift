import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { CATALOG_ALLOWLIST, collectCatalogViolations } from './support/catalog.ts';
import { connect, freshDatabase, requireTestDb, type TestDatabase } from './support/db.ts';

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

describe('catalog privilege and role checks (D-37, D-40, D-66)', () => {
  it('reports a TRUNCATE grant to sift_app', async () => {
    const violations = await violationsAfter((db) =>
      run(db.ownerUrl, 'grant truncate on message to sift_app'),
    );
    expect(violations).toEqual(['public.message: sift_app has TRUNCATE, expected none']);
  });

  it('reports a second permissive policy (ISO-02 ordering edge)', async () => {
    const violations = await violationsAfter((db) =>
      run(db.ownerUrl, 'create policy widen on message for select to sift_app using (true)'),
    );
    expect(violations).toContain('public.message: has 2 policies, expected exactly 1');
    expect(violations).toContain('public.message: policy widen is FOR r, expected FOR ALL');
    expect(violations.some((v) => v.startsWith('public.message: policy widen USING'))).toBe(true);
  });

  it('reports a non-superuser role with BYPASSRLS other than sift_backup', async () => {
    const { adminUrl } = requireTestDb();
    const rogue = `rogue_bypass_${randomBytes(3).toString('hex')}`;
    try {
      const violations = await violationsAfter(() =>
        run(adminUrl, `create role ${rogue} bypassrls`),
      );
      expect(violations).toEqual([`role ${rogue}: has BYPASSRLS; only sift_backup may bypass RLS`]);
    } finally {
      await run(adminUrl, `drop role if exists ${rogue}`);
    }
  });

  it('reports a column-level UPDATE grant on an append-only table', async () => {
    const violations = await violationsAfter((db) =>
      run(db.ownerUrl, 'grant update (updated_at) on decision to sift_app'),
    );
    expect(violations).toEqual(['public.decision: sift_app has UPDATE, expected none']);
  });

  it('reports a missing grant, an extra registry column and a dropped trigger', async () => {
    const violations = await violationsAfter((db) =>
      run(
        db.ownerUrl,
        'revoke delete on label from sift_app',
        'alter table mailbox add column notes text',
        'drop trigger rule_set_set_updated_at on rule_set',
      ),
    );
    expect(violations).toEqual([
      'public.label: sift_app lacks DELETE',
      'public.rule_set: no BEFORE UPDATE row trigger calling set_updated_at()',
      expect.stringMatching(
        /^public\.mailbox: columns are \(.*, notes\), expected MAILBOX_COLUMNS$/,
      ),
    ]);
  });

  it('reports a scoped FK that does not pair mailbox_id and a missing composite key', async () => {
    const violations = await violationsAfter((db) =>
      run(
        db.ownerUrl,
        'alter table label add constraint label_rule_set_loose_fk foreign key (id) references rule_set (id)',
        'alter table folder_sync drop constraint folder_sync_mailbox_id_id_key',
      ),
    );
    expect(violations).toEqual([
      'public.folder_sync: no UNIQUE (mailbox_id, id)',
      'public.label: foreign key label_rule_set_loose_fk to public.rule_set does not pair mailbox_id on both sides',
    ]);
  });
});
