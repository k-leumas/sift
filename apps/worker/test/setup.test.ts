// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connect,
  dropDatabase,
  lockAppRole,
  requireEnv,
  requireTestDb,
  roleUrl,
} from '../../../packages/db/test/support/db.ts';
import { run } from '../src/commands/setup.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');
const EXAMPLE_CONFIG = path.join(REPO_ROOT, 'config/config.example.yaml');
const TIMEOUT = 120_000;

interface EmptyDatabase {
  name: string;
  ownerUrl: string;
  backupUrl: string;
}

let db: EmptyDatabase;
let work: string;
let backupDir: string;
let releaseAppRole: (() => Promise<void>) | undefined;

beforeAll(async () => {
  // Setup runs migrate, which rotates the cluster-wide sift_app password; hold
  // the lock that packages/db/test/migrate.test.ts holds while it compares the
  // role's verifier.
  releaseAppRole = await lockAppRole();
  const { adminUrl, runId } = requireTestDb();
  // Unmigrated, owned by sift_owner; it inherits vector from template1.
  const name = `sift_test_${runId}_setup_${randomBytes(3).toString('hex')}`;
  const admin = await connect(adminUrl);
  try {
    await admin.query(`CREATE DATABASE "${name}" OWNER sift_owner`);
  } finally {
    await admin.end();
  }
  db = {
    name,
    ownerUrl: roleUrl(adminUrl, 'sift_owner', name),
    backupUrl: roleUrl(adminUrl, 'sift_backup', name),
  };
  work = await mkdtemp(path.join(tmpdir(), 'sift-setup-'));
  backupDir = path.join(work, 'backups');
}, 180_000);

afterAll(async () => {
  try {
    if (db !== undefined) await dropDatabase(requireTestDb().adminUrl, db.name);
    if (work !== undefined) await rm(work, { recursive: true, force: true });
  } finally {
    await releaseAppRole?.();
  }
});

/** Version-18 check for a host PostgreSQL client binary. */
function reportsVersion18(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return result.status === 0 && /\b18\.\d+/.test(result.stdout);
}

/**
 * pg_dump 18, resolved as in packages/db/test/migrate.test.ts: SIFT_PG_DUMP (a
 * path is relative to the repo root), else a host pg_dump 18. Missing: throws
 * under CI, otherwise skips the test with a reason.
 */
function requirePgDump(ctx: { skip(note?: string): void }): string | undefined {
  const configured = process.env.SIFT_PG_DUMP?.trim();
  let pgDump: string | undefined;
  if (configured) {
    pgDump = configured.includes('/') ? path.resolve(REPO_ROOT, configured) : configured;
  } else if (reportsVersion18('pg_dump')) {
    pgDump = 'pg_dump';
  }
  if (pgDump === undefined) {
    const reason = 'no pg_dump 18: set SIFT_PG_DUMP or install PostgreSQL 18 client tools';
    if (process.env.CI) throw new Error(reason);
    ctx.skip(reason);
  }
  return pgDump;
}

/** Exactly the setup container's variables; no mailbox password variables (D-67). */
function setupEnv(config: string, pgDump: string | undefined): Record<string, string> {
  const env: Record<string, string> = {
    SIFT_OWNER_DATABASE_URL: db.ownerUrl,
    SIFT_BACKUP_DATABASE_URL: db.backupUrl,
    SIFT_DB_APP_PASSWORD: requireEnv('SIFT_DB_APP_PASSWORD'),
    SIFT_CONFIG: config,
    SIFT_BACKUP_DIR: backupDir,
  };
  if (pgDump !== undefined) env.SIFT_PG_DUMP = pgDump;
  return env;
}

