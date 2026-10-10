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
import { createMailboxCallbacks, type MailboxIngestOptions } from '../src/runtime/mailbox-batch.ts';
import type { MailboxEntry } from '../src/runtime/supervisor.ts';
import {
  BASIC_RULES,
  decisionsOf,
  expectReplayableDecision,
  pendingIdsOf,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import { type FakeOllama, startFakeOllama } from './support/fake-ollama.ts';
import {
  E2E_PASSWORD_ENV,
  imapMailbox,
  mailboxCounts,
  mailboxStatus,
  recordingLog,
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
