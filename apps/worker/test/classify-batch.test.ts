// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailboxConfig } from '@sift/core/config';
import { type AppDb, createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedImapMailbox } from '../../../packages/db/test/support/seed.ts';
import type { ClassifyRuntime } from '../src/classify/run.ts';
import {
  ClassifyInfraError,
  createMailboxCallbacks,
  type MailboxIngestOptions,
} from '../src/runtime/mailbox-batch.ts';
import type { MailboxEntry } from '../src/runtime/supervisor.ts';
import {
  BASIC_RULES,
  decisionsOf,
  expectReplayableDecision,
  pendingIdsOf,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import { type FakeOllama, okAnswer, startFakeOllama } from './support/fake-ollama.ts';
import {
  E2E_PASSWORD_ENV,
  imapMailbox,
  mailboxCounts,
  mailboxStatus,
  ownerSql,
  recordingLog,
  type StatusRow,
  siftConfig,
} from './support/mailbox-harness.ts';
import {
  appendMessage,
  freshImapUser,
  requireTestImap,
  TEST_IMAP,
  testImapPin,
} from './support/test-imap.ts';

/**
 * Classification in the worker's batch (03-09; D-05, D-14, D-16, D-19):
 * runBatch ingests from the Dovecot test server, then classifies the new mail
 * through the fake Ollama and writes the mailbox status once. Status and
 * decision rows come from the real database, read as the superuser.
 */

const PASSWORD = TEST_IMAP.password;
const ENV = { [E2E_PASSWORD_ENV]: PASSWORD };
const noSleep = async (): Promise<void> => {};

let db: TestDatabase;
let appDb: AppDb;
let pin: string;
let dataDir: string;

beforeAll(async () => {
  await requireTestImap();
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  pin = await testImapPin();
  dataDir = await mkdtemp(join(tmpdir(), 'sift-classify-batch-'));
});

afterAll(async () => {
  await appDb?.close();
  await db?.drop();
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
});

interface Mailbox {
  id: string;
  slug: string;
  user: string;
  entry: MailboxEntry;
  config: MailboxConfig;
  rulesPath: string | null;
}

let counter = 0;

/** A mailbox on a fresh Dovecot user, registered in the database, with BASIC_RULES unless told otherwise. */
async function newMailbox(
  prefix: string,
  options: { rules?: string | null; newMailCap?: number } = {},
): Promise<Mailbox> {
  counter += 1;
  const slug = `${prefix}-${counter}`;
  const user = freshImapUser(slug);
  const id = await seedImapMailbox(db.ownerUrl, {
    slug,
    host: TEST_IMAP.host,
    port: TEST_IMAP.port,
    username: user,
    passwordEnv: E2E_PASSWORD_ENV,
  });
  const config = imapMailbox(slug, user, {
    pin,
    ...(options.newMailCap === undefined ? {} : { newMailCap: options.newMailCap }),
  });
  const rules = options.rules === undefined ? BASIC_RULES : options.rules;
  const rulesPath = rules === null ? null : await writeRules(dataDir, slug, rules);
  return { id, slug, user, entry: { id, slug, disabledAt: null }, config, rulesPath };
}

function callbacksFor(
  mailboxes: Mailbox[],
  fake: FakeOllama,
  extra: Partial<MailboxIngestOptions> & { classify?: ClassifyRuntime } = {},
) {
  const log = recordingLog();
  const base = siftConfig(...mailboxes.map((m) => m.config));
  const callbacks = createMailboxCallbacks(appDb, [PASSWORD], {
    config: { ...base, models: { ...base.models, url: fake.url } },
    env: ENV,
    log,
    sleep: noSleep,
    classify: testRuntime(fake, dataDir),
    ...extra,
  });
  return { callbacks, log };
}

type Callbacks = ReturnType<typeof createMailboxCallbacks>;

/** runBatch, then onBatchError on failure, as the supervisor does. Returns the error. */
async function cycle(
  callbacks: Callbacks,
  m: Mailbox,
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  await callbacks.readRegistry();
  try {
    await callbacks.runBatch(m.entry, signal);
    return undefined;
  } catch (error) {
    await callbacks.onBatchError(m.entry, error);
    return error;
  }
}

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

const BANK = 'alerts@bank.example.test';
const NEWS = 'news@letters.example.test';

function chatCount(fake: FakeOllama): number {
  return fake.requests().filter((r) => r.path === '/api/chat').length;
}

describe('classification after ingest (D-14)', () => {
  it('ingests new mail and classifies it in the same batch, then records ok', async () => {
    const fake = await startFakeOllama();
    try {
      const m = await newMailbox('tracer');
      const { callbacks } = callbacksFor([m], fake);

      // Run 1: the first sync records the folder state; nothing is pending, so no request.
      expect(await cycle(callbacks, m)).toBeUndefined();
      expect(fake.requests()).toHaveLength(0);
      expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('ok');

      // Run 2: one message for the exact rule, one for the LLM.
      await appendMessage(m.user, 'INBOX', mailFrom(BANK, 'Card payment', 'A card payment.'));
      await appendMessage(m.user, 'INBOX', mailFrom(NEWS, 'Weekly digest', 'This week.'));
      expect(await cycle(callbacks, m)).toBeUndefined();

      expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(2);
      expect(await pendingIdsOf(db.adminUrl, m.id)).toEqual([]);
      const decisions = await decisionsOf(db.adminUrl, m.id);
      expect(decisions.map((d) => d.tier).sort()).toEqual(['exact_rules', 'llm']);
      const exact = decisions.find((d) => d.tier === 'exact_rules');
      expect(exact).toMatchObject({ outcome: 'labelled', category: 'Important' });

      // The bank message never reached the model.
      expect(chatCount(fake)).toBe(1);
      const sent = JSON.stringify(fake.chatBodies());
      expect(sent).toContain('Weekly digest');
      expect(sent).not.toContain('Card payment');

      for (const decision of decisions) {
        await expectReplayableDecision(db.adminUrl, decision, fake);
      }

      const status = await mailboxStatus(db.adminUrl, m.id);
      expect(status.state).toBe('ok');
      expect(status.last_error).toBeNull();
      expect(status.last_sync_at).not.toBeNull();
    } finally {
      await fake.close();
    }
  }, 30_000);
});

/** Wait until `check` holds, polling every 25 ms; fail after `timeoutMs`. */
async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** runBatch's rejection, or undefined when it resolved. */
async function batchError(callbacks: Callbacks, m: Mailbox): Promise<unknown> {
  await callbacks.readRegistry();
  return callbacks.runBatch(m.entry, new AbortController().signal).then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** Neither last_error nor any log line carries one of `secrets` (mail text, Ollama's text). */
function expectNoLeak(
  secrets: readonly string[],
  log: ReturnType<typeof recordingLog>,
  statuses: readonly StatusRow[],
): void {
  const haystack = [
    ...statuses.map((s) => s.last_error ?? ''),
    ...log.lines.map((l) => `${JSON.stringify(l.obj)} ${l.msg ?? ''}`),
  ].join('\n');
  for (const secret of secrets) expect(haystack).not.toContain(secret);
}

/** BASIC_RULES with a category name the schema refuses (a slash), at categories[1]. */
const BAD_RULES = BASIC_RULES.replace('  - name: Receipts', '  - name: Re/ceipts');

describe('rules file problems stay in their mailbox (D-05)', () => {
  it('resolves the batch, names the rules file in status and classifies the other mailbox', async () => {
    const fake = await startFakeOllama();
    try {
      const a = await newMailbox('rules-bad', { rules: BAD_RULES });
      const b = await newMailbox('rules-good');
      const { callbacks, log } = callbacksFor([a, b], fake);
      expect(await cycle(callbacks, a)).toBeUndefined();
      expect(await cycle(callbacks, b)).toBeUndefined();

      await appendMessage(a.user, 'INBOX', mailFrom(NEWS, 'Subject-A-k3v9', 'Body-A-k3v9'));
      await appendMessage(b.user, 'INBOX', mailFrom(NEWS, 'Subject-B-p2m4', 'Body-B-p2m4'));
      const before = Date.now();
      expect(await batchError(callbacks, a)).toBeUndefined();

      expect((await mailboxCounts(db.adminUrl, a.id)).messages).toBe(1);
      expect(await decisionsOf(db.adminUrl, a.id)).toEqual([]);
      const statusA = await mailboxStatus(db.adminUrl, a.id);
      expect(statusA.state).toBe('error');
      expect(statusA.last_error).toContain(`rules file ${a.rulesPath}`);
      expect(statusA.last_error).toContain('categories[1].name');
      expect(statusA.last_error).toContain('sift config check');
      expect(statusA.last_sync_at?.getTime()).toBeGreaterThanOrEqual(before);
      expect(log.lines).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          obj: { mailbox: a.slug },
          msg: 'mail not classified: the rules file has problems (see sift mailbox list)',
        }),
      );

      expect(await batchError(callbacks, b)).toBeUndefined();
      const decisionsB = await decisionsOf(db.adminUrl, b.id);
      expect(decisionsB).toHaveLength(1);
      for (const decision of decisionsB) {
        await expectReplayableDecision(db.adminUrl, decision, fake);
      }
      const statusB = await mailboxStatus(db.adminUrl, b.id);
      expect(statusB.state).toBe('ok');
      expect(statusB.last_error).toBeNull();
      expect(chatCount(fake)).toBe(1);

      // The file is gone: the not-found message, still without rejecting.
      await rm(a.rulesPath as string);
      expect(await batchError(callbacks, a)).toBeUndefined();
      const gone = await mailboxStatus(db.adminUrl, a.id);
      expect(gone.state).toBe('error');
      expect(gone.last_error).toContain(`rules file not found: ${a.rulesPath}`);
      expect((await mailboxStatus(db.adminUrl, b.id)).state).toBe('ok');

      expectNoLeak(['Subject-A-k3v9', 'Body-A-k3v9', 'Subject-B-p2m4', 'Body-B-p2m4'], log, [
        statusA,
        gone,
        statusB,
      ]);
    } finally {
      await fake.close();
    }
  }, 30_000);
});

