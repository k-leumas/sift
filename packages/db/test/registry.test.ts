import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MailboxConfig, SiftConfig } from '@sift/core/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyConfig, listMailboxes, renameMailbox } from '../src/owner/registry.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { seedScopedRows } from './support/seed.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');

/** The deferred mailbox hard-delete command (D-69): no output may name it. */
const DEFERRED_COMMAND = /purge/i;

function mailbox(
  slug: string,
  overrides: { displayName?: string; imap?: Partial<MailboxConfig['imap']> } = {},
): MailboxConfig {
  return {
    slug,
    display_name: overrides.displayName ?? `Mailbox ${slug}`,
    imap: {
      host: 'protonmail-bridge',
      port: 1143,
      username: `${slug}@proton.me`,
      password_env: 'SIFT_TEST_IMAP_PASSWORD',
      folder: 'INBOX',
      tls: { mode: 'starttls' },
      ...overrides.imap,
    },
    ingest: { initial_backfill_days: 30, new_mail_cap: 200 },
    labels: { apply_as: 'proton_labels' },
  };
}

function config(...mailboxes: MailboxConfig[]): SiftConfig {
  return {
    version: 1,
    mailboxes,
    models: {
      provider: 'ollama',
      url: 'http://localhost:11434',
      embeddings: 'nomic-embed-text',
      llm: 'qwen3:1.7b',
    },
    worker: { poll_interval_seconds: 60 },
  };
}

/** Every mailbox row, every column, as one JSON string (byte-level compare). */
async function snapshot(db: TestDatabase): Promise<string> {
  const client = await connect(db.adminUrl);
  try {
    const { rows } = await client.query<{ snap: string | null }>(
      'select json_agg(m order by m.slug)::text as snap from mailbox m',
    );
    return rows[0]?.snap ?? '[]';
  } finally {
    await client.end();
  }
}

interface RegistryRow {
  id: string;
  slug: string;
  display_name: string | null;
  imap_host: string;
  disabled_at: Date | null;
}

async function registry(db: TestDatabase): Promise<Record<string, RegistryRow>> {
  const client = await connect(db.adminUrl);
  try {
    const { rows } = await client.query<RegistryRow>(
      'select id, slug, display_name, imap_host, disabled_at from mailbox order by slug',
    );
    return Object.fromEntries(rows.map((r) => [r.slug, r]));
  } finally {
    await client.end();
  }
}

