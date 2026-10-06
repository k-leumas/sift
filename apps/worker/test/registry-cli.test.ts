// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes, seedScopedRows } from '../../../packages/db/test/support/seed.ts';
import { run as configApply } from '../src/commands/config-apply.ts';
import { run as mailboxList } from '../src/commands/mailbox-list.ts';
import { ownerSql } from './support/mailbox-harness.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');
const EXAMPLE_CONFIG = path.join(REPO_ROOT, 'config/config.example.yaml');

let db: TestDatabase;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db?.drop();
});

/**
 * Run the CLI with only the owner URL, the config path and PATH. No mailbox
 * password variables are set: config apply must not need them (D-67).
 */
function sift(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      SIFT_OWNER_DATABASE_URL: db.ownerUrl,
      SIFT_CONFIG: EXAMPLE_CONFIG,
      PATH: process.env.PATH ?? '',
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('sift config apply and sift mailbox list (tracer)', () => {
  it('adds every configured mailbox without mailbox secrets in the environment', () => {
    const { status, stdout, stderr } = sift('config', 'apply');
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('add mailbox "personal"');
    expect(stdout).toContain('add mailbox "job-search"');
    expect(stdout).toContain('Applied 2 changes.');
    expect(stdout).not.toContain(db.ownerUrl);
  });

  it('a second apply reports that the registry already matches', () => {
    const { status, stdout } = sift('config', 'apply');
    expect(status).toBe(0);
    expect(stdout).toContain('Mailbox registry already matches config.yaml.');
  });

  it('mailbox list shows both mailboxes as never run', () => {
    const { status, stdout, stderr } = sift('mailbox', 'list');
    expect(stderr).toBe('');
    expect(status).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^SLUG\s+STATUS\s+MESSAGES\s+LAST SEEN\s+LAST SYNC$/);
    expect(lines.find((l) => l.startsWith('personal '))).toMatch(/never run/);
    expect(lines.find((l) => l.startsWith('job-search '))).toMatch(/never run/);
  });
});