describe('Ollama outages (D-16, E5)', () => {
  it('rejects the batch, shows the owner message (never connecting) and recovers by itself', async () => {
    let fake = await startFakeOllama();
    const { port } = new URL(fake.url);
    const origin = new URL(fake.url).origin;
    try {
      const m = await newMailbox('outage');
      // Default startup grace: the worker started just now, so an IMAP error would be connecting.
      const { callbacks, log } = callbacksFor([m], fake);
      expect(await cycle(callbacks, m)).toBeUndefined();

      await fake.close(); // Ollama stopped
      await appendMessage(m.user, 'INBOX', mailFrom(BANK, 'Subject-bank-r7', 'Body-bank-r7'));
      await appendMessage(m.user, 'INBOX', mailFrom(NEWS, 'Subject-news-r7', 'Body-news-r7'));
      const error = await batchError(callbacks, m);
      expect(error).toBeInstanceOf(ClassifyInfraError);
      if (!(error instanceof ClassifyInfraError)) return;
      expect(error.code).toBe('unreachable');
      await callbacks.onBatchError(m.entry, error);

      const down = await mailboxStatus(db.adminUrl, m.id);
      expect(down.state).toBe('error');
      expect(down.last_error).toBe(`Ollama unreachable at ${origin} (ECONNREFUSED)`);
      expect(down.last_sync_at?.getTime()).toBe(error.syncedAt.getTime());
      const decided = await decisionsOf(db.adminUrl, m.id);
      expect(decided.map((d) => d.tier)).toEqual(['exact_rules']);
      expect(await pendingIdsOf(db.adminUrl, m.id)).toHaveLength(1);

      fake = await startFakeOllama({ port: Number(port) }); // Ollama back
      expect(await cycle(callbacks, m)).toBeUndefined();
      const up = await mailboxStatus(db.adminUrl, m.id);
      expect(up.state).toBe('ok');
      expect(up.last_error).toBeNull();
      expect(await pendingIdsOf(db.adminUrl, m.id)).toEqual([]);
      const decisions = await decisionsOf(db.adminUrl, m.id);
      expect(decisions.map((d) => d.tier)).toEqual(['exact_rules', 'llm']);
      for (const decision of decisions) {
        if (decision.tier === 'llm') await expectReplayableDecision(db.adminUrl, decision, fake);
      }

      expectNoLeak(['Subject-bank-r7', 'Body-bank-r7', 'Subject-news-r7', 'Body-news-r7'], log, [
        down,
        up,
      ]);
    } finally {
      await fake.close();
    }
  }, 30_000);

  it('names ollama pull when the model is missing', async () => {
    const fake = await startFakeOllama({ tags: { status: 200, json: { models: [] } } });
    try {
      const m = await newMailbox('no-model');
      const { callbacks } = callbacksFor([m], fake);
      expect(await cycle(callbacks, m)).toBeUndefined();
      await appendMessage(m.user, 'INBOX', mailFrom(NEWS, 'Weekly digest', 'This week.'));
      const error = await cycle(callbacks, m);
      expect(error).toBeInstanceOf(ClassifyInfraError);
      expect((error as ClassifyInfraError).code).toBe('model_missing');
      const status = await mailboxStatus(db.adminUrl, m.id);
      expect(status.state).toBe('error');
      expect(status.last_error).toContain('ollama pull qwen3:1.7b');
      expect(await pendingIdsOf(db.adminUrl, m.id)).toHaveLength(1);
    } finally {
      await fake.close();
    }
  }, 30_000);

  it("stores a fixed message for an Ollama 500, never Ollama's error text", async () => {
    const sentinel = 'SENTINEL-ollama-error-q8w2';
    const fake = await startFakeOllama({
      chat: () => ({ status: 500, json: { error: `${sentinel}: Subject-500-z1` } }),
    });
    try {
      const m = await newMailbox('server-error');
      const { callbacks, log } = callbacksFor([m], fake);
      expect(await cycle(callbacks, m)).toBeUndefined();
      await appendMessage(m.user, 'INBOX', mailFrom(NEWS, 'Subject-500-z1', 'Body-500-z1'));
      const error = await cycle(callbacks, m);
      expect(error).toBeInstanceOf(ClassifyInfraError);
      expect((error as Error).message).not.toContain(sentinel);
      const status = await mailboxStatus(db.adminUrl, m.id);
      expect(status.state).toBe('error');
      expect(status.last_error).toBe(
        `Ollama at ${new URL(fake.url).origin} failed (HTTP 500); see the Ollama log`,
      );
      expectNoLeak([sentinel, 'Subject-500-z1', 'Body-500-z1'], log, [status]);
    } finally {
      await fake.close();
    }
  }, 30_000);
});

