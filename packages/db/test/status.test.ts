import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppDb,
  createAppDb,
  readHold,
  recordBackfillProgress,
  recordConnecting,
  recordDisabled,
  recordIngestSynced,
  recordNeedsAttention,
  recordSyncError,
  recordSyncSuccess,
  type Scope,
  withMailbox,
} from '../src/index.ts';
import { freshDatabase, type TestDatabase } from './support/db.ts';
import { seedMailboxes } from './support/seed.ts';

/**
 * Owner-visible mailbox states (D-26, D-33, D-34, D-75): connecting during
 * startup grace, needs_attention with the held count for the volume valve,
 * and the first backfill's progress. Runs as sift_app through withMailbox.
 */

const STATES = ['ok', 'error', 'connecting', 'needs_attention', 'disabled'] as const;
type State = (typeof STATES)[number];

/** The recorder that leaves each state. */
const RECORDERS: Record<State, (scope: Scope) => Promise<void>> = {
  ok: (s) => recordSyncSuccess(s),
  error: (s) => recordSyncError(s, new Error('IMAP timed out'), []),
  connecting: (s) => recordConnecting(s),
  needs_attention: (s) => recordNeedsAttention(s, 250, 'matrix'),
  disabled: (s) => recordDisabled(s),
};

const PAIRS = STATES.flatMap((from) => STATES.map((to) => [from, to] as const));
const pairSlug = (from: State, to: State) =>
  `m-${from.replace('_', '-')}-to-${to.replace('_', '-')}`;

let fresh: TestDatabase;
let app: AppDb;
let ids: Record<string, string>;

const statusOf = (mailboxId: string) => withMailbox(app, mailboxId, (s) => s.mailboxStatus.get());

beforeAll(async () => {
  fresh = await freshDatabase();
  ids = await seedMailboxes(fresh.ownerUrl, [
    'personal',
    'connect',
    'backfill',
    'no-status',
    'err-plain',
    'err-synced',
    'ingest-held',
    'ingest-error',
    'ingest-connecting',
    'ingest-no-status',
    'ingest-backfill',
    'ok-notice',
    ...PAIRS.map(([from, to]) => pairSlug(from, to)),
  ]);
  app = createAppDb(fresh.appUrl);
});

afterAll(async () => {
  await app?.close();
  await fresh?.drop();
});

describe('connecting and needs_attention (D-34, D-26)', () => {
  it('recordConnecting stores state connecting and clears last_error', async () => {
    const id = ids.connect as string;
    const at = new Date('2026-10-05T08:00:00.000Z');
    await withMailbox(app, id, (s) => recordSyncError(s, 'Bridge not reachable', []));
    await withMailbox(app, id, (s) => recordConnecting(s, at));
    const status = await statusOf(id);
    expect(status?.state).toBe('connecting');
    expect(status?.lastError).toBeNull();
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
  });

  it('recordNeedsAttention stores the held count and the resume hint; readHold reports them', async () => {
    const id = ids.personal as string;
    await withMailbox(app, id, (s) => s.mailboxStatus.upsert({ approvedNewCount: 400 }));
    await withMailbox(app, id, (s) => recordNeedsAttention(s, 250, 'personal'));
    const status = await statusOf(id);
    expect(status?.state).toBe('needs_attention');
    expect(status?.heldNewCount).toBe(250);
    expect(status?.approvedNewCount).toBeNull();
    expect(status?.lastError).toContain('250 new messages held');
    expect(status?.lastError).toContain('sift mailbox resume personal');

    await expect(withMailbox(app, id, (s) => readHold(s))).resolves.toEqual({
      state: 'needs_attention',
      held: 250,
      approved: null,
    });
  });

  it('readHold reports an approved count; recordSyncSuccess clears held and approved', async () => {
    const id = ids.personal as string;
    await withMailbox(app, id, (s) => s.mailboxStatus.upsert({ approvedNewCount: 250 }));
    await expect(withMailbox(app, id, (s) => readHold(s))).resolves.toEqual({
      state: 'needs_attention',
      held: 250,
      approved: 250,
    });
    await withMailbox(app, id, (s) => recordSyncSuccess(s));
    await expect(withMailbox(app, id, (s) => readHold(s))).resolves.toEqual({
      state: 'ok',
      held: null,
      approved: null,
    });
    expect((await statusOf(id))?.lastError).toBeNull();
  });

  it('readHold reports nulls for a mailbox with no status row', async () => {
    await expect(withMailbox(app, ids['no-status'] as string, (s) => readHold(s))).resolves.toEqual(
      {
        state: null,
        held: null,
        approved: null,
      },
    );
  });
});

