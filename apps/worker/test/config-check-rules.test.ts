import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandIO } from '../src/command.ts';
import { run } from '../src/commands/config-check.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const EXAMPLE_RULES = path.join(REPO_ROOT, 'data/mailboxes/example/rules.example.yaml');

const CONFIG = `version: 1
mailboxes:
  - slug: alpha
    imap:
      host: protonmail-bridge
      port: 1143
      username: alpha-user@proton.me
      password_env: SIFT_ALPHA_IMAP_PASSWORD
    labels:
      apply_as: proton_labels
  - slug: beta
    imap:
      host: protonmail-bridge
      port: 1143
      username: beta-user@proton.me
      password_env: SIFT_BETA_IMAP_PASSWORD
    labels:
      apply_as: proton_labels
models:
  provider: ollama
  embeddings: nomic-embed-text
  llm: qwen3:1.7b
`;

/** Two problems: a label that is not a category, and `in` without a phrase. */
const TWO_PROBLEMS = `version: 1
categories:
  - name: Important
    description: things I need to act on
  - name: Noise
    description: promotions
rules:
  - kind: exact
    name: bank alerts
    match:
      domain: [bank.example.test]
    label: Receipts
  - kind: exact
    name: shop mail
    match:
      from: [shop@example.test]
      in: body
    label: Noise
`;

/**
 * Valid except for a NUL (YAML escape \0) in the first category description:
 * PostgreSQL jsonb cannot hold it, so the worker could not store the rule set (WR-02).
 */
const NUL_DESCRIPTION = TWO_PROBLEMS.replace('label: Receipts', 'label: Important')
  .replace('      in: body\n', '')
  .replace('description: things I need to act on', 'description: "things I need\\0 to act on"');

/** Built at runtime so this file holds no backslash-u sequence (Write/Edit tools and biome decode them). */
const BACKSLASH = String.fromCharCode(92);

/**
 * Valid except for a YAML escape for a lone high surrogate (U+D800) in the first
 * category description: PostgreSQL jsonb cannot hold an unpaired surrogate, so
 * the worker could not store the rule set (WR-05).
 */
const LONE_SURROGATE_DESCRIPTION = NUL_DESCRIPTION.replace(
  `"things I need${BACKSLASH}0 to act on"`,
  `"things I need${BACKSLASH}uD800 to act on"`,
);

const UNPAIRED_SURROGATE_MESSAGE =
  'description must not contain an unpaired surrogate (U+D800 to U+DFFF); ' +
  'write the character itself, not its escape';

const PASSWORDS = { SIFT_ALPHA_IMAP_PASSWORD: 'a', SIFT_BETA_IMAP_PASSWORD: 'b' };

let work: string;
let n = 0;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'sift-config-check-rules-'));
  await writeFile(path.join(work, 'config.yaml'), CONFIG);
});

afterAll(async () => {
  if (work !== undefined) await rm(work, { recursive: true, force: true });
});

/** A fresh data directory under the work dir, relative to it as `data-<n>`. */
async function dataDir(files: Record<string, string | 'example'>): Promise<string> {
  n += 1;
  const dir = path.join(work, `data-${n}`);
  await mkdir(path.join(dir, 'mailboxes'), { recursive: true });
  for (const [slug, content] of Object.entries(files)) {
    const target = path.join(dir, 'mailboxes', slug, 'rules.yaml');
    await mkdir(path.dirname(target), { recursive: true });
    if (content === 'example') await copyFile(EXAMPLE_RULES, target);
    else await writeFile(target, content);
  }
  return dir;
}

async function check(env: Record<string, string>, ...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CommandIO = {
    env: { SIFT_CONFIG: path.join(work, 'config.yaml'), ...env },
    cwd: work,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  };
  const status = await run(args, io);
  return { status, stdout, stderr };
}

