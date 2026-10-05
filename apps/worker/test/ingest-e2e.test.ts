// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import type { SiftConfig } from '@sift/core/config';
import { type AppDb, createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedImapMailbox } from '../../../packages/db/test/support/seed.ts';
import { createMailboxCallbacks, type MailboxIngestOptions } from '../src/runtime/mailbox-batch.ts';
import type { MailboxEntry } from '../src/runtime/supervisor.ts';
import {
  E2E_PASSWORD_ENV,
  folderSync,
  imapMailbox,
  mailboxCounts,
  mailboxStatus,
  ownerSql,
  rawMessage,
  recordingLog,
  siftConfig,
} from './support/mailbox-harness.ts';
import {
  appendMessage,
  bumpUidValidity,
  expungeMessage,
  freshImapUser,
  messageFlags,
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
    const expected = {
      messages: 2,
      eligible: 2,
      locations: 2,
      liveLocations: 2,
      bodies: 2,
      foreign: 0,
    };
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

/** Live locations of the mailbox by generation, read as the superuser. */
async function liveGenerations(mailboxId: string): Promise<Record<number, number>> {
  const admin = await connect(db.adminUrl);
  try {
    const { rows } = await admin.query<{ generation: number; n: number }>(
      `select generation, count(*)::int as n from message_location
        where mailbox_id = $1 and removed_at is null group by generation`,
      [mailboxId],
    );
    return Object.fromEntries(rows.map((r) => [r.generation, r.n]));
  } finally {
    await admin.end();
  }
}

/** A mailbox past its first sync with `n` new messages stored. */
async function syncedMailbox(slug: string, n: number, extra: Partial<MailboxIngestOptions> = {}) {
  const m = await newMailbox(slug);
  const { callbacks, log } = callbacksFor(m, extra);
  await run(callbacks, m);
  for (let i = 1; i <= n; i += 1) {
    await appendMessage(m.user, 'INBOX', rawMessage(`${slug} message ${i}`));
  }
  await run(callbacks, m);
  expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(n);
  return { m, callbacks, log };
}

describe('first backfill through the worker (D-74, D-75)', () => {
  it('backfills in throttled slices with visible progress, next to new mail', async () => {
    const m = await newMailbox('e2e-backfill', { initialBackfillDays: 30 });
    for (let i = 1; i <= 5; i += 1) {
      await appendMessage(m.user, 'INBOX', rawMessage(`older message ${i}`));
    }
    // The real session (not re-entrant) carries every progress write, so a
    // progress write overlapping a commit would reject the run.
    const { callbacks } = callbacksFor(m, { backfillSliceSize: 2 });

    await run(callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({ messages: 2, eligible: 2 });
    expect(await mailboxStatus(db.adminUrl, m.id)).toMatchObject({
      state: 'ok',
      backfill_done: 2,
      backfill_total: 5,
    });

    // Mail that arrives during the backfill is stored in the run that first sees it.
    await appendMessage(m.user, 'INBOX', rawMessage('arrived during the backfill'));
    await run(callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({ messages: 5, eligible: 5 });
    expect(await mailboxStatus(db.adminUrl, m.id)).toMatchObject({
      backfill_done: 4,
      backfill_total: 5,
    });

    await run(callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({
      messages: 6,
      eligible: 6,
      bodies: 6,
    });
    expect(await mailboxStatus(db.adminUrl, m.id)).toMatchObject({
      state: 'ok',
      backfill_done: null,
      backfill_total: null,
    });
    expect((await folderSync(db.adminUrl, m.id))?.backfill_cursor_uid).toBeNull();
  }, 60_000);
});

describe('UIDVALIDITY resync through the worker (ING-04, D-22..D-25)', () => {
  it('resyncs after a forced UIDVALIDITY change without new message rows', async () => {
    const { m, callbacks, log } = await syncedMailbox('e2e-resync', 3);
    const before = await mailboxCounts(db.adminUrl, m.id);

    const next = await bumpUidValidity(m.user, 'INBOX');
    await run(callbacks, m);

    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({
      messages: before.messages,
      liveLocations: 3,
    });
    expect(await liveGenerations(m.id)).toEqual({ 2: 3 });
    expect(await folderSync(db.adminUrl, m.id)).toMatchObject({
      uidvalidity: next,
      generation: 2,
      state: 'ok',
      last_resync_summary: { matched: 3, new: 0, gone: 0 },
    });
    expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('ok');
    const synced = log.lines.filter((l) => l.msg === 'mailbox synced').at(-1);
    expect(synced?.obj).toMatchObject({ resync: { matched: 3, new: 0, gone: 0 } });
  }, 60_000);
});

describe('read-only, abortable, swept (D-04, D-07, D-11)', () => {
  it('leaves every message flag on the server unchanged by a run that stored mail', async () => {
    const m = await newMailbox('e2e-flags');
    const { callbacks } = callbacksFor(m);
    await run(callbacks, m);
    await appendMessage(m.user, 'INBOX', rawMessage('flags one'));
    await appendMessage(m.user, 'INBOX', rawMessage('flags two'));
    const before = await messageFlags(m.user, 'INBOX');
    await run(callbacks, m);
    expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(2);
    expect(await messageFlags(m.user, 'INBOX')).toEqual(before);
  }, 60_000);

  it('stores nothing and records no error when aborted before the run; the next run stores once', async () => {
    const m = await newMailbox('e2e-abort');
    const { callbacks, log } = callbacksFor(m);
    await run(callbacks, m);
    await appendMessage(m.user, 'INBOX', rawMessage('abort one'));
    await appendMessage(m.user, 'INBOX', rawMessage('abort two'));

    const aborted = new AbortController();
    aborted.abort();
    await run(callbacks, m, aborted.signal);
    expect(log.messages()).toContain('ingest stopped between chunks');
    expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(0);
    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('ok');
    expect(status.last_error).toBeNull();

    await run(callbacks, m);
    await run(callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({ messages: 2, bodies: 2 });
  }, 60_000);

  it('deletes expired body-cache rows on a successful run', async () => {
    const { m, callbacks } = await syncedMailbox('e2e-expiry', 2);
    const expired = await ownerSql(
      db.ownerUrl,
      m.id,
      `update message_body set expires_at = now() - interval '1 day'
        where id = (select id from message_body where mailbox_id = $1 limit 1)`,
      [m.id],
    );
    expect(expired).toBe(1);
    await run(callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({ messages: 2, bodies: 1 });
  }, 60_000);
});

describe('removal diff cadence (D-17, REMOVAL_DIFF_INTERVAL_MS)', () => {
  it('diffs removals at most once per 10 minutes per mailbox', async () => {
    const base = Date.now();
    let offset = 0;
    const { m, callbacks } = await syncedMailbox('e2e-cadence', 2, { now: () => base + offset });
    const uids = [...(await messageFlags(m.user, 'INBOX')).keys()].sort((a, b) => a - b);
    await expungeMessage(m.user, 'INBOX', uids[0] as number);

    // The first run diffed at offset 0; a run 2 minutes later does not diff.
    offset = 120_000;
    await run(callbacks, m);
    expect((await mailboxCounts(db.adminUrl, m.id)).liveLocations).toBe(2);

    // 10 minutes after the last diff, the expunged message's location is vanished.
    offset = 600_000;
    await run(callbacks, m);
    expect(await mailboxCounts(db.adminUrl, m.id)).toMatchObject({
      messages: 2,
      liveLocations: 1,
    });
  }, 60_000);
});
