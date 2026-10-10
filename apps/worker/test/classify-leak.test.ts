// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppDb, createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedImapMailbox } from '../../../packages/db/test/support/seed.ts';
import { ClassifyInfraError, createMailboxCallbacks } from '../src/runtime/mailbox-batch.ts';
import {
  BASIC_RULES,
  decisionsOf,
  expectReplayableDecision,
  type StoredDecision,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import {
  CONTEXT_LENGTH_ERROR,
  contentAnswer,
  FAKE_DIGEST,
  FAKE_MODEL,
  type FakeOllama,
  type FakeOllamaOptions,
  okAnswer,
  startFakeOllama,
} from './support/fake-ollama.ts';
import {
  E2E_PASSWORD_ENV,
  imapMailbox,
  mailboxStatus,
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
 * Mail stays on the machine and out of logs and status (E7, the Phase 3 part
 * of SEC-02; T-03-39, T-03-40). One random sentinel is planted in an email's
 * subject, display name and body, in the fake's reason text and in its HTTP
 * error bodies. Across a normal decision, invalid output, a 500 outage, a
 * context-length 400 and a cloud model, it never appears in a worker log line
 * or in mailbox_status.last_error, while it does appear in the decision's raw
 * output (the positive control). Every fetch goes to the configured origin.
 */

const S = `sentinel-${randomUUID()}`;
const PASSWORD = TEST_IMAP.password;
const ENV = { [E2E_PASSWORD_ENV]: PASSWORD };
const SENDER = 'leak@mail.example.test';
const noSleep = async (): Promise<void> => {};
/** The real fetch, captured before any spy, so recorded calls still reach the fake. */
const realFetch = globalThis.fetch;

let db: TestDatabase;
let appDb: AppDb;
let pin: string;
let dataDir: string;

beforeAll(async () => {
  await requireTestImap();
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  pin = await testImapPin();
  dataDir = await mkdtemp(join(tmpdir(), 'sift-classify-leak-'));
});

afterAll(async () => {
  await appDb?.close();
  await db?.drop();
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
});

/** A message carrying the sentinel in the subject, the display name and the body. */
function sentinelMail(): string {
  return [
    `From: "Sender ${S}" <${SENDER}>`,
    'To: Owner <owner@example.test>',
    `Subject: Notice ${S}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@mail.example.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Please read this. ${S}`,
    '',
  ].join('\r\n');
}

interface LeakRun {
  mailboxId: string;
  fake: FakeOllama;
  /** URLs the runtime's injected fetch was called with. */
  fetched: string[];
  /** URLs fetched without going through the injected fetch. */
  bypassed: string[];
  /** runBatch's rejection (already passed to onBatchError), or undefined. */
  error: unknown;
  log: ReturnType<typeof recordingLog>;
  status: StatusRow;
}

let counter = 0;

/**
 * A fresh mailbox and fake: one batch records the empty folder, then the
 * sentinel mail is appended and a second batch ingests and classifies it,
 * with onBatchError on failure as the supervisor does. The caller closes the fake.
 */
async function leakRun(prefix: string, fakeOptions: FakeOllamaOptions): Promise<LeakRun> {
  const fake = await startFakeOllama(fakeOptions);
  counter += 1;
  const slug = `${prefix}-${counter}`;
  const user = freshImapUser(slug);
  const mailboxId = await seedImapMailbox(db.ownerUrl, {
    slug,
    host: TEST_IMAP.host,
    port: TEST_IMAP.port,
    username: user,
    passwordEnv: E2E_PASSWORD_ENV,
  });
  await writeRules(dataDir, slug, BASIC_RULES);
  const entry = { id: mailboxId, slug, disabledAt: null };

  const fetched: string[] = [];
  const recording: typeof fetch = (input, init) => {
    fetched.push(input instanceof Request ? input.url : String(input));
    return realFetch(input, init);
  };
  const bypassed: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    bypassed.push(input instanceof Request ? input.url : String(input));
    return realFetch(input, init);
  });

  const log = recordingLog();
  const base = siftConfig(imapMailbox(slug, user, { pin }));
  const callbacks = createMailboxCallbacks(appDb, [PASSWORD], {
    config: { ...base, models: { ...base.models, url: fake.url } },
    env: ENV,
    log,
    sleep: noSleep,
    classify: testRuntime(fake, dataDir, { fetch: recording }),
  });
  let error: unknown;
  try {
    await callbacks.readRegistry();
    await callbacks.runBatch(entry, new AbortController().signal);
    await appendMessage(user, 'INBOX', sentinelMail());
    try {
      await callbacks.runBatch(entry, new AbortController().signal);
    } catch (caught) {
      error = caught;
      await callbacks.onBatchError(entry, caught);
    }
  } finally {
    spy.mockRestore();
  }
  return {
    mailboxId,
    fake,
    fetched,
    bypassed,
    error,
    log,
    status: await mailboxStatus(db.adminUrl, mailboxId),
  };
}

/**
 * The sentinel is in no log line (serialised object and message), not in
 * last_error and not in the batch error's message; every fetch went through
 * the injected fetch to the fake's origin.
 */
