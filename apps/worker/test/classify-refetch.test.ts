// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailboxConfig } from '@sift/core/config';
import { type AppDb, createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedImapMailbox } from '../../../packages/db/test/support/seed.ts';
import { classifyMailbox } from '../src/classify/run.ts';
import { classifyCommand } from '../src/commands/classify.ts';
import { openImap } from '../src/imap/connect.ts';
import { createMailboxCallbacks } from '../src/runtime/mailbox-batch.ts';
import type { MailboxEntry } from '../src/runtime/supervisor.ts';
import {
  BASIC_RULES,
  bodyExpiryOf,
  decisionsOf,
  expectReplayableDecision,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import { FAKE_MODEL, type FakeOllama, okAnswer, startFakeOllama } from './support/fake-ollama.ts';
import {
  E2E_PASSWORD_ENV,
  imapMailbox,
  ownerSql,
  recordingLog,
  siftConfig,
} from './support/mailbox-harness.ts';
import {
  appendMessage,
  bumpUidValidity,
  expungeMessage,
  freshImapUser,
  requireTestImap,
  TEST_IMAP,
  testImapPin,
} from './support/test-imap.ts';

/**
 * D-32's refetch half (03-12, P2 D-08): a re-run of a message whose cached
 * body expired reads the body back from the Dovecot test server, read-only,
 * and only when the server copy's re-derived identity key equals the stored
 * one. Messages are ingested through the Phase 2 batch and decided by the
 * worker's pass first, then their body is deleted as the expiry sweep would.
 */

const PASSWORD = TEST_IMAP.password;
const ENV = { [E2E_PASSWORD_ENV]: PASSWORD };
const DAY_MS = 24 * 60 * 60 * 1000;
const noSleep = async (): Promise<void> => {};

let db: TestDatabase;
let appDb: AppDb;
let pin: string;
let dataDir: string;
let fake: FakeOllama;
/** Every stdout and stderr line, and every subject and body appended, for the final scan. */
const output: string[] = [];
const mailText: string[] = [];

beforeAll(async () => {
  await requireTestImap();
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  pin = await testImapPin();
  dataDir = await mkdtemp(join(tmpdir(), 'sift-classify-refetch-'));
  const reason = `Refetch reason ${randomUUID().slice(0, 8)}.`;
  mailText.push(reason);
  fake = await startFakeOllama({ chat: () => okAnswer('Noise', 0.9, reason) });
});

afterAll(async () => {
  await fake?.close();
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
}

let counter = 0;

/** A mailbox on a fresh Dovecot user, pinned (as Bridge mailboxes are), with BASIC_RULES. */
async function newMailbox(prefix: string): Promise<Mailbox> {
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
  await writeRules(dataDir, slug, BASIC_RULES);
  return {
    id,
    slug,
    user,
    entry: { id, slug, disabledAt: null },
    config: imapMailbox(slug, user, { pin }),
  };
}

/** A plain-text message from the LLM-bound sender with a unique subject and body. */
function letter(name: string): string {
  const subject = `Letter ${name} ${randomUUID().slice(0, 8)}`;
  const body = `The text of ${name} ${randomUUID().slice(0, 8)}.`;
  mailText.push(subject, body);
  return [
    'From: Letters <news@letters.example.test>',
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

/**
 * Ingest `count` new messages through the Phase 2 batch (no classify option),
 * then let the worker's pass decide them. Returns their ids and UIDs.
 */
async function ingestAndDecide(m: Mailbox, count: number): Promise<{ id: string; uid: number }[]> {
  const callbacks = createMailboxCallbacks(appDb, [PASSWORD], {
    config: siftConfig(m.config),
    env: ENV,
    log: recordingLog(),
    sleep: noSleep,
  });
  const signal = new AbortController().signal;
  await callbacks.readRegistry();
  // The first sync records the folder; mail appended after it is new and eligible (D-21).
  await callbacks.runBatch(m.entry, signal);
  for (let i = 0; i < count; i += 1) await appendMessage(m.user, 'INBOX', letter(`${m.slug}-${i}`));
  await callbacks.runBatch(m.entry, signal);

  const outcome = await classifyMailbox({
    db: appDb,
    mailbox: m,
    model: FAKE_MODEL,
    threshold: 0.75,
    runtime: testRuntime(fake, dataDir),
    signal,
    log: recordingLog(),
  });
  expect(outcome).toMatchObject({ kind: 'done', labelled: count });
  return locations(m);
}

/** The mailbox's live INBOX locations, newest UID first, read as the superuser. */
async function locations(m: Mailbox): Promise<{ id: string; uid: number }[]> {
  const admin = await connect(db.adminUrl);
  try {
    const { rows } = await admin.query<{ id: string; uid: string }>(
      `select message_id as id, uid from message_location
        where mailbox_id = $1 and folder = 'INBOX' and removed_at is null order by uid desc`,
      [m.id],
    );
    return rows.map((r) => ({ id: r.id, uid: Number(r.uid) }));
  } finally {
    await admin.end();
  }
}

/** The cached body text of a message, or null when it has none, read as the superuser. */
async function bodyText(m: Mailbox, messageId: string): Promise<string | null> {
  const admin = await connect(db.adminUrl);
  try {
    const { rows } = await admin.query<{ body_text: string }>(
      'select body_text from message_body where mailbox_id = $1 and message_id = $2',
      [m.id, messageId],
    );
    return rows[0]?.body_text ?? null;
  } finally {
    await admin.end();
  }
}

/** Delete a message's cached body, as the expiry sweep does after a decision. */
async function expireBody(m: Mailbox, messageId: string): Promise<void> {
  const removed = await ownerSql(
    db.ownerUrl,
    m.id,
    'delete from message_body where mailbox_id = $1 and message_id = $2',
    [m.id, messageId],
  );
  expect(removed).toBe(1);
}

interface RerunResult {
  code: 0 | 1;
  stdout: string[];
  stderr: string[];
  connections: number;
}

/** `sift classify <slug> --message <id> --yes` with an openImap that counts connections. */
async function rerun(
  m: Mailbox,
  messageId: string,
  env: Record<string, string> = ENV,
  runtime = testRuntime(fake, dataDir),
): Promise<RerunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let connections = 0;
  const code = await classifyCommand({
    db: appDb,
    config: siftConfig(m.config),
    env,
    slug: m.slug,
    selector: { kind: 'message', id: messageId },
    dataDir,
    runtime,
    confirm: async () => true,
    openImap: async (options) => {
      connections += 1;
      return openImap(options);
    },
    stdout: (line) => {
      stdout.push(line);
      output.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
      output.push(line);
    },
  });
  return { code, stdout, stderr, connections };
}

describe('sift classify refetches an expired body by identity (D-32)', () => {
  it('restores the body read-only, appends a rerun decision, and the body expires 7 days after it was restored', async () => {
    const m = await newMailbox('refetch');
    const [message] = await ingestAndDecide(m, 1);
    if (message === undefined) throw new Error('no message ingested');
    const original = await bodyText(m, message.id);
    expect(original).not.toBeNull();
    await expireBody(m, message.id);

    const before = Date.now();
    const result = await rerun(m, message.id);
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      `Found 1 message to classify in ${m.slug}.`,
      `Classified 1 message of ${m.slug}: 1 labelled, 0 review.`,
    ]);
    expect(result.connections).toBe(1);

    expect(await bodyText(m, message.id)).toBe(original);
    const decisions = await decisionsOf(db.adminUrl, m.id);
    expect(decisions.map((d) => d.decidedBy)).toEqual(['worker', 'rerun']);
    const latest = decisions[1];
    if (latest === undefined) throw new Error('no rerun decision');
    // CR-02: the restore sets the expiry, a moment before the rerun decision.
    const expiry = await bodyExpiryOf(db.adminUrl, m.id, message.id);
    expect(expiry).not.toBeNull();
    expect(expiry?.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(expiry?.getTime()).toBeLessThanOrEqual(latest.createdAt.getTime() + 7 * DAY_MS);
    await expectReplayableDecision(db.adminUrl, latest, fake);
  });

  it('gives the restored body its 7-day expiry even when Ollama is down after the refetch (CR-02)', async () => {
    const m = await newMailbox('outage');
    const [message] = await ingestAndDecide(m, 1);
    if (message === undefined) throw new Error('no message ingested');
    const original = await bodyText(m, message.id);
    expect(original).not.toBeNull();
    await expireBody(m, message.id);
    // Ollama down at a known URL: a fake that is closed at once (never the real port).
    const downFake = await startFakeOllama();
    await downFake.close();

    const t0 = Date.now();
    const result = await rerun(m, message.id, ENV, testRuntime(downFake, dataDir));
    expect(result.code).toBe(1);
    expect(result.stderr[0]).toContain('Ollama unreachable at ');

    expect(await bodyText(m, message.id)).toBe(original);
    expect((await decisionsOf(db.adminUrl, m.id)).map((d) => d.decidedBy)).toEqual(['worker']);
    const expiry = await bodyExpiryOf(db.adminUrl, m.id, message.id);
    expect(expiry).not.toBeNull();
    expect(expiry?.getTime()).toBeGreaterThanOrEqual(t0 + 7 * DAY_MS);
    expect(expiry?.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
  });

  it('skips a message whose stored identity no longer matches the server copy', async () => {
    const m = await newMailbox('mismatch');
    const [message] = await ingestAndDecide(m, 1);
    if (message === undefined) throw new Error('no message ingested');
    await expireBody(m, message.id);
    await ownerSql(db.ownerUrl, m.id, 'update message set identity_key = $2 where id = $1', [
      message.id,
      `mid:${randomUUID()}@changed.example.test`,
    ]);

    const result = await rerun(m, message.id);
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([
      `message ${message.id}: the server copy no longer matches; skipped`,
    ]);
    expect(result.stdout.at(-1)).toBe(
      `Classified 0 messages of ${m.slug}: 0 labelled, 0 review; 1 skipped.`,
    );
    expect(await bodyText(m, message.id)).toBeNull();
    expect((await decisionsOf(db.adminUrl, m.id)).map((d) => d.decidedBy)).toEqual(['worker']);
  });

  it('skips a message expunged from the folder', async () => {
    const m = await newMailbox('expunged');
    const [message] = await ingestAndDecide(m, 1);
    if (message === undefined) throw new Error('no message ingested');
    await expireBody(m, message.id);
    await expungeMessage(m.user, 'INBOX', message.uid);

    const result = await rerun(m, message.id);
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([
      `message ${message.id}: its body is no longer on the server; skipped`,
    ]);
    expect(await bodyText(m, message.id)).toBeNull();
    expect(await decisionsOf(db.adminUrl, m.id)).toHaveLength(1);
  });

  it('never reads a stored UID under a new UIDVALIDITY (T-03-44)', async () => {
    const m = await newMailbox('uidvalidity');
    const [message] = await ingestAndDecide(m, 1);
    if (message === undefined) throw new Error('no message ingested');
    await expireBody(m, message.id);
    await bumpUidValidity(m.user, 'INBOX');

    const result = await rerun(m, message.id);
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([
      `message ${message.id}: its body is no longer on the server; skipped`,
    ]);
    expect(await bodyText(m, message.id)).toBeNull();
    expect(await decisionsOf(db.adminUrl, m.id)).toHaveLength(1);
  });

  it('opens no IMAP connection when the body is still cached', async () => {
    const m = await newMailbox('cached');
    const [message] = await ingestAndDecide(m, 1);
    if (message === undefined) throw new Error('no message ingested');

    const result = await rerun(m, message.id, {});
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.connections).toBe(0);
    expect((await decisionsOf(db.adminUrl, m.id)).map((d) => d.decidedBy)).toEqual([
      'worker',
      'rerun',
    ]);
  });

  it('refuses with the missing-env message and changes nothing without the password', async () => {
    const m = await newMailbox('no-password');
    const [message] = await ingestAndDecide(m, 1);
    if (message === undefined) throw new Error('no message ingested');
    await expireBody(m, message.id);

    const result = await rerun(m, message.id, {});
    expect(result.code).toBe(1);
    expect(result.connections).toBe(0);
    expect(result.stderr).toHaveLength(1);
    expect(result.stderr[0]).toContain(E2E_PASSWORD_ENV);
    expect(await bodyText(m, message.id)).toBeNull();
    expect(await decisionsOf(db.adminUrl, m.id)).toHaveLength(1);
  });
});

describe('output (T-03-47)', () => {
  it('no run printed a subject, body or model reason, or the password', () => {
    expect(output.length).toBeGreaterThan(5);
    const text = output.join('\n');
    for (const value of mailText) expect(text).not.toContain(value);
    expect(text).not.toContain(PASSWORD);
  });
});
