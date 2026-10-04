// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@sift/core/config';
import { applyConfig } from '@sift/db/registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');
const EXAMPLE_CONFIG = path.join(REPO_ROOT, 'config/config.example.yaml');

let db: TestDatabase;
let dir: string;
let configPath: string;
const children: ChildProcess[] = [];

beforeAll(async () => {
  db = await freshDatabase();
  dir = await mkdtemp(path.join(tmpdir(), 'sift-worker-test-'));
  configPath = path.join(dir, 'config.yaml');
  await copyFile(EXAMPLE_CONFIG, configPath);
  const loaded = await loadConfig(configPath);
  if (!loaded.ok) throw new Error('config.example.yaml does not load');
  // The registry has to match the config, as `sift setup` would leave it.
  await applyConfig(db.ownerUrl, loaded.config);
});

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

interface Run {
  child: ChildProcess;
  output(): string;
  stdout(): string;
  exited: Promise<number | null>;
}

function startWorker(env: Record<string, string>): Run {
  const child = spawn(process.execPath, [CLI, 'worker'], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '';
  let combined = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
    combined += chunk;
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    combined += chunk;
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });
  return { child, output: () => combined, stdout: () => stdout, exited };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface StatusRow {
  slug: string;
  state: string | null;
  last_seen_at: Date | null;
  last_sync_at: Date | null;
}

/** Status rows read as the superuser, which bypasses RLS (test inspection only). */
async function statusRows(): Promise<StatusRow[]> {
  const admin = await connect(db.adminUrl);
  try {
    const { rows } = await admin.query<StatusRow>(
      `select m.slug, s.state, s.last_seen_at, s.last_sync_at
         from mailbox m left join mailbox_status s on s.mailbox_id = m.id
        order by m.slug`,
    );
    return rows;
  } finally {
    await admin.end();
  }
}

describe('sift worker (tracer)', () => {
  it('starts, records status, stops cleanly', async () => {
    const heartbeatFile = path.join(dir, 'heartbeat');
    const run = startWorker({
      SIFT_DATABASE_URL: db.appUrl,
      SIFT_CONFIG: configPath,
      SIFT_HEARTBEAT_FILE: heartbeatFile,
      SIFT_PERSONAL_IMAP_PASSWORD: 'pw-a',
      SIFT_JOBS_IMAP_PASSWORD: 'pw-b',
    });

    await waitFor(async () => {
      if (run.child.exitCode !== null) {
        throw new Error(`worker exited early (${run.child.exitCode}):\n${run.output()}`);
      }
      if (!existsSync(heartbeatFile)) return false;
      const rows = await statusRows();
      return (
        rows.length === 2 &&
        rows.every((r) => r.state === 'ok' && r.last_seen_at !== null && r.last_sync_at !== null)
      );
    }, 15_000);

    run.child.kill('SIGTERM');
    const code = await withTimeout(run.exited, 25_000, 'worker shutdown');
    expect(code).toBe(0);

    const lines = run
      .stdout()
      .split('\n')
      .filter((l) => l.trim() !== '');
    const records = lines.map((line) => JSON.parse(line) as { msg?: string });
    const messages = records.map((r) => r.msg);
    expect(messages).toContain('worker started');
    expect(messages).toContain('shutting down');
    expect(messages).toContain('stopped');
    expect(run.output()).not.toContain(db.appUrl);
    expect(run.output()).not.toContain('pw-a');
    expect(run.output()).not.toContain('pw-b');
  }, 45_000);

  it('missing env fails fast', async () => {
    const run = startWorker({
      SIFT_DATABASE_URL: 'postgres://sift_app:x@127.0.0.1:1/none',
      SIFT_CONFIG: configPath,
      SIFT_HEARTBEAT_FILE: path.join(dir, 'heartbeat-missing-env'),
      SIFT_PERSONAL_IMAP_PASSWORD: 'pw-a',
    });
    const code = await withTimeout(run.exited, 15_000, 'worker exit');
    expect(code).toBe(1);

    const output = run.output();
    const lines = output.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(output).toContain(
      'Missing env vars: SIFT_JOBS_IMAP_PASSWORD (mailbox \\"job-search\\")',
    );
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 50,
      msg: 'Missing env vars: SIFT_JOBS_IMAP_PASSWORD (mailbox "job-search")',
    });
    expect(output).not.toContain('ECONNREFUSED');
    expect(output).not.toContain('pw-a');
    expect(existsSync(path.join(dir, 'heartbeat-missing-env'))).toBe(false);
  });
});
