// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import type { SiftConfig } from '@sift/core/config';
import { type AppDb, createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedImapMailbox } from '../../../packages/db/test/support/seed.ts';
import { createMailboxCallbacks, type MailboxIngestOptions } from '../src/runtime/mailbox-batch.ts';
import type { MailboxEntry } from '../src/runtime/supervisor.ts';
import {
  E2E_PASSWORD_ENV,
  folderSync,
  imapMailbox,
  mailboxCounts,
  mailboxStatus,
  rawMessage,
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
 * The worker's own mailbox callbacks, end to end (02-13): the real database
 * as sift_app and the Dovecot test server over a pinned STARTTLS connection.
 * ROADMAP Phase 2 success criteria 3 and 4 on the test server; plan 02-19
 * repeats them on the owner's Proton mailbox through Bridge.
 */

const ENV = { [E2E_PASSWORD_ENV]: TEST_IMAP.password };
const noSleep = async (): Promise<void> => {};

let db: TestDatabase;
let appDb: AppDb;
let pin: string;

beforeAll(async () => {
  await requireTestImap();
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  pin = await testImapPin();
});

afterAll(async () => {
  await appDb?.close();
  await db?.drop();
});

interface Mailbox {
  id: string;
  slug: string;
  user: string;
  entry: MailboxEntry;
  config: SiftConfig;
}

/** A registered mailbox for a fresh test-server user, with a matching config. */
async function newMailbox(
  slug: string,
  options: { initialBackfillDays?: number; newMailCap?: number } = {},
): Promise<Mailbox> {
  const user = freshImapUser(slug);
  const id = await seedImapMailbox(db.ownerUrl, {
    slug,
    host: TEST_IMAP.host,
    port: TEST_IMAP.port,
    username: user,
    passwordEnv: E2E_PASSWORD_ENV,
  });
  const config = siftConfig(imapMailbox(slug, user, { pin, ...options }));
  return { id, slug, user, entry: { id, slug, disabledAt: null }, config };
}

function callbacksFor(m: Mailbox, extra: Partial<MailboxIngestOptions> = {}) {
  const log = recordingLog();
  const callbacks = createMailboxCallbacks(appDb, [TEST_IMAP.password], {
    config: m.config,
    env: ENV,
    log,
    sleep: noSleep,
    ...extra,
  });
  return { callbacks, log };
}

async function run(
  callbacks: ReturnType<typeof createMailboxCallbacks>,
  m: Mailbox,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  await callbacks.readRegistry();
  await callbacks.runBatch(m.entry, signal);
}

describe('worker mailbox run against the test IMAP server (ING-01..ING-03)', () => {
  it('stores new mail exactly once, scoped to its mailbox, across polls and a restart', async () => {
    const m = await newMailbox('e2e-tracer');
    const first = callbacksFor(m);

    // Run 1: the first sync records the folder state and stores nothing.
    await run(first.callbacks, m);
    expect(await folderSync(db.adminUrl, m.id)).toMatchObject({ generation: 1, state: 'ok' });
    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({ messages: 0, locations: 0 });
    expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('ok');

    // Run 2: two new messages arrive and are stored with their bodies.
    await appendMessage(m.user, 'INBOX', rawMessage('first new message'));
    await appendMessage(m.user, 'INBOX', rawMessage('second new message'));
    await run(first.callbacks, m);
    const expected = { messages: 2, locations: 2, liveLocations: 2, bodies: 2, foreign: 0 };
    expect(await mailboxCounts(db.adminUrl, m.id)).toEqual(expected);
    expect(first.log.messages()).toContain('mailbox synced');
    const synced = first.log.lines.filter((l) => l.msg === 'mailbox synced').at(-1);
    expect(synced?.obj).toMatchObject({ mailbox: m.slug, stored: 2, firstSync: false });

    // Run 3: nothing new, nothing changes.
    await run(first.callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toEqual(expected);

    // A restart: a new set of callbacks (a new worker process) adds no duplicates.
    const restarted = callbacksFor(m);
    await run(restarted.callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toEqual(expected);

    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('ok');
    expect(status.last_error).toBeNull();
    expect(status.last_sync_at).not.toBeNull();
  }, 60_000);
});