describe('recordSyncError with and without syncedAt (D-05, D-16)', () => {
  it('without syncedAt keeps last_sync_at and the valve counts as they were', async () => {
    const id = ids['err-plain'] as string;
    const synced = new Date('2026-10-05T07:00:00.000Z');
    const at = new Date('2026-10-05T08:00:00.000Z');
    await withMailbox(app, id, (s) => recordSyncSuccess(s, synced));
    await withMailbox(app, id, (s) =>
      s.mailboxStatus.upsert({ heldNewCount: 12, approvedNewCount: 12 }),
    );
    await withMailbox(app, id, (s) =>
      recordSyncError(s, new Error('IMAP server unreachable secret-pw'), ['secret-pw'], at),
    );
    const status = await statusOf(id);
    expect(status?.state).toBe('error');
    expect(status?.lastError).toBe('IMAP server unreachable [REDACTED]');
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
    expect(status?.lastSyncAt?.toISOString()).toBe(synced.toISOString());
    expect(status?.heldNewCount).toBe(12);
    expect(status?.approvedNewCount).toBe(12);
  });

  it('with syncedAt sets last_sync_at, clears the valve counts, redacts and caps last_error', async () => {
    const id = ids['err-synced'] as string;
    const synced = new Date('2026-10-05T09:00:00.000Z');
    const at = new Date('2026-10-05T09:00:05.000Z');
    await withMailbox(app, id, (s) =>
      s.mailboxStatus.upsert({ heldNewCount: 30, approvedNewCount: 30 }),
    );
    const long = `rules problem secret-pw ${'x'.repeat(2000)}`;
    await withMailbox(app, id, (s) =>
      recordSyncError(s, new Error(long), ['secret-pw'], at, { syncedAt: synced }),
    );
    const status = await statusOf(id);
    expect(status?.state).toBe('error');
    expect(status?.lastError?.startsWith('rules problem [REDACTED] x')).toBe(true);
    expect(status?.lastError).toHaveLength(1000);
    expect(status?.lastError).not.toContain('secret-pw');
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
    expect(status?.lastSyncAt?.toISOString()).toBe(synced.toISOString());
    expect(status?.heldNewCount).toBeNull();
    expect(status?.approvedNewCount).toBeNull();
  });
});

describe('recordSyncSuccess with a notice (WR-03)', () => {
  it('stores the notice as last_error with state ok; a later call without one clears it', async () => {
    const id = ids['ok-notice'] as string;
    const notice = '2 messages could not be classified (ids: a, b); see docker compose logs worker';
    const at = new Date('2026-10-11T07:00:00.000Z');
    await withMailbox(app, id, (s) =>
      s.mailboxStatus.upsert({ heldNewCount: 9, approvedNewCount: 9 }),
    );
    await withMailbox(app, id, (s) => recordSyncSuccess(s, at, { notice }));
    const noted = await statusOf(id);
    expect(noted?.state).toBe('ok');
    expect(noted?.lastError).toBe(notice);
    expect(noted?.lastSyncAt?.toISOString()).toBe(at.toISOString());
    expect(noted?.heldNewCount).toBeNull();
    expect(noted?.approvedNewCount).toBeNull();

    await withMailbox(app, id, (s) => recordSyncSuccess(s, at, { notice: 'x'.repeat(2000) }));
    expect((await statusOf(id))?.lastError).toHaveLength(1000);

    await withMailbox(app, id, (s) => recordSyncSuccess(s, at));
    const cleared = await statusOf(id);
    expect(cleared?.state).toBe('ok');
    expect(cleared?.lastError).toBeNull();
  });
});