/** `sift setup` through the real CLI entry point (command table included). */
function setupCli(config: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, 'setup', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...setupEnv(config, undefined), PATH: process.env.PATH ?? '' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * `sift setup` in-process with captured output. Spawning a Node process per
 * step is slow under a parallel test run; the CLI path is covered by setupCli.
 */
async function setup(config: string, pgDump: string | undefined, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const status = await run(args, {
    env: setupEnv(config, pgDump),
    cwd: REPO_ROOT,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  const text = (lines: string[]) => lines.map((l) => `${l}\n`).join('');
  return { status, stdout: text(out), stderr: text(err) };
}

async function ownerQuery<T>(sql: string): Promise<T | undefined> {
  const client = await connect(db.ownerUrl);
  try {
    const { rows } = await client.query(sql);
    return rows[0] as T | undefined;
  } finally {
    await client.end();
  }
}

async function writeConfig(name: string, text: string): Promise<string> {
  const file = path.join(work, name);
  await writeFile(file, text);
  return file;
}

describe('sift setup (D-27, D-28, D-33)', () => {
  it(
    'stops on a broken config before migrating anything',
    async () => {
      const broken = await writeConfig(
        'broken.yaml',
        'version: 1\nmailboxes:\n  - slug: Not A Slug\n',
      );
      const { status, stdout, stderr } = setupCli(broken);
      expect(status).toBe(1);
      expect(stderr).toContain('Nothing was changed');
      expect(stdout).toBe('');

      const row = await ownerQuery<{ t: string | null }>(
        "select to_regclass('drizzle.__drizzle_migrations')::text as t",
      );
      expect(row?.t).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'migrates with a backup and registers the configured mailboxes',
    async (ctx) => {
      const pgDump = requirePgDump(ctx);
      if (pgDump === undefined) return;
      const { status, stdout, stderr } = await setup(EXAMPLE_CONFIG, pgDump);
      expect(stderr).toBe('');
      expect(status).toBe(0);
      expect(stdout).toContain('Applied 5 migrations');
      expect(stdout).toContain('add mailbox "personal"');
      expect(stdout).toContain('add mailbox "job-search"');
      expect(stdout).not.toContain(db.ownerUrl);

      const migrations = await ownerQuery<{ n: number }>(
        'select count(*)::int as n from drizzle.__drizzle_migrations',
      );
      expect(migrations?.n).toBe(5);
      const mailboxes = await ownerQuery<{ slugs: string }>(
        "select string_agg(slug, ',' order by slug) as slugs from mailbox",
      );
      expect(mailboxes?.slugs).toBe('job-search,personal');

      const files = await readdir(backupDir);
      expect(files).toHaveLength(1);
      const dump = await readFile(path.join(backupDir, files[0] ?? ''));
      expect(dump.subarray(0, 5).toString('latin1')).toBe('PGDMP');
    },
    TIMEOUT,
  );

  it(
    'is a no-op on a rerun',
    async (ctx) => {
      const pgDump = requirePgDump(ctx);
      if (pgDump === undefined) return;
      const { status, stdout, stderr } = await setup(EXAMPLE_CONFIG, pgDump);
      expect(stderr).toBe('');
      expect(status).toBe(0);
      expect(stdout).toContain('No pending migrations.');
      expect(stdout).toContain('Mailbox registry already matches config.yaml.');
    },
    TIMEOUT,
  );

  it(
    'refuses a possible rename without --confirm and applies it with --confirm',
    async (ctx) => {
      const pgDump = requirePgDump(ctx);
      if (pgDump === undefined) return;
      const example = await readFile(EXAMPLE_CONFIG, 'utf8');
      const renamed = example.replace('slug: personal', 'slug: home');
      expect(renamed).not.toBe(example);
      const config = await writeConfig('renamed.yaml', renamed);

      const refused = await setup(config, pgDump);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('sift mailbox rename personal home');
      expect(refused.stderr).toContain('No changes applied.');

      const confirmed = await setup(config, pgDump, '--confirm');
      expect(confirmed.stderr).toBe('');
      expect(confirmed.status).toBe(0);
      expect(confirmed.stdout).toContain('add mailbox "home"');
    },
    TIMEOUT,
  );
});
