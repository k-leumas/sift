// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@sift/core/config';
import { applyConfig } from '@sift/db/registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');
const EXAMPLE_CONFIG = path.join(REPO_ROOT, 'config/config.example.yaml');

const SIDE_MAILBOX = `
  - slug: side
    display_name: Side
    imap:
      host: bridge.test
      port: 1143
      username: side@example.test
      password_env: SIFT_SIDE_IMAP_PASSWORD
      folder: INBOX
    labels:
      apply_as: proton_labels
`;

let db: TestDatabase;
let dir: string;
let driftedConfig: string;

beforeAll(async () => {
  db = await freshDatabase();
  const loaded = await loadConfig(EXAMPLE_CONFIG);
  if (!loaded.ok) throw new Error('config.example.yaml does not load');
  // The registry as setup left it: matching the example config.
  await applyConfig(db.ownerUrl, loaded.config);

  // Then the owner edits config.yaml without rerunning setup.
  dir = await mkdtemp(path.join(tmpdir(), 'sift-drift-test-'));
  driftedConfig = path.join(dir, 'config.yaml');
  const example = await readFile(EXAMPLE_CONFIG, 'utf8');
  const edited = example
    // The first port line belongs to "personal".
    .replace('port: 1143', 'port: 1144')
    .replace('\nmodels:', `${SIDE_MAILBOX}\nmodels:`);
  if (!edited.includes('port: 1144') || !edited.includes('slug: side')) {
    throw new Error('could not derive the drifted config from config.example.yaml');
  }
  await writeFile(driftedConfig, edited);
});

afterAll(async () => {
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

function runWorker(env: Record<string, string>): Promise<{ code: number | null; stdout: string }> {
  const child = spawn(process.execPath, [CLI, 'worker'], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`worker did not exit within 15 s:\n${stdout}`));
    }, 15_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

describe('worker drift check (D-34)', () => {
  it('refuses on drift', async () => {
    const { code, stdout } = await runWorker({
      SIFT_DATABASE_URL: db.appUrl,
      SIFT_CONFIG: driftedConfig,
      SIFT_HEARTBEAT_FILE: path.join(dir, 'heartbeat'),
      SIFT_PERSONAL_IMAP_PASSWORD: 'pw-a',
      SIFT_JOBS_IMAP_PASSWORD: 'pw-b',
      SIFT_SIDE_IMAP_PASSWORD: 'pw-c',
    });
    expect(code, stdout).toBe(1);

    const records = stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { msg?: string; differences?: string[] });
    const refusal = records.find((r) => Array.isArray(r.differences));
    expect(refusal, stdout).toBeDefined();
    expect(refusal?.differences).toContain('update mailbox "personal": imap_port 1143 -> 1144');
    expect(refusal?.differences).toContain('add mailbox "side"');
    expect(refusal?.msg).toContain('docker compose run --rm setup');
    expect(records.map((r) => r.msg)).not.toContain('worker started');
    expect(stdout).not.toContain(db.appUrl);

    const admin = await connect(db.adminUrl);
    try {
      const { rows } = await admin.query<{ n: number }>(
        'select count(*)::int as n from mailbox_status',
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await admin.end();
    }
  }, 30_000);
});