describe('applyConfig', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  afterEach(async () => {
    await db?.drop();
  });

  it('refuses a disappearing slug next to a new one and leaves the registry byte-identical', async () => {
    await applyConfig(db.ownerUrl, config(mailbox('personal'), mailbox('jobs')));
    const before = await snapshot(db);

    const result = await applyConfig(
      db.ownerUrl,
      config(mailbox('personal'), mailbox('job-search')),
    );

    expect(result).toEqual({
      status: 'refused-rename',
      removed: ['jobs'],
      added: ['job-search'],
      // The two entries read different IMAP usernames (IN-09).
      pairs: [{ from: 'jobs', to: 'job-search', identityDiffers: true }],
    });
    expect(await snapshot(db)).toBe(before);
  });

  it('with confirm, disables the old slug and adds the new one', async () => {
    await applyConfig(db.ownerUrl, config(mailbox('personal'), mailbox('jobs')));

    const result = await applyConfig(
      db.ownerUrl,
      config(mailbox('personal'), mailbox('job-search')),
      { confirm: true },
    );

    expect(result.status).toBe('applied');
    const rows = await registry(db);
    expect(rows.jobs?.disabled_at).toBeInstanceOf(Date);
    expect(rows['job-search']?.disabled_at).toBeNull();
    expect(rows.personal?.disabled_at).toBeNull();
  });

  it('applies display_name and imap_host changes', async () => {
    await applyConfig(db.ownerUrl, config(mailbox('personal')));

    const result = await applyConfig(
      db.ownerUrl,
      config(mailbox('personal', { displayName: 'Home', imap: { host: 'bridge.local' } })),
    );

    expect(result).toEqual({
      status: 'applied',
      changes: [
        {
          kind: 'update',
          slug: 'personal',
          changes: [
            { field: 'display_name', from: 'Mailbox personal', to: 'Home' },
            { field: 'imap_host', from: 'protonmail-bridge', to: 'bridge.local' },
          ],
        },
      ],
    });
    const rows = await registry(db);
    expect(rows.personal?.display_name).toBe('Home');
    expect(rows.personal?.imap_host).toBe('bridge.local');
  });

  it('disables a removed slug and re-enables it under the same id when it returns', async () => {
    await applyConfig(db.ownerUrl, config(mailbox('personal'), mailbox('jobs')));
    const { id } = (await registry(db)).jobs ?? { id: '' };

    await applyConfig(db.ownerUrl, config(mailbox('personal')));
    expect((await registry(db)).jobs?.disabled_at).toBeInstanceOf(Date);

    const back = await applyConfig(db.ownerUrl, config(mailbox('personal'), mailbox('jobs')));
    expect(back).toEqual({
      status: 'applied',
      changes: [{ kind: 'enable', slug: 'jobs', changes: [] }],
    });
    const jobs = (await registry(db)).jobs;
    expect(jobs?.disabled_at).toBeNull();
    expect(jobs?.id).toBe(id);
  });

  it('serializes two concurrent applies without a unique violation', async () => {
    const wanted = config(mailbox('personal'), mailbox('jobs'), mailbox('side'));

    const results = await Promise.all([
      applyConfig(db.ownerUrl, wanted),
      applyConfig(db.ownerUrl, wanted),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['applied', 'unchanged']);
    expect(Object.keys(await registry(db))).toEqual(['jobs', 'personal', 'side']);
    expect(await applyConfig(db.ownerUrl, wanted)).toEqual({ status: 'unchanged' });
  });

  it('rolls back every write when a later change fails', async () => {
    // The schema would reject this slug; a direct call reaches the DB check constraint.
    const broken = config(mailbox('alpha'), mailbox('Not_A_Slug'));

    await expect(applyConfig(db.ownerUrl, broken)).rejects.toThrow(/mailbox_slug_format/);

    expect(await snapshot(db)).toBe('[]');
  });
});

describe('renameMailbox', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await freshDatabase();
    await applyConfig(db.ownerUrl, config(mailbox('personal'), mailbox('job-search')));
  });

  afterEach(async () => {
    await db?.drop();
  });

  it('changes only the slug and keeps every scoped row under the same id', async () => {
    const { id } = (await registry(db)).personal ?? { id: '' };
    await seedScopedRows(db.ownerUrl, id);

    await renameMailbox(db.ownerUrl, 'personal', 'home');

    const rows = await registry(db);
    expect(rows.personal).toBeUndefined();
    expect(rows.home?.id).toBe(id);
    const admin = await connect(db.adminUrl);
    try {
      for (const table of ['message', 'label', 'decision', 'folder_sync', 'label_event']) {
        const { rows: counts } = await admin.query<{ n: number }>(
          `select count(*)::int as n from ${table} where mailbox_id = $1`,
          [id],
        );
        expect(counts[0]?.n, table).toBe(1);
      }
    } finally {
      await admin.end();
    }
  });

  it.each([
    ['an unknown old slug', 'nope', 'home', 'no mailbox with slug "nope"'],
    [
      'an existing new slug',
      'personal',
      'job-search',
      'a mailbox with slug "job-search" already exists',
    ],
    ['an invalid new slug', 'personal', 'Home', 'slugs must be lowercase'],
  ])('rejects %s and changes nothing', async (_case, from, to, message) => {
    const before = await snapshot(db);

    await expect(renameMailbox(db.ownerUrl, from, to)).rejects.toThrow(message);

    expect(await snapshot(db)).toBe(before);
  });
});

