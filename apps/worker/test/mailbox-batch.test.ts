// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { createServer } from 'node:net';
import type { MailboxConfig } from '@sift/core/config';
import { type AppDb, createAppDb, withIngestLock } from '@sift/db';
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedImapMailbox } from '../../../packages/db/test/support/seed.ts';
import { openImap } from '../src/imap/connect.ts';
import {
  BRIDGE_INIT_COMMAND,
  createMailboxCallbacks,
  type MailboxIngestOptions,
  MailboxSyncError,
  type MailboxSyncErrorKind,
  ownerMessageFor,
  STARTUP_GRACE_MS,
  trustsPmHeader,
} from '../src/runtime/mailbox-batch.ts';
import type { MailboxEntry } from '../src/runtime/supervisor.ts';
import {
  E2E_PASSWORD_ENV,
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
  freshImapUser,
  requireTestImap,
  TEST_IMAP,
  testImapPin,
} from './support/test-imap.ts';

/**
 * Owner-visible mailbox states (02-13 Task 2; D-26, D-33, D-34, D-40, D-72,
 * D-73): the startup grace, classified IMAP and pin errors, the volume hold,
 * the busy lock and a hung logout. Status rows come from the real database;
 * faults the test server cannot produce are injected through openImap.
 */

const PASSWORD = TEST_IMAP.password;
const ENV = { [E2E_PASSWORD_ENV]: PASSWORD };
const noSleep = async (): Promise<void> => {};
/** A pin of valid shape that matches no certificate. */
const WRONG_PIN = Buffer.alloc(32, 7).toString('base64');

let db: TestDatabase;
let appDb: AppDb;
let otherDb: AppDb;
let pin: string;
let closedPort: number;

/** A local port nothing listens on. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

beforeAll(async () => {
  await requireTestImap();
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  otherDb = createAppDb(db.appUrl);
  pin = await testImapPin();
  closedPort = await freePort();
});

afterAll(async () => {
  await appDb?.close();
  await otherDb?.close();
  await db?.drop();
});

interface Mailbox {
  id: string;
  slug: string;
  user: string;
  entry: MailboxEntry;
  config: MailboxConfig;
}

let counter = 0;

async function newMailbox(
  options: { pin?: string | null; port?: number; newMailCap?: number } = {},
): Promise<Mailbox> {
  counter += 1;
  const slug = `batch-${counter}`;
  const user = freshImapUser(slug);
  const port = options.port ?? TEST_IMAP.port;
  const id = await seedImapMailbox(db.ownerUrl, {
    slug,
    host: TEST_IMAP.host,
    port,
    username: user,
    passwordEnv: E2E_PASSWORD_ENV,
  });
  const config = imapMailbox(slug, user, {
    port,
    ...(options.pin === null ? {} : { pin: options.pin ?? pin }),
    ...(options.newMailCap === undefined ? {} : { newMailCap: options.newMailCap }),
  });
  return { id, slug, user, entry: { id, slug, disabledAt: null }, config };
}

function callbacksFor(mailboxes: Mailbox[], extra: Partial<MailboxIngestOptions> = {}) {
  const log = recordingLog();
  const callbacks = createMailboxCallbacks(appDb, [PASSWORD], {
    config: siftConfig(...mailboxes.map((m) => m.config)),
    env: ENV,
    log,
    sleep: noSleep,
    ...extra,
  });
  return { callbacks, log };
}

type Callbacks = ReturnType<typeof createMailboxCallbacks>;

const signal = () => new AbortController().signal;

/** runBatch, then onBatchError on failure, as the supervisor does. Returns the error. */
async function cycle(callbacks: Callbacks, m: Mailbox): Promise<unknown> {
  await callbacks.readRegistry();
  try {
    await callbacks.runBatch(m.entry, signal());
    return undefined;
  } catch (error) {
    await callbacks.onBatchError(m.entry, error);
    return error;
  }
}

/** An openImap that fails like the server or network would, with no connection made. */
function failingOpen(props: Record<string, unknown>, message = 'connect failed') {
  return vi.fn<typeof openImap>(async () => {
    throw Object.assign(new Error(message), props);
  });
}

