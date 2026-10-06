// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { MailboxConfig } from '@sift/core/config';
import {
  type AppDb,
  createAppDb,
  recordNeedsAttention,
  recordSyncSuccess,
  withIngestLock,
  withMailbox,
} from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedImapMailbox, seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import type { CommandIO } from '../src/command.ts';
import {
  BACKFILL_LOCK_WAIT_MS,
  run as backfill,
  backfillMailbox,
  DEFAULT_BACKFILL_DAYS,
  MAX_BACKFILL_DAYS,
  MIN_BACKFILL_DAYS,
} from '../src/commands/mailbox-backfill.ts';
import { run as resume } from '../src/commands/mailbox-resume.ts';
import { closeImap, type ImapFlow, openImap } from '../src/imap/connect.ts';
import { createMailboxCallbacks } from '../src/runtime/mailbox-batch.ts';
import {
  E2E_PASSWORD_ENV,
  imapMailbox,
  mailboxCounts,
  mailboxStatus,
  rawMessage,
  recordingLog,
  siftConfig,
} from './support/mailbox-harness.ts';
import {
  bumpUidValidity,
  freshImapUser,
  requireTestImap,
  TEST_IMAP,
  testImapPin,
} from './support/test-imap.ts';

/**
 * Owner mailbox operations (02-16): `sift mailbox resume` releases a volume
 * hold (D-26) and `sift mailbox backfill` counts, confirms and ingests
 * (D-03, D-75). Everything runs in-process against the real database; the
 * backfill also against the Dovecot test server.
 */

let db: TestDatabase;
let appDb: AppDb;

beforeAll(async () => {
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
});

afterAll(async () => {
  await appDb?.close();
  await db?.drop();
});

interface Captured {
  code: number;
  stdout: string[];
  stderr: string[];
}

/** Run a command in-process with the given environment; collect its output. */
async function capture(
  command: (args: readonly string[], io: CommandIO) => Promise<number>,
  args: readonly string[],
  env: Record<string, string>,
  stdin?: CommandIO['stdin'],
): Promise<Captured> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await command(args, {
    env,
    cwd: process.cwd(),
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    ...(stdin === undefined ? {} : { stdin }),
  });
  return { code, stdout, stderr };
}

describe('sift mailbox resume (D-26)', () => {
  let ids: Record<string, string>;
  const owner = () => ({ SIFT_OWNER_DATABASE_URL: db.ownerUrl });

  beforeAll(async () => {
    ids = await seedMailboxes(db.ownerUrl, ['personal', 'quiet']);
    const id = ids.personal ?? '';
    await withMailbox(appDb, id, (scope) => recordNeedsAttention(scope, 250, 'personal'));
  });

  it('approves the held count of a mailbox in needs_attention', async () => {
    const result = await capture(resume, ['personal'], owner());

    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      'Resumed personal: the next check processes up to 250 held messages, plus new mail up to the per-cycle limit.',
    ]);
    const status = await mailboxStatus(db.adminUrl, ids.personal ?? '');
    expect(status.state).toBe('needs_attention');
    expect(status.held_new_count).toBe(250);
    expect(status.approved_new_count).toBe(250);
  });

  it('changes nothing on a mailbox that is not waiting', async () => {
    await withMailbox(appDb, ids.personal ?? '', (scope) => recordSyncSuccess(scope));
    const before = await mailboxStatus(db.adminUrl, ids.personal ?? '');

    const result = await capture(resume, ['personal'], owner());

    expect(result.code).toBe(0);
    expect(result.stdout).toEqual(['Mailbox personal is not waiting for a resume (status: ok).']);
    expect(await mailboxStatus(db.adminUrl, ids.personal ?? '')).toEqual(before);
  });

  it('reports never run for a mailbox without a status row', async () => {
    const result = await capture(resume, ['quiet'], owner());

    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      'Mailbox quiet is not waiting for a resume (status: never run).',
    ]);
    expect((await mailboxStatus(db.adminUrl, ids.quiet ?? '')).state).toBeNull();
  });

  it('exits 1 for an unknown slug and 2 for bad usage', async () => {
    const unknown = await capture(resume, ['nope'], owner());
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toEqual(['sift mailbox resume: no mailbox with slug "nope"']);

    for (const args of [[], ['a', 'b'], ['--force', 'personal']]) {
      const usage = await capture(resume, args, owner());
      expect(usage.code, args.join(' ')).toBe(2);
      expect(usage.stderr.join('\n')).toContain('Usage: sift mailbox resume <slug>');
    }
  });

  it('never prints the owner database URL', async () => {
    const missing = await capture(resume, ['personal'], {});
    expect(missing.code).toBe(1);
    expect(missing.stderr.join('\n')).toContain('SIFT_OWNER_DATABASE_URL');

    const results = [
      await capture(resume, ['personal'], owner()),
      await capture(resume, ['nope'], owner()),
    ];
    for (const r of results) {
      expect([...r.stdout, ...r.stderr].join('\n')).not.toContain(db.ownerUrl);
    }
  });
});