describe('registry CLI (config apply, mailbox list, mailbox rename)', () => {
  let db: TestDatabase;
  let dir: string;
  const outputs: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase();
    dir = await mkdtemp(path.join(tmpdir(), 'sift-registry-'));
  });

  afterAll(async () => {
    await db?.drop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  async function writeConfig(name: string, text: string): Promise<string> {
    const file = path.join(dir, name);
    await writeFile(file, text);
    return file;
  }

  /** "job-search" is "jobs" renamed: same IMAP account, so a rename leaves nothing to apply. */
  const ACCOUNT: Record<string, string> = { 'job-search': 'jobs' };

  function yamlFor(slugs: readonly string[]): string {
    const entries = slugs.map(
      (slug) => `  - slug: ${slug}
    imap:
      host: protonmail-bridge
      port: 1143
      username: ${ACCOUNT[slug] ?? slug}@proton.me
      password_env: SIFT_TEST_IMAP_PASSWORD
    labels:
      apply_as: proton_labels
`,
    );
    return `version: 1
mailboxes:
${entries.join('')}models:
  provider: ollama
  embeddings: nomic-embed-text
  llm: qwen3:1.7b
`;
  }

  /** Run the CLI as the owner. Every output is kept for the D-69 check. */
  function sift(configFile: string | null, ...args: string[]) {
    const env: Record<string, string> = {
      SIFT_OWNER_DATABASE_URL: db.ownerUrl,
      PATH: process.env.PATH ?? '',
    };
    if (configFile !== null) env.SIFT_CONFIG = configFile;
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    outputs.push(result.stdout, result.stderr);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('config apply adds the configured mailboxes', async () => {
    const file = await writeConfig('two.yaml', yamlFor(['personal', 'jobs']));
    const { status, stdout } = sift(file, 'config', 'apply');
    expect(status).toBe(0);
    expect(stdout).toContain('add mailbox "personal"');
    expect(stdout).toContain('add mailbox "jobs"');
  });

  it('config apply refuses a likely rename, names the rename command and writes nothing', async () => {
    const before = await snapshot(db);
    const file = await writeConfig('renamed.yaml', yamlFor(['personal', 'job-search']));

    const { status, stdout, stderr } = sift(file, 'config', 'apply');

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('"jobs" is no longer in config.yaml, and "job-search" is new');
    expect(stderr).toContain('sift mailbox rename jobs job-search');
    expect(stderr).toContain('docker compose run --rm setup sift mailbox rename jobs job-search');
    expect(stderr).toContain('run setup again');
    expect(stderr).toContain('--confirm');
    expect(stderr).toContain('No changes applied.');
    expect(await snapshot(db)).toBe(before);
  });

  it.each([
    ['an empty', ''],
    ['a broken', 'version: 1\nmailboxes: [\n'],
    ['a mailbox-less', 'version: 1\nmailboxes: []\n'],
  ])('config apply with %s config file exits 1 and changes nothing', async (_case, text) => {
    const before = await snapshot(db);
    const file = await writeConfig('bad.yaml', text);

    const { status, stderr } = sift(file, 'config', 'apply');

    expect(status).toBe(1);
    expect(stderr).toContain('No changes applied.');
    expect(await snapshot(db)).toBe(before);
  });

  it('mailbox rename keeps the id and tells the owner to update config and rerun setup', async () => {
    const before = (await registry(db)).jobs;

    const { status, stdout } = sift(null, 'mailbox', 'rename', 'jobs', 'job-search');

    expect(status).toBe(0);
    expect(stdout).toContain('Renamed mailbox "jobs" to "job-search"');
    expect(stdout).toContain('config/config.yaml uses "job-search"');
    expect(stdout).toContain('docker compose run --rm setup');
    expect((await registry(db))['job-search']?.id).toBe(before?.id);

    const file = await writeConfig('after-rename.yaml', yamlFor(['personal', 'job-search']));
    expect(sift(file, 'config', 'apply').stdout).toContain(
      'Mailbox registry already matches config.yaml.',
    );
  });

  it('mailbox rename rejects bad input with a clear message', () => {
    const usage = sift(null, 'mailbox', 'rename', 'personal');
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain('sift mailbox rename <old-slug> <new-slug>');

    const unknown = sift(null, 'mailbox', 'rename', 'nope', 'home');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('sift mailbox rename: no mailbox with slug "nope"');

    const invalid = sift(null, 'mailbox', 'rename', 'personal', 'Home');
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('slugs must be lowercase');
  });

  it('config apply --confirm disables and adds; mailbox list shows the disabled mailbox', async () => {
    const file = await writeConfig('swap.yaml', yamlFor(['personal', 'side']));
    expect(sift(file, 'config', 'apply').status).toBe(1);

    const applied = sift(file, 'config', 'apply', '--confirm');
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain(
      'disable mailbox "job-search" (no longer in config.yaml; its data is kept)',
    );
    expect(applied.stdout).toContain('add mailbox "side"');

    const list = sift(null, 'mailbox', 'list');
    expect(list.status).toBe(0);
    const line = list.stdout.split('\n').find((l) => l.startsWith('job-search '));
    expect(line).toMatch(/disabled since \d{4}-\d{2}-\d{2}/);
    expect(list.stdout).toMatch(/^side\s+never run/m);

    const listings = await listMailboxes(db.ownerUrl);
    expect(listings.map((l) => l.slug)).toEqual(['job-search', 'personal', 'side']);
  });

  it('no output of config apply, mailbox list or mailbox rename names the deferred command (D-69)', () => {
    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) expect(output).not.toMatch(DEFERRED_COMMAND);
  });
});