describe('startup grace (D-34)', () => {
  it('records connecting inside the grace window and the unreachable error after it', async () => {
    const m = await newMailbox();
    const startedAt = Date.now();
    let offset = 10_000;
    const { callbacks } = callbacksFor([m], {
      now: () => startedAt + offset,
      startedAt,
      openImap: failingOpen({ code: 'ECONNREFUSED' }),
    });

    const early = await cycle(callbacks, m);
    expect(early).toBeInstanceOf(MailboxSyncError);
    expect((early as MailboxSyncError).kind).toBe('unreachable');
    let status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('connecting');
    expect(status.last_error).toBeNull();

    offset = STARTUP_GRACE_MS + 1_000;
    await cycle(callbacks, m);
    status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('error');
    expect(status.last_error).toBe(`IMAP server unreachable at 127.0.0.1:${TEST_IMAP.port}`);
  });

  it('treats a timeout inside the grace window as connecting too', async () => {
    const m = await newMailbox();
    const { callbacks } = callbacksFor([m], { openImap: failingOpen({ code: 'ETIMEDOUT' }) });
    await cycle(callbacks, m);
    expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('connecting');
  });

  it('never applies the grace to a rejected login', async () => {
    const m = await newMailbox();
    const { callbacks } = callbacksFor([m], {
      openImap: failingOpen({ authenticationFailed: true }),
    });
    const error = await cycle(callbacks, m);
    expect((error as MailboxSyncError).kind).toBe('auth_rejected');
    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('error');
    expect(status.last_error).toBe(`Bridge rejected login: run ${BRIDGE_INIT_COMMAND}`);
    expect(status.last_error).toBe(
      'Bridge rejected login: run docker compose run --rm bridge-init',
    );
  });
});

