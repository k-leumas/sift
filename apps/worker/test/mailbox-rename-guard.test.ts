// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import type { CommandIO } from '../src/command.ts';
import { run } from '../src/commands/mailbox-rename.ts';

/** Nothing listens on port 1: any database call shows up as a connection error. */
const CLOSED_PORT_URL = 'postgres://sift_owner:not-a-password@127.0.0.1:1/sift';

let work: string;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'sift-rename-guard-'));
});

afterAll(async () => {
  if (work !== undefined) await rm(work, { recursive: true, force: true });
});

async function rename(env: Record<string, string>, ...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CommandIO = {
    env,
    cwd: work,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  };
  const status = await run(args, io);
  return { status, stdout, stderr };
}

/** Recursive listing of a directory, so a test can show nothing was created or moved. */
async function tree(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map(String).sort();
}

describe('sift mailbox rename refuses until the new rules file exists (D-07)', () => {
  it('refuses before any database call, naming the missing file and the folder to move', async () => {
    const data = path.join(work, 'data-missing');
    await mkdir(path.join(data, 'mailboxes', 'alpha'), { recursive: true });
    await writeFile(path.join(data, 'mailboxes', 'alpha', 'rules.yaml'), 'version: 1\n');
    const before = await tree(data);

    const { status, stdout, stderr } = await rename(
      { SIFT_OWNER_DATABASE_URL: CLOSED_PORT_URL, SIFT_DATA: data },
      'alpha',
      'beta',
    );

    expect(status).toBe(1);
    expect(stdout).toEqual([]);
    const missing = path.join(data, 'mailboxes', 'beta', 'rules.yaml');
    expect(stderr).toEqual([
      `sift mailbox rename: ${missing} does not exist. Move the mailbox's rules folder first ` +
        '(data/mailboxes/alpha to data/mailboxes/beta); Sift never moves your files. ' +
        'Then run this again.',
    ]);
    expect(stderr.join('\n')).not.toMatch(/ECONNREFUSED|connect/i);
    // Sift only checked: nothing under data/ was created, moved or changed.
    expect(await tree(data)).toEqual(before);
    expect(existsSync(missing)).toBe(false);
  });

  it('reports an invalid new slug with the rename message, not a path error', async () => {
    const { status, stderr } = await rename(
      { SIFT_OWNER_DATABASE_URL: CLOSED_PORT_URL, SIFT_DATA: path.join(work, 'no-data') },
      'alpha',
      'Beta!',
    );
    expect(status).toBe(1);
    expect(stderr).toEqual(['sift mailbox rename: slugs must be lowercase ("Beta!")']);
  });
});

describe('sift mailbox rename once the new rules file exists', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('renames as before: same id, new slug, the existing success line', async () => {
    const ids = await seedMailboxes(db.ownerUrl, ['alpha']);
    const data = path.join(work, 'data-moved');
    await mkdir(path.join(data, 'mailboxes', 'beta'), { recursive: true });
    await writeFile(path.join(data, 'mailboxes', 'beta', 'rules.yaml'), 'version: 1\n');

    const { status, stdout, stderr } = await rename(
      { SIFT_OWNER_DATABASE_URL: db.ownerUrl, SIFT_DATA: data },
      'alpha',
      'beta',
    );

    expect(stderr).toEqual([]);
    expect(status).toBe(0);
    expect(stdout).toEqual([
      'Renamed mailbox "alpha" to "beta". Make sure config/config.yaml uses "beta", ' +
        'then run setup again: docker compose run --rm setup',
    ]);
    const owner = await connect(db.ownerUrl);
    try {
      const { rows } = await owner.query<{ id: string; slug: string }>(
        'select id, slug from mailbox',
      );
      expect(rows).toEqual([{ id: ids.alpha, slug: 'beta' }]);
    } finally {
      await owner.end();
    }
  });
});