describe('volume hold (D-26)', () => {
  it('does not classify a held mailbox, keeps needs_attention and classifies after resume', async () => {
    const fake = await startFakeOllama();
    try {
      const m = await newMailbox('held', { newMailCap: 1 });
      const { callbacks } = callbacksFor([m], fake);
      expect(await cycle(callbacks, m)).toBeUndefined();
      for (const n of [1, 2, 3]) {
        await appendMessage(m.user, 'INBOX', mailFrom(NEWS, `held ${n}`, `held body ${n}`));
      }
      expect(await cycle(callbacks, m)).toBeUndefined();
      expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('needs_attention');
      // Held with no approval: still held, still nothing sent to Ollama.
      expect(await cycle(callbacks, m)).toBeUndefined();
      expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('needs_attention');
      expect(fake.requests()).toHaveLength(0);

      // What sift mailbox resume does; the next batch stores and classifies the mail.
      await ownerSql(
        db.ownerUrl,
        m.id,
        'update mailbox_status set approved_new_count = held_new_count where mailbox_id = $1',
        [m.id],
      );
      expect(await cycle(callbacks, m)).toBeUndefined();
      expect(await decisionsOf(db.adminUrl, m.id)).toHaveLength(3);
      expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('ok');
    } finally {
      await fake.close();
    }
  }, 30_000);

  it('spends the resume approval with the ingest when the pass throws, so the next batch uses the cap (CR-03)', async () => {
    const fake = await startFakeOllama();
    try {
      const m = await newMailbox('valve-throw', { newMailCap: 1 });
      const healthy = callbacksFor([m], fake);
      expect(await cycle(healthy.callbacks, m)).toBeUndefined();
      for (const n of [1, 2, 3, 4, 5]) {
        await appendMessage(m.user, 'INBOX', mailFrom(NEWS, `valve ${n}`, `valve body ${n}`));
      }
      expect(await cycle(healthy.callbacks, m)).toBeUndefined();
      const held = await mailboxStatus(db.adminUrl, m.id);
      expect(held.state).toBe('needs_attention');
      expect(held.held_new_count).toBe(5);

      // What sift mailbox resume does.
      await ownerSql(
        db.ownerUrl,
        m.id,
        'update mailbox_status set approved_new_count = held_new_count where mailbox_id = $1',
        [m.id],
      );

      // A pass that throws a non-infra error: every LLM-bound message fails at
      // the preflight, and the fifth consecutive failure rethrows. The status
      // read inside the pass is what a worker killed mid-pass leaves behind.
      let snapshot: StatusRow | undefined;
      const exploding = testRuntime(fake, dataDir, {
        preflight: async () => {
          snapshot ??= await mailboxStatus(db.adminUrl, m.id);
          throw new Error('preflight exploded');
        },
      });
      const failing = callbacksFor([m], fake, { classify: exploding });
      const error = await cycle(failing.callbacks, m);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ClassifyInfraError);
      expect((error as Error).message).toBe('preflight exploded');

      expect(snapshot).toBeDefined();
      expect(snapshot?.approved_new_count).toBeNull();
      expect(snapshot?.held_new_count).toBeNull();
      expect(snapshot?.state).toBe('ok');
      expect(snapshot?.last_sync_at).not.toBeNull();

      const failed = await mailboxStatus(db.adminUrl, m.id);
      expect(failed.state).toBe('error');
      expect(failed.approved_new_count).toBeNull();
      expect(failed.held_new_count).toBeNull();
      expect(failed.last_sync_at?.getTime()).toBe(snapshot?.last_sync_at?.getTime());
      expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(5);
      expect(await decisionsOf(db.adminUrl, m.id)).toEqual([]);

      // The next batch ingests with the cap (1), not approved + cap (6): held again.
      for (const n of [6, 7]) {
        await appendMessage(m.user, 'INBOX', mailFrom(NEWS, `valve ${n}`, `valve body ${n}`));
      }
      expect(await cycle(healthy.callbacks, m)).toBeUndefined();
      const after = await mailboxStatus(db.adminUrl, m.id);
      expect(after.state).toBe('needs_attention');
      expect(after.held_new_count).toBe(2);
      expect(after.approved_new_count).toBeNull();
      expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(5);
    } finally {
      await fake.close();
    }
  }, 30_000);
});

