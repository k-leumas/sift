// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@sift/core/config';
import { applyConfig } from '@sift/db/registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { BASIC_RULES, decisionsOf, writeRules } from './support/classify-harness.ts';
import { type FakeOllama, startFakeOllama } from './support/fake-ollama.ts';
import { E2E_PASSWORD_ENV, mailboxStatus } from './support/mailbox-harness.ts';
import {
  appendMessage,
  freshImapUser,
  requireTestImap,
  TEST_IMAP,
  testImapPin,
} from './support/test-imap.ts';

/**
 * The shipped `sift worker` command classifies mail on its own (03-09 Task
 * 3): the rules come from SIFT_DATA, the model from models.url, and the
 * shared single-flight gate is created by the command itself. No test hook
 * reaches into the process; the test only reads the database.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');
const SLUG = 'classify-e2e';
/** The schema's shortest poll interval, so the second message lands in the next batch. */
const POLL_SECONDS = 10;

let db: TestDatabase;
let dir: string;
let dataDir: string;
let fake: FakeOllama;
let user: string;
let mailboxId: string;
let configPath: string;
const children: ChildProcess[] = [];

/** A plain-text RFC 5322 message from `from`, with a unique Message-ID. */
function mailFrom(from: string, subject: string, body: string): string {
  return [
    `From: Sender <${from}>`,
    'To: Owner <owner@example.test>',
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@example.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
  ].join('\r\n');
}

beforeAll(async () => {
  await requireTestImap();
  db = await freshDatabase();
  fake = await startFakeOllama();
  dir = await mkdtemp(path.join(tmpdir(), 'sift-worker-classify-'));
  dataDir = path.join(dir, 'data');
  await writeRules(dataDir, SLUG, BASIC_RULES);
  user = freshImapUser(SLUG);
  const pin = await testImapPin();

  configPath = path.join(dir, 'config.yaml');
  await writeFile(
    configPath,
    `version: 1
mailboxes:
  - slug: ${SLUG}
    imap:
      host: ${TEST_IMAP.host}
      port: ${TEST_IMAP.port}
      username: ${user}
      password_env: ${E2E_PASSWORD_ENV}
      folder: INBOX
      tls:
        mode: starttls
        pin_sha256: ${pin}
    ingest:
      initial_backfill_days: 1
      new_mail_cap: 200
    labels:
      apply_as: proton_labels
models:
  provider: ollama
  url: ${fake.url}
  embeddings: nomic-embed-text
  llm: qwen3:1.7b
worker:
  poll_interval_seconds: ${POLL_SECONDS}
tiers:
  llm:
    confidence_threshold: 0.75
`,
  );
  const loaded = await loadConfig(configPath);
  if (!loaded.ok) throw new Error(`test config does not load: ${JSON.stringify(loaded.issues)}`);
  // The registry has to match the config, as `sift setup` would leave it.
  await applyConfig(db.ownerUrl, loaded.config);

  const admin = await connect(db.adminUrl);
  try {
    const { rows } = await admin.query<{ id: string }>('select id from mailbox where slug = $1', [
      SLUG,
    ]);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('mailbox not registered');
    mailboxId = id;
  } finally {
    await admin.end();
  }
});

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await fake?.close();
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

/** Poll `check` every 200 ms; fail after `timeoutMs` or when the worker exits early. */
async function waitFor(run: Run, check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (run.child.exitCode !== null) {
      throw new Error(`worker exited early (${run.child.exitCode}):\n${run.output()}`);
    }
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`condition not met within ${timeoutMs} ms:\n${run.output()}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe('sift worker classifies new mail (03-09)', () => {
  it('decides a backfilled message by an exact rule and a new one through Ollama, then stops cleanly', async () => {
    await appendMessage(
      user,
      'INBOX',
      mailFrom('alerts@bank.example.test', 'Card payment', 'A card payment.'),
    );
    const run = startWorker({
      SIFT_CONFIG: configPath,
      SIFT_DATA: dataDir,
      SIFT_DATABASE_URL: db.appUrl,
      SIFT_HEARTBEAT_FILE: path.join(dir, 'heartbeat'),
      [E2E_PASSWORD_ENV]: TEST_IMAP.password,
    });

    // Batch 1: the first backfill stores the bank message; the exact rule decides it.
    await waitFor(run, async () => (await decisionsOf(db.adminUrl, mailboxId)).length >= 1, 30_000);
    const [first] = await decisionsOf(db.adminUrl, mailboxId);
    expect(first).toMatchObject({
      tier: 'exact_rules',
      outcome: 'labelled',
      category: 'Important',
    });
    expect(fake.chatBodies()).toHaveLength(0);

    // A later batch: a new message goes to the fake Ollama.
    await appendMessage(
      user,
      'INBOX',
      mailFrom('news@letters.example.test', 'Weekly digest', 'This week.'),
    );
    await waitFor(run, async () => (await decisionsOf(db.adminUrl, mailboxId)).length >= 2, 30_000);
    const decisions = await decisionsOf(db.adminUrl, mailboxId);
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toMatchObject({ tier: 'llm', decidedBy: 'worker' });
    expect(fake.chatBodies()).toHaveLength(1);
    expect(JSON.stringify(fake.chatBodies())).toContain('Weekly digest');

    await waitFor(
      run,
      async () => (await mailboxStatus(db.adminUrl, mailboxId)).state === 'ok',
      10_000,
    );
    const status = await mailboxStatus(db.adminUrl, mailboxId);
    expect(status.last_error).toBeNull();
    expect(status.last_sync_at).not.toBeNull();

    run.child.kill('SIGTERM');
    const code = await withTimeout(run.exited, 25_000, 'worker shutdown');
    expect(code).toBe(0);

    const records = run
      .stdout()
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((line) => JSON.parse(line) as { msg?: string; dataDir?: string });
    const started = records.find((r) => r.msg === 'worker started');
    expect(started?.dataDir).toBe(dataDir);
    expect(run.output()).not.toContain(TEST_IMAP.password);
    expect(run.output()).not.toContain(db.appUrl);
  }, 90_000);
});
