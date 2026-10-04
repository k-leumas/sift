// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { run as configApply } from '../src/commands/config-apply.ts';

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
    expect(lines[0]).toMatch(/^SLUG\s+STATUS\s+LAST SEEN\s+LAST SYNC$/);
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
});
