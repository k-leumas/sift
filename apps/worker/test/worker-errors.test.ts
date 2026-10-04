// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@sift/core/config';
import { applyConfig } from '@sift/db/registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { run } from '../src/commands/worker.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const EXAMPLE_CONFIG = path.join(REPO_ROOT, 'config/config.example.yaml');

let db: TestDatabase;
let dir: string;

beforeAll(async () => {
  db = await freshDatabase();
  dir = await mkdtemp(path.join(tmpdir(), 'sift-worker-errors-'));
  const loaded = await loadConfig(EXAMPLE_CONFIG);
  if (!loaded.ok) throw new Error('config.example.yaml does not load');
  await applyConfig(db.ownerUrl, loaded.config);
  // Break the drift check in this throwaway database only: sift_app can no
  // longer read the registry, so the worker hits an unexpected pg error (42501).
  const admin = await connect(db.adminUrl);
  try {
    await admin.query('revoke select on mailbox from sift_app');
  } finally {
    await admin.end();
  }
});

afterAll(async () => {
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('sift worker unexpected errors (IN-04)', () => {
  it('logs them through pino with redaction and exits 1, writing nothing to stderr', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run([], {
      cwd: REPO_ROOT,
      env: {
        SIFT_DATABASE_URL: db.appUrl,
        SIFT_CONFIG: EXAMPLE_CONFIG,
        SIFT_HEARTBEAT_FILE: path.join(dir, 'heartbeat'),
        // A mailbox password that also occurs in the pg error message, so the
        // test can see that the message went through redactText.
        SIFT_PERSONAL_IMAP_PASSWORD: 'mailbox',
        SIFT_JOBS_IMAP_PASSWORD: 'pw-b',
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(code).toBe(1);
    expect(stderr).toEqual([]);
    const errors = stdout
      .map((line) => JSON.parse(line) as { level: number; msg: string; code?: string })
      .filter((entry) => entry.level === 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('42501');
    expect(errors[0]?.msg).toMatch(/^worker failed: permission denied for table /);
    // The server message, not drizzle's "Failed query" text.
    expect(stdout.join('\n')).not.toContain('Failed query');
    expect(stdout.join('\n')).not.toContain('table mailbox');
    expect(stdout.join('\n')).not.toContain(new URL(db.appUrl).password);
  });
});