describe('listMailboxes: states, valve, backfill progress and message counts (02-16)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
  });

  afterAll(async () => {
    await db?.drop();
  });

  /** Insert a status row as the owner under the mailbox's app.mailbox_id (FORCE RLS). */
  async function setStatus(id: string, values: Record<string, string | number | null>) {
    const owner = await connect(db.ownerUrl);
    try {
      await owner.query('begin');
      await owner.query("select set_config('app.mailbox_id', $1, true)", [id]);
      const columns = Object.keys(values);
      await owner.query(
        `insert into mailbox_status (mailbox_id, ${columns.join(', ')})
         values ($1, ${columns.map((_, i) => `$${i + 2}`).join(', ')})`,
        [id, ...Object.values(values)],
      );
      await owner.query('commit');
    } finally {
      await owner.end();
    }
  }

  it('returns valve counts, backfill progress and the stored message count per mailbox', async () => {
    await applyConfig(
      db.ownerUrl,
      config(mailbox('alpha'), mailbox('bravo'), mailbox('charlie'), mailbox('delta')),
    );
    const ids = Object.fromEntries(
      Object.entries(await registry(db)).map(([slug, row]) => [slug, row.id]),
    );
    await setStatus(ids.alpha ?? '', { state: 'connecting' });
    await setStatus(ids.bravo ?? '', {
      state: 'needs_attention',
      held_new_count: 250,
      approved_new_count: 250,
    });
    await setStatus(ids.charlie ?? '', { state: 'ok', backfill_done: 400, backfill_total: 1250 });
    // seedScopedRows adds one message per call, and a default (ok) status row when none exists.
    for (let i = 0; i < 3; i += 1) await seedScopedRows(db.ownerUrl, ids.charlie ?? '');
    await seedScopedRows(db.ownerUrl, ids.delta ?? '');
    // delta is disabled but keeps its data and its count.
    await applyConfig(db.ownerUrl, config(mailbox('alpha'), mailbox('bravo'), mailbox('charlie')));

    const listings = await listMailboxes(db.ownerUrl);
    const pick = (l: (typeof listings)[number]) => ({
      slug: l.slug,
      state: l.state,
      disabled: l.disabledAt !== null,
      heldNewCount: l.heldNewCount,
      approvedNewCount: l.approvedNewCount,
      backfillDone: l.backfillDone,
      backfillTotal: l.backfillTotal,
      messageCount: l.messageCount,
    });

    expect(listings.map(pick)).toEqual([
      {
        slug: 'alpha',
        state: 'connecting',
        disabled: false,
        heldNewCount: null,
        approvedNewCount: null,
        backfillDone: null,
        backfillTotal: null,
        messageCount: 0,
      },
      {
        slug: 'bravo',
        state: 'needs_attention',
        disabled: false,
        heldNewCount: 250,
        approvedNewCount: 250,
        backfillDone: null,
        backfillTotal: null,
        messageCount: 0,
      },
      {
        slug: 'charlie',
        state: 'ok',
        disabled: false,
        heldNewCount: null,
        approvedNewCount: null,
        backfillDone: 400,
        backfillTotal: 1250,
        messageCount: 3,
      },
      {
        slug: 'delta',
        state: 'ok',
        disabled: true,
        heldNewCount: null,
        approvedNewCount: null,
        backfillDone: null,
        backfillTotal: null,
        messageCount: 1,
      },
    ]);
  });
});