describe('classified connection errors (D-33, D-40, D-73)', () => {
  const afterGrace = () => ({ startedAt: Date.now() - 2 * STARTUP_GRACE_MS });

  it('fails closed on a pin mismatch before any client logs in, naming sift bridge trust', async () => {
    const m = await newMailbox({ pin: WRONG_PIN });
    const createClient = vi.fn<(o: ImapFlowOptions) => ImapFlow>((o) => new ImapFlow(o));
    const { callbacks } = callbacksFor([m], {
      ...afterGrace(),
      openImap: (opts) => openImap(opts, { createClient }),
    });
    const error = await cycle(callbacks, m);
    expect((error as MailboxSyncError).kind).toBe('pin_mismatch');
    expect(createClient).not.toHaveBeenCalled();
    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('error');
    expect(status.last_error).toBe(
      `The IMAP server's certificate for mailbox ${m.slug} does not match imap.tls.pin_sha256. If you reinstalled Bridge, run sift bridge trust ${m.slug} to see the fingerprint the worker sees, compare it with the one docker compose run --rm bridge-init printed, and update config.yaml.`,
    );
  });

  it('reports a self-signed server without a pin as not trusted, naming imap.tls.pin_sha256', async () => {
    const m = await newMailbox({ pin: null });
    const { callbacks } = callbacksFor([m], afterGrace());
    const error = await cycle(callbacks, m);
    expect((error as MailboxSyncError).kind).toBe('cert_untrusted');
    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('error');
    expect(status.last_error).toBe(
      `The IMAP server's certificate for mailbox ${m.slug} is not trusted. For Proton Bridge, set imap.tls.pin_sha256 (shown by docker compose run --rm bridge-init and sift bridge trust ${m.slug}); Sift never turns certificate checks off.`,
    );
  });

  it('names host:port when the server offers no STARTTLS', async () => {
    const m = await newMailbox();
    const { callbacks } = callbacksFor([m], {
      ...afterGrace(),
      openImap: failingOpen({ code: 'SIFT_NO_STARTTLS' }),
    });
    await cycle(callbacks, m);
    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('error');
    expect(status.last_error).toBe(
      `IMAP server at 127.0.0.1:${TEST_IMAP.port} does not offer STARTTLS; Sift never logs in without TLS`,
    );
  });

  it('rejects runBatch for every classified failure, so the supervisor backs off (P1 D-51)', async () => {
    const m = await newMailbox();
    for (const props of [
      { code: 'ECONNREFUSED' },
      { code: 'ETIMEDOUT' },
      { authenticationFailed: true },
      { code: 'SIFT_TLS_PIN_MISMATCH' },
      { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      { code: 'SIFT_NO_STARTTLS' },
      { code: 'EWHATEVER' },
    ]) {
      const { callbacks } = callbacksFor([m], { openImap: failingOpen(props) });
      await callbacks.readRegistry();
      await expect(callbacks.runBatch(m.entry, signal())).rejects.toBeInstanceOf(MailboxSyncError);
    }
  });

  it('keeps one failing mailbox from affecting another', async () => {
    const failing = await newMailbox({ port: closedPort });
    const healthy = await newMailbox();
    const { callbacks } = callbacksFor([failing, healthy], afterGrace());
    await callbacks.readRegistry();
    const [a, b] = await Promise.allSettled([
      callbacks.runBatch(failing.entry, signal()),
      callbacks.runBatch(healthy.entry, signal()),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('fulfilled');
    if (a.status === 'rejected') await callbacks.onBatchError(failing.entry, a.reason);
    expect((await mailboxStatus(db.adminUrl, failing.id)).last_error).toBe(
      `IMAP server unreachable at 127.0.0.1:${closedPort}`,
    );
    expect((await mailboxStatus(db.adminUrl, healthy.id)).state).toBe('ok');
  });

  it('never stores the password in last_error', async () => {
    const m = await newMailbox();
    for (const props of [{ code: 'ECONNREFUSED' }, { code: 'EWHATEVER' }, {}]) {
      const { callbacks } = callbacksFor([m], {
        ...afterGrace(),
        openImap: failingOpen(props, `login with ${PASSWORD} failed`),
      });
      await cycle(callbacks, m);
      const status = await mailboxStatus(db.adminUrl, m.id);
      expect(status.state).toBe('error');
      expect(status.last_error).not.toBeNull();
      expect(status.last_error).not.toContain(PASSWORD);
    }
  });
});

describe('busy lock and volume hold (D-03, D-26)', () => {
  it('skips with a log line and no status write while another process holds the lock', async () => {
    const m = await newMailbox();
    const open = vi.fn<typeof openImap>(openImap);
    const { callbacks, log } = callbacksFor([m], { openImap: open });
    await cycle(callbacks, m);
    const before = await mailboxStatus(db.adminUrl, m.id);

    const held = await withIngestLock(otherDb, m.id, async () => {
      open.mockClear();
      await callbacks.runBatch(m.entry, signal());
      return mailboxStatus(db.adminUrl, m.id);
    });
    expect(held.acquired).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(log.messages()).toContain('ingest busy (another process holds mailbox)');
    if (held.acquired) expect(held.value).toEqual(before);
  });

  it('holds a surge above the cap, waits for an approval, then stores it and clears the hold', async () => {
    const m = await newMailbox({ newMailCap: 2 });
    const open = vi.fn<typeof openImap>(openImap);
    const { callbacks, log } = callbacksFor([m], { openImap: open });
    await cycle(callbacks, m); // first sync

    for (const n of [1, 2, 3]) await appendMessage(m.user, 'INBOX', rawMessage(`surge ${n}`));
    await cycle(callbacks, m);
    let status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('needs_attention');
    expect(status.held_new_count).toBe(3);
    expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(0);

    // Held with no approval: the next run does not connect.
    open.mockClear();
    await cycle(callbacks, m);
    expect(open).not.toHaveBeenCalled();
    expect(log.messages()).toContain(`waiting for sift mailbox resume ${m.slug}`);
    expect((await mailboxStatus(db.adminUrl, m.id)).state).toBe('needs_attention');

    // The owner approves (what sift mailbox resume does), and the next run stores the mail.
    await ownerSql(
      db.ownerUrl,
      m.id,
      'update mailbox_status set approved_new_count = held_new_count where mailbox_id = $1',
      [m.id],
    );
    await cycle(callbacks, m);
    expect(open).toHaveBeenCalledTimes(1);
    expect((await mailboxCounts(db.adminUrl, m.id)).messages).toBe(3);
    status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('ok');
    expect(status.held_new_count).toBeNull();
    expect(status.approved_new_count).toBeNull();
  }, 30_000);
});

describe('hung logout (02-18, T-02-73)', () => {
  it('settles runBatch within 7 s and frees the lock when LOGOUT never answers', async () => {
    const m = await newMailbox();
    const { callbacks } = callbacksFor([m], {
      openImap: async (opts) => {
        const client = await openImap(opts);
        client.logout = () => new Promise<void>(() => {});
        return client;
      },
    });
    await callbacks.readRegistry();
    const started = Date.now();
    await callbacks.runBatch(m.entry, signal());
    expect(Date.now() - started).toBeLessThan(7_000);
    const other = await withIngestLock(otherDb, m.id, async () => 'mine');
    expect(other).toEqual({ acquired: true, value: 'mine' });
  }, 15_000);
});

describe('ownerMessageFor', () => {
  const KINDS: MailboxSyncErrorKind[] = [
    'unreachable',
    'timeout',
    'auth_rejected',
    'pin_mismatch',
    'cert_untrusted',
    'no_starttls',
    'protocol',
    'password_missing',
    'not_in_config',
  ];
  const ctx = {
    slug: 'personal',
    host: 'bridge',
    port: 1143,
    pinned: true,
    passwordEnv: 'SIFT_PERSONAL_IMAP_PASSWORD',
  };

  it.each(KINDS)('gives a specific, secret-free message for %s', (kind) => {
    const error = new MailboxSyncError(kind, 'raw', {
      cause: new Error(`server said ${PASSWORD}`),
    });
    for (const pinned of [true, false]) {
      const { kind: got, message } = ownerMessageFor(error, { ...ctx, pinned });
      expect(got).toBe(kind);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toContain(PASSWORD);
      expect(message).not.toContain('undefined');
      expect(message).not.toBe('raw');
    }
  });

  it('never tells the owner to turn certificate checks off without a pin', () => {
    const { message } = ownerMessageFor(new MailboxSyncError('cert_untrusted', 'x'), {
      ...ctx,
      pinned: false,
    });
    expect(message).toContain('Sift never turns certificate checks off');
    expect(message).toContain('imap.tls.pin_sha256');
  });

  it('classifies a raw connection error by its code', () => {
    expect(ownerMessageFor(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), ctx)).toEqual({
      kind: 'unreachable',
      message: 'IMAP server unreachable at bridge:1143',
    });
    expect(ownerMessageFor({ authenticationFailed: true }, ctx).message).toBe(
      'Bridge rejected login: run docker compose run --rm bridge-init',
    );
  });
});

describe('X-Pm-Internal-Id trust (Pitfall 12, WR-04)', () => {
  it('trusts the header only on a pinned server (Bridge), never on a public-CA host', () => {
    expect(trustsPmHeader(imapMailbox('bridge', 'u', { pin: 'a'.repeat(64) }))).toBe(true);
    expect(trustsPmHeader(imapMailbox('public', 'u'))).toBe(false);
  });
});

describe('unclassified failures', () => {
  it("stores the database error, not Drizzle's failed query text with its params", async () => {
    const m = await newMailbox();
    const { callbacks } = callbacksFor([m]);
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    const wrapped = new Error('Failed query: insert into message ... params: Secret subject', {
      cause: pgError,
    });
    await callbacks.onBatchError(m.entry, wrapped);
    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('error');
    expect(status.last_error).toBe('duplicate key value violates unique constraint');
  });

  it("stores fixed text when Drizzle's wrapper has no coded cause (WR-01)", async () => {
    const m = await newMailbox();
    const { callbacks } = callbacksFor([m]);
    const wrapped = new Error('Failed query: insert into message ... params: Secret subject', {
      cause: new TypeError('Do not know how to serialize a BigInt'),
    });
    await callbacks.onBatchError(m.entry, wrapped);
    const status = await mailboxStatus(db.adminUrl, m.id);
    expect(status.state).toBe('error');
    expect(status.last_error).toBe('database query failed without an error code (TypeError)');
  });
});
