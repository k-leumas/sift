import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppDb,
  createAppDb,
  readHold,
  recordBackfillProgress,
  recordConnecting,
  recordDisabled,
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