describe('sift config apply rename hint (WR-05)', () => {
  let renameDb: TestDatabase;
  let dir: string;

  beforeAll(async () => {
    renameDb = await freshDatabase();
    dir = await mkdtemp(path.join(tmpdir(), 'sift-rename-hint-'));
  });

  afterAll(async () => {
    await renameDb?.drop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  /** Config with one mailbox per [slug, IMAP username] entry, in that order. */
  async function configFile(name: string, entries: [string, string][]): Promise<string> {
    const mailboxes = entries.map(
      ([slug, username]) => `  - slug: ${slug}
    imap:
      host: protonmail-bridge
      port: 1143
      username: ${username}
      password_env: SIFT_TEST_IMAP_PASSWORD
    labels:
      apply_as: proton_labels
`,
    );
    const file = path.join(dir, name);
    await writeFile(
      file,
      `version: 1\nmailboxes:\n${mailboxes.join('')}models:\n  provider: ollama\n  embeddings: nomic-embed-text\n  llm: qwen3:1.7b\n`,
    );
    return file;
  }

  /** Run `sift config apply` in-process; returns the exit code and stderr. */
  async function apply(file: string): Promise<{ status: number; stderr: string }> {
    const lines: string[] = [];
    const status = await configApply([], {
      env: { SIFT_OWNER_DATABASE_URL: renameDb.ownerUrl, SIFT_CONFIG: file },
      cwd: dir,
      stdout: () => {},
      stderr: (line) => lines.push(line),
    });
    return { status, stderr: lines.join('\n') };
  }

  it('pairs two simultaneous renames by IMAP account, never by position', async () => {
    const start = await configFile('start.yaml', [
      ['alpha', 'a@proton.me'],
      ['beta', 'b@proton.me'],
    ]);
    expect((await apply(start)).status).toBe(0);

    // gamma is beta's account and comes first; zeta is alpha's account.
    const renamed = await configFile('renamed.yaml', [
      ['gamma', 'b@proton.me'],
      ['zeta', 'a@proton.me'],
    ]);
    const { status, stderr } = await apply(renamed);
    expect(status).toBe(1);
    expect(stderr).toContain('sift mailbox rename alpha zeta');
    expect(stderr).toContain('sift mailbox rename beta gamma');
    expect(stderr).not.toContain('sift mailbox rename alpha gamma');
    expect(stderr).not.toContain('sift mailbox rename beta zeta');
    expect(stderr).toContain('No changes applied.');
  });

  it('suggests no rename command when the accounts do not match one to one', async () => {
    const unrelated = await configFile('unrelated.yaml', [
      ['gamma', 'g@proton.me'],
      ['zeta', 'z@proton.me'],
    ]);
    const { status, stderr } = await apply(unrelated);
    expect(status).toBe(1);
    expect(stderr).not.toMatch(/sift mailbox rename (alpha|beta) /);
    expect(stderr).toContain('No longer in config.yaml: "alpha", "beta"');
    expect(stderr).toContain('New in config.yaml: "gamma", "zeta"');
    expect(stderr).toContain('suggests no rename');
  });

  it('warns when the lone removed and added slugs read different IMAP accounts (IN-09)', async () => {
    const other = await configFile('other-account.yaml', [
      ['beta', 'b@proton.me'],
      ['omega', 'o@proton.me'],
    ]);
    const { status, stderr } = await apply(other);
    expect(status).toBe(1);
    expect(stderr).toContain('sift mailbox rename alpha omega');
    expect(stderr).toContain('Their IMAP host, username or folder differ');

    const same = await configFile('same-account.yaml', [
      ['beta', 'b@proton.me'],
      ['omega', 'a@proton.me'],
    ]);
    const matching = await apply(same);
    expect(matching.stderr).toContain('sift mailbox rename alpha omega');
    expect(matching.stderr).not.toContain('Their IMAP host');
  });

  it('prints only the non-empty unpaired lists (IN-10)', async () => {
    // alpha pairs with zeta by account; gamma is new and unpaired; nothing
    // removed is left unpaired.
    const mixed = await configFile('mixed.yaml', [
      ['beta', 'b@proton.me'],
      ['zeta', 'a@proton.me'],
      ['gamma', 'g@proton.me'],
    ]);
    const { status, stderr } = await apply(mixed);
    expect(status).toBe(1);
    expect(stderr).toContain('sift mailbox rename alpha zeta');
    expect(stderr).toContain('New in config.yaml: "gamma"');
    expect(stderr).not.toContain('No longer in config.yaml:');
    expect(stderr).not.toMatch(/: $/m);
  });
});

describe('sift mailbox list states, backfill progress and message counts (02-16, D-75)', () => {
  let listDb: TestDatabase;

  beforeAll(async () => {
    listDb = await freshDatabase();
    const ids = await seedMailboxes(listDb.ownerUrl, [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot',
      'golf',
      'hotel',
    ]);
    const status = (slug: string, sql: string) =>
      ownerSql(listDb.ownerUrl, ids[slug] ?? '', sql, [ids[slug]]);
    await status(
      'alpha',
      "insert into mailbox_status (mailbox_id, state) values ($1, 'connecting')",
    );
    await status(
      'bravo',
      `insert into mailbox_status (mailbox_id, state, held_new_count)
       values ($1, 'needs_attention', 250)`,
    );
    await status(
      'charlie',
      `insert into mailbox_status (mailbox_id, state, held_new_count, approved_new_count)
       values ($1, 'needs_attention', 1250, 1250)`,
    );
    for (let i = 0; i < 2; i += 1) await seedScopedRows(listDb.ownerUrl, ids.delta ?? '');
    await status(
      'delta',
      'update mailbox_status set backfill_done = 400, backfill_total = 1250 where mailbox_id = $1',
    );
    await status(
      'echo',
      `insert into mailbox_status (mailbox_id, state, last_error)
       values ($1, 'error', 'IMAP server unreachable at bridge:1143')`,
    );
    await status('foxtrot', "insert into mailbox_status (mailbox_id, state) values ($1, 'ok')");
    await status('hotel', 'update mailbox set disabled_at = now() where id = $1');
  });

  afterAll(async () => {
    await listDb?.drop();
  });

  it('shows every state, the backfill progress and a MESSAGES column', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await mailboxList([], {
      env: { SIFT_OWNER_DATABASE_URL: listDb.ownerUrl },
      cwd: REPO_ROOT,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(stderr).toEqual([]);
    expect(code).toBe(0);
    expect(stdout[0]).toMatch(/^SLUG\s+STATUS\s+MESSAGES\s+LAST SEEN\s+LAST SYNC$/);
    const row = (slug: string) => {
      const line = stdout.find((l) => l.startsWith(`${slug} `));
      expect(line, slug).toBeDefined();
      // Columns are separated by at least two spaces; statuses use single spaces.
      return (line ?? '').split(/\s{2,}/);
    };
    expect(row('alpha').slice(0, 3)).toEqual(['alpha', 'connecting', '0']);
    expect(row('bravo').slice(0, 3)).toEqual([
      'bravo',
      'needs attention: 250 new messages held; run sift mailbox resume bravo',
      '0',
    ]);
    expect(row('charlie').slice(0, 3)).toEqual([
      'charlie',
      'needs attention: 1,250 new messages held; run sift mailbox resume charlie (resume approved)',
      '0',
    ]);
    expect(row('delta').slice(0, 3)).toEqual(['delta', 'ok, backfilling 400 of 1,250', '2']);
    expect(row('echo').slice(0, 3)).toEqual([
      'echo',
      'error: IMAP server unreachable at bridge:1143',
      '0',
    ]);
    expect(row('foxtrot').slice(0, 3)).toEqual(['foxtrot', 'ok', '0']);
    expect(row('golf').slice(0, 3)).toEqual(['golf', 'never run', '0']);
    expect(row('hotel')[1]).toMatch(/^disabled since \d{4}-\d{2}-\d{2}$/);
    expect(stdout.join('\n')).not.toContain(listDb.ownerUrl);
  });
});