describe('recordIngestSynced (CR-03, D-26)', () => {
  const at = new Date('2026-10-11T06:00:00.000Z');

  it('releases a resumed hold: needs_attention -> ok, last_error and both counts cleared', async () => {
    const id = ids['ingest-held'] as string;
    await withMailbox(app, id, (s) => recordNeedsAttention(s, 5, 'ingest-held'));
    await withMailbox(app, id, (s) => s.mailboxStatus.upsert({ approvedNewCount: 5 }));
    await withMailbox(app, id, (s) => recordIngestSynced(s, at));
    const status = await statusOf(id);
    expect(status?.state).toBe('ok');
    expect(status?.lastError).toBeNull();
    expect(status?.heldNewCount).toBeNull();
    expect(status?.approvedNewCount).toBeNull();
    expect(status?.lastSyncAt?.toISOString()).toBe(at.toISOString());
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
  });

  it('keeps an error state and its last_error for the post-pass write (D-14)', async () => {
    const id = ids['ingest-error'] as string;
    await withMailbox(app, id, (s) => recordSyncError(s, new Error('rules problem'), []));
    await withMailbox(app, id, (s) => s.mailboxStatus.upsert({ approvedNewCount: 3 }));
    await withMailbox(app, id, (s) => recordIngestSynced(s, at));
    const status = await statusOf(id);
    expect(status?.state).toBe('error');
    expect(status?.lastError).toBe('rules problem');
    expect(status?.heldNewCount).toBeNull();
    expect(status?.approvedNewCount).toBeNull();
    expect(status?.lastSyncAt?.toISOString()).toBe(at.toISOString());
  });

  it('keeps a connecting state', async () => {
    const id = ids['ingest-connecting'] as string;
    await withMailbox(app, id, (s) => recordConnecting(s));
    await withMailbox(app, id, (s) => recordIngestSynced(s, at));
    const status = await statusOf(id);
    expect(status?.state).toBe('connecting');
    expect(status?.lastSyncAt?.toISOString()).toBe(at.toISOString());
  });

  it('creates the status row when there is none yet', async () => {
    const id = ids['ingest-no-status'] as string;
    expect(await statusOf(id)).toBeNull();
    await withMailbox(app, id, (s) => recordIngestSynced(s, at));
    const status = await statusOf(id);
    expect(status).not.toBeNull();
    expect(status?.lastSyncAt?.toISOString()).toBe(at.toISOString());
    expect(status?.heldNewCount).toBeNull();
    expect(status?.approvedNewCount).toBeNull();
  });

  it('never touches backfill progress', async () => {
    const id = ids['ingest-backfill'] as string;
    await withMailbox(app, id, async (s) => {
      await recordBackfillProgress(s, { done: 5, total: 10, finished: false });
      await recordNeedsAttention(s, 7, 'ingest-backfill');
      await s.mailboxStatus.upsert({ approvedNewCount: 7 });
    });
    await withMailbox(app, id, (s) => recordIngestSynced(s, at));
    const status = await statusOf(id);
    expect(status?.state).toBe('ok');
    expect([status?.backfillDone, status?.backfillTotal]).toEqual([5, 10]);
  });
});

describe('first-backfill progress (D-75)', () => {
  it('stores done and total, survives a sync success, and clears both when finished', async () => {
    const id = ids.backfill as string;
    await withMailbox(app, id, (s) =>
      recordBackfillProgress(s, { done: 40, total: 120, finished: false }),
    );
    let status = await statusOf(id);
    expect([status?.backfillDone, status?.backfillTotal]).toEqual([40, 120]);

    await withMailbox(app, id, (s) => recordSyncSuccess(s));
    status = await statusOf(id);
    expect([status?.backfillDone, status?.backfillTotal]).toEqual([40, 120]);
    expect(status?.state).toBe('ok');

    await withMailbox(app, id, (s) =>
      recordBackfillProgress(s, { done: 120, total: 120, finished: true }),
    );
    status = await statusOf(id);
    expect([status?.backfillDone, status?.backfillTotal]).toEqual([null, null]);
  });
});

describe('status transition matrix', () => {
  it.each(PAIRS)('%s -> %s leaves exactly the target state within the checks', async (from, to) => {
    const id = ids[pairSlug(from, to)] as string;
    // Backfill progress in flight, so every transition also meets the backfill check.
    await withMailbox(app, id, async (s) => {
      await recordBackfillProgress(s, { done: 5, total: 10, finished: false });
      await RECORDERS[from](s);
    });
    expect((await statusOf(id))?.state).toBe(from);

    await withMailbox(app, id, (s) => RECORDERS[to](s));
    const status = await statusOf(id);
    expect(status?.state).toBe(to);
    if (to === 'ok' || to === 'connecting') expect(status?.lastError).toBeNull();
    if (to === 'ok') {
      expect(status?.heldNewCount).toBeNull();
      expect(status?.approvedNewCount).toBeNull();
    }
    if (to === 'needs_attention') expect(status?.heldNewCount).toBe(250);
    if (to === 'error') expect(status?.lastError).toBe('IMAP timed out');
    expect([status?.backfillDone, status?.backfillTotal]).toEqual([5, 10]);
  });
});