describe('one Ollama request at a time across mailboxes (D-19, E6)', () => {
  it('classifies two concurrently running mailboxes with at most one request in flight', async () => {
    const fake = await startFakeOllama({
      chat: () => ({ ...okAnswer('Noise', 0.9), delayMs: 100 }),
    });
    try {
      const a = await newMailbox('flight-a');
      const b = await newMailbox('flight-b');
      const shared = testRuntime(fake, dataDir);
      const { callbacks } = callbacksFor([a, b], fake, { classify: shared });
      expect(await cycle(callbacks, a)).toBeUndefined();
      expect(await cycle(callbacks, b)).toBeUndefined();
      for (const n of [1, 2, 3]) {
        await appendMessage(a.user, 'INBOX', mailFrom(NEWS, `a ${n}`, `a body ${n}`));
        await appendMessage(b.user, 'INBOX', mailFrom(NEWS, `b ${n}`, `b body ${n}`));
      }
      await callbacks.readRegistry();
      await Promise.all([
        callbacks.runBatch(a.entry, new AbortController().signal),
        callbacks.runBatch(b.entry, new AbortController().signal),
      ]);
      expect(await decisionsOf(db.adminUrl, a.id)).toHaveLength(3);
      expect(await decisionsOf(db.adminUrl, b.id)).toHaveLength(3);
      expect(chatCount(fake)).toBe(6);
      expect(fake.maxInFlight()).toBe(1);
      expect((await mailboxStatus(db.adminUrl, a.id)).state).toBe('ok');
      expect((await mailboxStatus(db.adminUrl, b.id)).state).toBe('ok');
    } finally {
      await fake.close();
    }
  }, 30_000);
});

describe('shutdown during classification', () => {
  it('resolves the batch with no decision and no error when the signal fires mid-call', async () => {
    const fake = await startFakeOllama({ chat: () => ({ hang: true }) });
    try {
      const m = await newMailbox('shutdown');
      const { callbacks } = callbacksFor([m], fake);
      expect(await cycle(callbacks, m)).toBeUndefined();
      await appendMessage(m.user, 'INBOX', mailFrom(NEWS, 'Weekly digest', 'This week.'));

      const controller = new AbortController();
      await callbacks.readRegistry();
      const batch = callbacks.runBatch(m.entry, controller.signal);
      await waitFor(() => chatCount(fake) >= 1, 10_000, 'the chat request');
      controller.abort();
      await expect(batch).resolves.toBeUndefined();

      expect(await decisionsOf(db.adminUrl, m.id)).toEqual([]);
      expect(await pendingIdsOf(db.adminUrl, m.id)).toHaveLength(1);
      const status = await mailboxStatus(db.adminUrl, m.id);
      expect(status.state).toBe('ok');
      expect(status.last_error).toBeNull();
    } finally {
      await fake.close();
    }
  }, 30_000);
});