/** 1-based line of the first line containing `needle`. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`not found: ${needle}`);
  return index + 1;
}

describe('sift config check reads every mailbox rules file (D-05)', () => {
  it('exits 0 with the rules note when both rules files are valid', async () => {
    const data = await dataDir({ alpha: 'example', beta: 'example' });
    const { status, stdout, stderr } = await check({ ...PASSWORDS, SIFT_DATA: data });
    expect(stderr).toEqual([]);
    expect(status).toBe(0);
    expect(stdout).toEqual([
      'Config OK: 2 mailboxes (alpha, beta); password env vars present; rules files valid',
    ]);
  });

  it('exits 1 for a missing file, naming the file and the example to copy', async () => {
    const data = await dataDir({ alpha: 'example' });
    const { status, stdout, stderr } = await check({ ...PASSWORDS, SIFT_DATA: data });
    expect(status).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    const missing = path.join(data, 'mailboxes', 'beta', 'rules.yaml');
    expect(stderr[0]).toBe(
      `${path.relative(work, missing)} (root): rules file not found: ${missing}. ` +
        'Copy data/mailboxes/example/rules.example.yaml to that path and edit it',
    );
  });

  it('prints every problem in a file with file:line:col and its YAML path', async () => {
    const data = await dataDir({ alpha: TWO_PROBLEMS, beta: 'example' });
    const { status, stdout, stderr } = await check({ ...PASSWORDS, SIFT_DATA: data });
    expect(status).toBe(1);
    expect(stdout).toEqual([]);
    const source = path.relative(work, path.join(data, 'mailboxes', 'alpha', 'rules.yaml'));
    expect(stderr).toHaveLength(2);
    expect(stderr[0]).toMatch(
      new RegExp(
        `^${source}:${lineOf(TWO_PROBLEMS, 'label: Receipts')}:\\d+ rules\\[0\\]\\.label: `,
      ),
    );
    expect(stderr[1]).toMatch(
      new RegExp(`^${source}:${lineOf(TWO_PROBLEMS, 'in: body')}:\\d+ rules\\[1\\]\\.match\\.in: `),
    );
  });

  it('exits 1 for a NUL in a description, naming file, position and YAML path (WR-02)', async () => {
    const data = await dataDir({ alpha: NUL_DESCRIPTION, beta: 'example' });
    const { status, stdout, stderr } = await check({ ...PASSWORDS, SIFT_DATA: data });
    expect(status).toBe(1);
    expect(stdout).toEqual([]);
    const source = path.relative(work, path.join(data, 'mailboxes', 'alpha', 'rules.yaml'));
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(
      new RegExp(
        `^${source}:${lineOf(NUL_DESCRIPTION, 'things I need')}:\\d+ ` +
          'categories\\[0\\]\\.description: description must not contain control characters$',
      ),
    );
  });

  it('exits 1 for an unpaired surrogate in a description, naming file, position and YAML path (WR-05)', async () => {
    expect(LONE_SURROGATE_DESCRIPTION).toContain(`${BACKSLASH}uD800`);
    const data = await dataDir({ alpha: LONE_SURROGATE_DESCRIPTION, beta: 'example' });
    const { status, stdout, stderr } = await check({ ...PASSWORDS, SIFT_DATA: data });
    expect(stdout).toEqual([]);
    expect(status).toBe(1);
    const source = path.relative(work, path.join(data, 'mailboxes', 'alpha', 'rules.yaml'));
    expect(stderr).toHaveLength(1);
    const line = stderr[0] ?? '';
    expect(line).toMatch(
      new RegExp(
        `^${source}:${lineOf(LONE_SURROGATE_DESCRIPTION, 'things I need')}:\\d+ ` +
          'categories\\[0\\]\\.description: ',
      ),
    );
    expect(line.endsWith(`categories[0].description: ${UNPAIRED_SURROGATE_MESSAGE}`)).toBe(true);
  });

  it('checks every mailbox before exiting, so problems in two files are all printed', async () => {
    const data = await dataDir({ alpha: TWO_PROBLEMS });
    const { status, stderr } = await check({ ...PASSWORDS, SIFT_DATA: data });
    expect(status).toBe(1);
    expect(stderr).toHaveLength(3);
    expect(stderr[2]).toContain('rules file not found');
    expect(stderr[2]).toContain(path.join('mailboxes', 'beta', 'rules.yaml'));
  });

  it('does not read rules files when the password check fails', async () => {
    const { status, stderr } = await check({
      SIFT_ALPHA_IMAP_PASSWORD: 'a',
      SIFT_DATA: path.join(work, 'no-such-data'),
    });
    expect(status).toBe(1);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/^Missing env vars: SIFT_BETA_IMAP_PASSWORD/);
  });

  it('--schema-only reads no rules files and keeps its line (no data directory at all)', async () => {
    const { status, stdout, stderr } = await check(
      { SIFT_DATA: path.join(work, 'no-such-data') },
      '--schema-only',
    );
    expect(stderr).toEqual([]);
    expect(status).toBe(0);
    expect(stdout).toEqual([
      'Config OK: 2 mailboxes (alpha, beta); env vars not checked (--schema-only)',
    ]);
  });
});
