// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';

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