function expectNoLeak(run: LeakRun): void {
  expect(run.log.lines.length).toBeGreaterThan(0);
  for (const line of run.log.lines) {
    expect(`${JSON.stringify(line.obj)} ${line.msg ?? ''}`).not.toContain(S);
  }
  expect(run.status.last_error ?? '').not.toContain(S);
  if (run.error instanceof Error) {
    expect(run.error.message).not.toContain(S);
    expect(JSON.stringify(run.error)).not.toContain(S);
  }
  const origin = new URL(run.fake.url).origin;
  expect(run.fetched.length).toBeGreaterThan(0);
  for (const url of run.fetched) expect(new URL(url).origin).toBe(origin);
  expect(run.bypassed).toEqual([]);
}

/** The sentinel reached the model: it is inside the fence of every chat request. */
function expectSentinelSent(run: LeakRun): void {
  const bodies = run.fake.chatBodies();
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(JSON.stringify(body)).toContain(S);
}

async function onlyDecision(run: LeakRun): Promise<StoredDecision> {
  const decisions = await decisionsOf(db.adminUrl, run.mailboxId);
  expect(decisions).toHaveLength(1);
  return decisions[0] as StoredDecision;
}

function chatCalls(run: LeakRun): number {
  return run.fake.requests().filter((r) => r.path === '/api/chat').length;
}

describe('mail text never reaches logs or status (E7, T-03-39)', () => {
  it('a normal decision: the echoed reason is in the trace only', async () => {
    const run = await leakRun('normal', { chat: () => okAnswer('Important', 0.9, `About ${S}.`) });
    try {
      expectSentinelSent(run);
      expect(run.error).toBeUndefined();
      expect(run.status.state).toBe('ok');
      const decision = await onlyDecision(run);
      expect(decision).toMatchObject({ outcome: 'labelled', category: 'Important' });
      // Positive control: the scan looks at data that does hold the sentinel.
      expect(JSON.stringify(decision.spans)).toContain(S);
      await expectReplayableDecision(db.adminUrl, decision, run.fake);
      expectNoLeak(run);
    } finally {
      await run.fake.close();
    }
  }, 60_000);

  it('invalid output twice: the raw answer is in the trace only', async () => {
    const run = await leakRun('invalid', { chat: () => contentAnswer(`not json ${S}`) });
    try {
      expectSentinelSent(run);
      const decision = await onlyDecision(run);
      expect(decision).toMatchObject({ outcome: 'review', reviewReason: 'invalid_output' });
      expect(JSON.stringify(decision.spans)).toContain(S);
      await expectReplayableDecision(db.adminUrl, decision, run.fake);
      expect(chatCalls(run)).toBe(2);
      expectNoLeak(run);
    } finally {
      await run.fake.close();
    }
  }, 60_000);

  it("a 500 outage: Ollama's error body stays out of status and logs", async () => {
    const run = await leakRun('outage', {
      chat: () => ({ status: 500, json: { error: `model runner crashed on ${S}` } }),
    });
    try {
      expectSentinelSent(run);
      expect(run.error).toBeInstanceOf(ClassifyInfraError);
      expect(run.status.state).toBe('error');
      expect(run.status.last_error).toBe(
        `Ollama at ${new URL(run.fake.url).origin} failed (HTTP 500); see the Ollama log`,
      );
      expect(await decisionsOf(db.adminUrl, run.mailboxId)).toEqual([]);
      expectNoLeak(run);
    } finally {
      await run.fake.close();
    }
  }, 60_000);

  it("a context-length 400: Ollama's error body stays out of the trace, status and logs", async () => {
    const run = await leakRun('context', {
      chat: () => ({ status: 400, json: { error: `${CONTEXT_LENGTH_ERROR} (${S})` } }),
    });
    try {
      expectSentinelSent(run);
      const decision = await onlyDecision(run);
      expect(decision).toMatchObject({ outcome: 'review', reviewReason: 'input_too_long' });
      expect(JSON.stringify(decision.spans)).not.toContain(S);
      await expectReplayableDecision(db.adminUrl, decision, run.fake);
      expect(chatCalls(run)).toBe(1);
      expect(run.status.state).toBe('ok');
      expectNoLeak(run);
    } finally {
      await run.fake.close();
    }
  }, 60_000);
});

describe('nothing leaves for another origin or a cloud model (E7, T-03-40)', () => {
  it('a remote model is refused before any chat request', async () => {
    const run = await leakRun('remote', {
      tags: {
        status: 200,
        json: {
          models: [
            {
              name: FAKE_MODEL,
              model: FAKE_MODEL,
              digest: FAKE_DIGEST,
              remote_host: `https://${S}.cloud.example.test`,
            },
          ],
        },
      },
    });
    try {
      expect(chatCalls(run)).toBe(0);
      expect(run.fake.requests().map((r) => r.path)).not.toContain('/api/chat');
      expect(run.error).toBeInstanceOf(ClassifyInfraError);
      expect((run.error as ClassifyInfraError).code).toBe('remote_model');
      expect(run.status.state).toBe('error');
      expect(run.status.last_error).toContain('Sift never sends mail off this machine');
      expect(await decisionsOf(db.adminUrl, run.mailboxId)).toEqual([]);
      expectNoLeak(run);
    } finally {
      await run.fake.close();
    }
  }, 60_000);
});