const PASSWORD = TEST_IMAP.password;
const ENV = { [E2E_PASSWORD_ENV]: PASSWORD };
const DAY_MS = 86_400_000;
/** A pin of valid shape that matches no certificate. */
const WRONG_PIN = Buffer.alloc(32, 7).toString('base64');

describe('sift mailbox backfill (D-03, D-75)', () => {
  // Its own database: the resume tests above already registered "personal".
  let bdb: TestDatabase;
  let bAppDb: AppDb;
  let pin: string;
  let otherDb: AppDb;
  let dir: string;

  beforeAll(async () => {
    await requireTestImap();
    pin = await testImapPin();
    bdb = await freshDatabase();
    bAppDb = createAppDb(bdb.appUrl);
    otherDb = createAppDb(bdb.appUrl);
    dir = await mkdtemp(path.join(tmpdir(), 'sift-backfill-'));
  });

  afterAll(async () => {
    await otherDb?.close();
    await bAppDb?.close();
    await bdb?.drop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  interface Mailbox {
    id: string;
    slug: string;
    user: string;
    config: MailboxConfig;
  }

  /** A registered mailbox for a fresh test-server user; first sync stores nothing (0 days). */
  async function newMailbox(
    slug: string,
    options: { newMailCap?: number; pin?: string } = {},
  ): Promise<Mailbox> {
    const user = freshImapUser(slug);
    const id = await seedImapMailbox(bdb.ownerUrl, {
      slug,
      host: TEST_IMAP.host,
      port: TEST_IMAP.port,
      username: user,
      passwordEnv: E2E_PASSWORD_ENV,
    });
    const config = imapMailbox(slug, user, {
      pin: options.pin ?? pin,
      initialBackfillDays: 0,
      ...(options.newMailCap === undefined ? {} : { newMailCap: options.newMailCap }),
    });
    return { id, slug, user, config };
  }

  /** Append messages with the given INTERNALDATEs over a pinned connection. */
  async function append(m: Mailbox, ...dates: Date[]): Promise<void> {
    const client = await openImap({
      host: TEST_IMAP.host,
      port: TEST_IMAP.port,
      user: m.user,
      pass: PASSWORD,
      tls: { mode: 'starttls', pinSha256: pin },
    });
    try {
      for (const [i, date] of dates.entries()) {
        await client.append('INBOX', rawMessage(`Backfill test ${i}`), [], date);
      }
    } finally {
      await closeImap(client);
    }
  }

  /** One worker run, as the supervisor would do it, so the folder is synced. */
  async function syncOnce(m: Mailbox): Promise<void> {
    const callbacks = createMailboxCallbacks(bAppDb, [PASSWORD], {
      config: siftConfig(m.config),
      env: ENV,
      log: recordingLog(),
      sleep: async () => {},
    });
    await callbacks.readRegistry();
    await callbacks.runBatch(
      { id: m.id, slug: m.slug, disabledAt: null },
      new AbortController().signal,
    );
  }

  /** last_uid, the watermark and the first-backfill cursor, as one comparable text. */
  async function cursor(m: Mailbox): Promise<string> {
    const admin = await connect(bdb.adminUrl);
    try {
      const { rows } = await admin.query<{ snap: string }>(
        `select json_build_object(
           'last_uid', last_uid, 'watermark', internal_date_watermark,
           'uidvalidity', uidvalidity, 'generation', generation, 'state', state,
           'backfill_since', backfill_since, 'backfill_cursor_uid', backfill_cursor_uid,
           'backfill_until_uid', backfill_until_uid, 'backfill_total', backfill_total)::text as snap
           from folder_sync where mailbox_id = $1 and folder = 'INBOX'`,
        [m.id],
      );
      return rows[0]?.snap ?? 'none';
    } finally {
      await admin.end();
    }
  }

  interface Run extends Captured {
    confirmations: [number, number][];
  }

  async function backfillOf(
    m: Mailbox,
    options: {
      days?: number;
      confirm?: boolean | (() => Promise<boolean>);
      lockWaitMs?: number;
      signal?: AbortSignal;
      config?: MailboxConfig;
      slug?: string;
      openImap?: typeof openImap;
    } = {},
  ): Promise<Run> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const confirmations: [number, number][] = [];
    const answer = options.confirm ?? true;
    const code = await backfillMailbox({
      db: bAppDb,
      config: siftConfig(options.config ?? m.config),
      env: ENV,
      slug: options.slug ?? m.slug,
      days: options.days ?? 3,
      confirm: async (count, days) => {
        confirmations.push([count, days]);
        return typeof answer === 'boolean' ? answer : answer();
      },
      ...(options.lockWaitMs === undefined ? {} : { lockWaitMs: options.lockWaitMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.openImap === undefined ? {} : { openImap: options.openImap }),
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    const all = [...stdout, ...stderr].join('\n');
    expect(all).not.toContain(PASSWORD);
    return { code, stdout, stderr, confirmations };
  }

  const ago = (days: number) => new Date(Date.now() - days * DAY_MS);

  it('exports the documented limits', () => {
    expect(BACKFILL_LOCK_WAIT_MS).toBe(60_000);
    expect([MIN_BACKFILL_DAYS, DEFAULT_BACKFILL_DAYS, MAX_BACKFILL_DAYS]).toEqual([1, 3, 365]);
  });

  describe('count, confirm, ingest', () => {
    let m: Mailbox;
    let before: string;

    beforeAll(async () => {
      // new_mail_cap 1: the confirmed backfill is not capped (D-75).
      m = await newMailbox('personal', { newMailCap: 1 });
      const now = new Date();
      await append(m, now, now, now, ago(10));
      await syncOnce(m);
      expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(0);
      before = await cursor(m);
    });

    it('a declined confirmation stores nothing and releases the lock', async () => {
      const result = await backfillOf(m, { confirm: false });

      expect(result.stderr).toEqual([]);
      expect(result.code).toBe(0);
      expect(result.stdout).toEqual([
        'Found 3 messages from the last 3 days in INBOX of personal.',
        'Nothing changed.',
      ]);
      expect(result.confirmations).toEqual([[3, 3]]);
      expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(0);
      const other = await withIngestLock(otherDb, m.id, async () => 'held');
      expect(other).toEqual({ acquired: true, value: 'held' });
    });

    it('a confirmed backfill stores the counted messages, uncapped, without moving the cursors', async () => {
      const result = await backfillOf(m);

      expect(result.stderr).toEqual([]);
      expect(result.code).toBe(0);
      expect(result.stdout).toEqual([
        'Found 3 messages from the last 3 days in INBOX of personal.',
        'Backfilled personal: stored 3 new, 0 already stored.',
      ]);
      const counts = await mailboxCounts(bdb.adminUrl, m.id);
      expect(counts).toMatchObject({ messages: 3, eligible: 3, bodies: 3, foreign: 0 });
      expect(await cursor(m)).toBe(before);
    });

    it('a rerun finds the same messages and stores no duplicates', async () => {
      const result = await backfillOf(m);

      expect(result.code).toBe(0);
      expect(result.stdout).toEqual([
        'Found 3 messages from the last 3 days in INBOX of personal.',
        'Backfilled personal: stored 0 new, 3 already stored.',
      ]);
      expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(3);
      expect(await cursor(m)).toBe(before);
    });
  });

  it('ingests exactly the counted messages, not mail that arrived after the count', async () => {
    const m = await newMailbox('arrivals');
    const now = new Date();
    await append(m, now, now, now);
    await syncOnce(m);

    const result = await backfillOf(m, {
      confirm: async () => {
        await append(m, new Date());
        return true;
      },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      'Found 3 messages from the last 3 days in INBOX of arrivals.',
      'Backfilled arrivals: stored 3 new, 0 already stored.',
    ]);
    expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(3);
  });

  it('holds neither the ingest lock nor an IMAP connection while it asks (WR-02)', async () => {
    const m = await newMailbox('prompt');
    await append(m, new Date(), new Date());
    await syncOnce(m);
    const clients: ImapFlow[] = [];
    const tracked: typeof openImap = async (options) => {
      const client = await openImap(options);
      clients.push(client);
      return client;
    };
    let atPrompt: { lock: unknown; open: number } | undefined;

    const result = await backfillOf(m, {
      openImap: tracked,
      confirm: async () => {
        atPrompt = {
          lock: await withIngestLock(otherDb, m.id, async () => 'free'),
          open: clients.filter((c) => c.usable).length,
        };
        return true;
      },
    });

    expect(atPrompt).toEqual({ lock: { acquired: true, value: 'free' }, open: 0 });
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      'Found 2 messages from the last 3 days in INBOX of prompt.',
      'Backfilled prompt: stored 2 new, 0 already stored.',
    ]);
    // One connection for the count, a fresh one for the ingest.
    expect(clients).toHaveLength(2);
  });

  it('waits for the ingest lock, then refuses while the worker holds it (D-03)', async () => {
    const m = await newMailbox('busy');
    await append(m, new Date());
    await syncOnce(m);
    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = (): void => {};
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = withIngestLock(otherDb, m.id, async () => {
      held();
      await released;
    });
    await holding;

    try {
      const started = Date.now();
      const result = await backfillOf(m, { lockWaitMs: 1500 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
      expect(result.code).toBe(1);
      expect(result.stderr.join('\n')).toContain(
        'the worker is ingesting busy right now; try again in a minute',
      );
      expect(result.confirmations).toEqual([]);
      expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(0);
    } finally {
      release();
      await holder;
    }
  });

  it('refuses a folder the worker has not synced yet', async () => {
    const m = await newMailbox('unsynced');
    await append(m, new Date());

    const result = await backfillOf(m);

    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).toContain(
      'the worker has not synced unsynced yet; start the worker first',
    );
    expect(result.confirmations).toEqual([]);
  });

  it('refuses a folder that is due for a resync', async () => {
    const m = await newMailbox('resyncing');
    await append(m, new Date());
    await syncOnce(m);
    await bumpUidValidity(m.user, 'INBOX');

    const result = await backfillOf(m);

    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).toContain(
      'resyncing is being resynced; try again after the worker finishes',
    );
    expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(0);
  });

  it("reuses the worker's pin-mismatch text and never prints the password", async () => {
    const m = await newMailbox('pinned', { pin: WRONG_PIN });

    const result = await backfillOf(m);

    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).toContain(
      "The IMAP server's certificate for mailbox pinned does not match imap.tls.pin_sha256.",
    );
  });

  it('exits 1 for an unknown slug', async () => {
    const m = await newMailbox('known');
    const result = await backfillOf(m, { slug: 'nope' });
    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).toContain('no mailbox with slug "nope"');
  });

  it('stops before ingesting when aborted at the prompt', async () => {
    const m = await newMailbox('aborted');
    await append(m, new Date());
    await syncOnce(m);
    const controller = new AbortController();

    const result = await backfillOf(m, {
      signal: controller.signal,
      confirm: async () => {
        controller.abort();
        return true;
      },
    });

    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).toContain(
      'backfill of aborted stopped before it started; nothing changed',
    );
    expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(0);
  });

  describe('the command line', () => {
    let m: Mailbox;
    let configFile: string;

    beforeAll(async () => {
      m = await newMailbox('cli');
      const now = new Date();
      await append(m, now, now);
      await syncOnce(m);
      configFile = path.join(dir, 'config.yaml');
      await writeFile(
        configFile,
        `version: 1
mailboxes:
  - slug: cli
    imap:
      host: ${TEST_IMAP.host}
      port: ${TEST_IMAP.port}
      username: ${m.user}
      password_env: ${E2E_PASSWORD_ENV}
      tls:
        mode: starttls
        pin_sha256: ${pin}
    ingest:
      initial_backfill_days: 0
      new_mail_cap: 1
    labels:
      apply_as: proton_labels
models:
  provider: ollama
  embeddings: nomic-embed-text
  llm: qwen3:1.7b
`,
      );
    });

    const cliEnv = () => ({
      SIFT_CONFIG: configFile,
      SIFT_DATABASE_URL: bdb.appUrl,
      [E2E_PASSWORD_ENV]: PASSWORD,
    });
    const stdinOf = (text: string) => Readable.from([text]);

    it.each([
      [['cli', '--days', '0']],
      [['cli', '--days', '366']],
      [['cli', '--days', 'abc']],
      [['cli', '--days', '2.5']],
      [[]],
      [['cli', 'extra']],
      [['cli', '--force']],
    ])('%j exits 2 with the usage', async (args) => {
      const result = await capture(backfill, args, cliEnv());
      expect(result.code).toBe(2);
      expect(result.stdout).toEqual([]);
      expect(result.stderr.join('\n')).toContain(
        'Usage: sift mailbox backfill <slug> [--days <n>] [--yes]',
      );
    });

    it('asks on stdin and only yes confirms', async () => {
      const declined = await capture(backfill, ['cli'], cliEnv(), stdinOf('y\n'));
      expect(declined.code).toBe(0);
      expect(declined.stdout).toEqual([
        'Found 2 messages from the last 3 days in INBOX of cli.',
        'Ingest them? Type yes to continue:',
        'Nothing changed.',
      ]);
      expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(0);

      const confirmed = await capture(backfill, ['cli', '--days', '2'], cliEnv(), stdinOf('YES\n'));
      expect(confirmed.stderr).toEqual([]);
      expect(confirmed.code).toBe(0);
      expect(confirmed.stdout).toEqual([
        'Found 2 messages from the last 2 days in INBOX of cli.',
        'Ingest them? Type yes to continue:',
        'Backfilled cli: stored 2 new, 0 already stored.',
      ]);
      expect((await mailboxCounts(bdb.adminUrl, m.id)).messages).toBe(2);
    });

    it('--yes skips the prompt but still prints the count first', async () => {
      const result = await capture(backfill, ['cli', '--yes'], cliEnv());
      expect(result.stderr).toEqual([]);
      expect(result.code).toBe(0);
      expect(result.stdout).toEqual([
        'Found 2 messages from the last 3 days in INBOX of cli.',
        'Backfilled cli: stored 0 new, 2 already stored.',
      ]);
    });

    it('exits 1 without SIFT_DATABASE_URL and never prints secrets', async () => {
      const { SIFT_DATABASE_URL: _url, ...env } = cliEnv();
      const result = await capture(backfill, ['cli', '--yes'], env);
      expect(result.code).toBe(1);
      expect(result.stderr.join('\n')).toContain('SIFT_DATABASE_URL');

      const unknown = await capture(backfill, ['nope', '--yes'], cliEnv());
      expect(unknown.code).toBe(1);
      for (const r of [result, unknown]) {
        const all = [...r.stdout, ...r.stderr].join('\n');
        expect(all).not.toContain(PASSWORD);
        expect(all).not.toContain(bdb.appUrl);
      }
    });
  });
});
