import { describe, expect, it, type Mock, vi } from 'vitest';
import { isCandidateNew } from '../src/ingest/plan.ts';
import {
  BACKFILL_CHUNK_PAUSE_MS,
  BACKFILL_SLICE_SIZE,
  BackfillRefusedError,
  CHUNK_SIZE,
  countBackfill,
  FIRST_SYNC_CLOCK_ALLOWANCE_MS,
  type IngestDeps,
  REMOVAL_DIFF_INTERVAL_MS,
  RESYNC_BATCH_SIZE,
  runBackfill,
  runIngest,
  WATERMARK_OVERLAP_MS,
} from '../src/ingest/run.ts';
import { FakeFolderSource, fakeMail } from './support/fake-folder-source.ts';
import { FakeIngestStore } from './support/fake-ingest-store.ts';

// Synthetic mail only (example.test addresses, invented text), never real mail.

const NOW = new Date('2026-06-15T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 86_400_000;
const FOLDER = 'INBOX';

function ago(ms: number, from: Date = NOW): Date {
  return new Date(from.getTime() - ms);
}

type LogFn = (obj: object, msg: string) => void;
type Progress = { done: number; total: number; finished: boolean };

interface Harness {
  source: FakeFolderSource;
  store: FakeIngestStore;
  log: { info: Mock<LogFn>; warn: Mock<LogFn> };
  progress: Progress[];
  sleeps: number[];
  clock: { now: Date };
  deps(overrides?: Partial<IngestDeps>): IngestDeps;
}

function harness(): Harness {
  const source = new FakeFolderSource({ folder: FOLDER });
  const store = new FakeIngestStore();
  const log = { info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() };
  const progress: Progress[] = [];
  const sleeps: number[] = [];
  const clock = { now: NOW };
  return {
    source,
    store,
    log,
    progress,
    sleeps,
    clock,
    deps: (overrides = {}) => ({
      source,
      store,
      folder: FOLDER,
      trustPmHeader: false,
      newMailCap: 200,
      initialBackfillDays: 0,
      now: () => clock.now,
      signal: new AbortController().signal,
      log,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onBackfillProgress: async (p) => {
        progress.push(p);
        store.events.push('progress');
      },
      ...overrides,
    }),
  };
}

function eligibleCount(store: FakeIngestStore): number {
  return store.messages().filter((m) => m.eligible).length;
}

describe('engine constants', () => {
  it('match the decided values', () => {
    expect(CHUNK_SIZE).toBe(50);
    expect(RESYNC_BATCH_SIZE).toBe(500);
    expect(WATERMARK_OVERLAP_MS).toBe(300_000);
    expect(BACKFILL_SLICE_SIZE).toBe(200);
    expect(BACKFILL_CHUNK_PAUSE_MS).toBe(250);
    expect(FIRST_SYNC_CLOCK_ALLOWANCE_MS).toBe(600_000);
    expect(REMOVAL_DIFF_INTERVAL_MS).toBe(600_000);
  });
});

describe('first sync (D-18, D-20, D-74, D-83)', () => {
  it('records the start point of an empty folder with no backfill', async () => {
    const h = harness();
    const outcome = await runIngest(h.deps({ initialBackfillDays: 30 }));

    expect(outcome).toEqual({
      kind: 'synced',
      firstSync: true,
      stored: 0,
      historical: 0,
      vanished: 0,
      backfill: null,
    });
    const folder = h.store.folder(FOLDER);
    expect(folder?.watermark).toEqual(ago(10 * MINUTE));
    expect(folder?.lastUid).toBe(0);
    expect(folder?.uidValidity).toBe(h.source.uidValidity);
    expect(folder?.backfill).toBeNull();
    expect(h.store.messages()).toHaveLength(0);
  });

  it('logs the computed watermark (ISO 8601 UTC) and its age', async () => {
    const h = harness();
    await runIngest(h.deps());

    const stored = h.store.folder(FOLDER)?.watermark;
    expect(h.log.info).toHaveBeenCalledWith(
      { folder: FOLDER, watermark: stored?.toISOString(), watermarkAgeSeconds: 600 },
      'first sync watermark',
    );
  });

  it('takes the newest server INTERNALDATE when it is later than the floor', async () => {
    const h = harness();
    h.source.append(fakeMail(ago(2 * MINUTE)));
    await runIngest(h.deps());

    expect(h.store.folder(FOLDER)?.watermark).toEqual(ago(2 * MINUTE));
    expect(h.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ watermarkAgeSeconds: 120 }),
      'first sync watermark',
    );
  });

  it('stores mail from a server clock lagging by 8 minutes as eligible', async () => {
    const h = harness();
    h.source.append(fakeMail(ago(10 * MINUTE)));
    await runIngest(h.deps());

    // Delivered after startup, stamped by a Bridge clock 8 minutes behind.
    h.source.append(fakeMail(ago(8 * MINUTE)));
    h.clock.now = new Date(NOW.getTime() + MINUTE);
    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', stored: 1, historical: 0 });
    expect(eligibleCount(h.store)).toBe(1);
    expect(h.store.bodies()).toHaveLength(1);
    // A watermark of now() would have made it history.
    expect(isCandidateNew(ago(8 * MINUTE), NOW, WATERMARK_OVERLAP_MS)).toBe(false);
  });

  it('keeps an old message moved back into a quiet inbox historical (D-20)', async () => {
    const h = harness();
    h.source.append(fakeMail(ago(90 * DAY)));
    await runIngest(h.deps());
    expect(h.store.folder(FOLDER)?.watermark).toEqual(ago(10 * MINUTE));

    // Moved back from an archive: fresh UID, original INTERNALDATE.
    const uid = h.source.append(fakeMail(ago(7 * DAY)));
    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', stored: 0, historical: 1 });
    const [message] = h.store.messages();
    expect(message?.eligible).toBe(false);
    expect(h.store.bodies()).toHaveLength(0);
    expect(h.store.liveLocationsOf(FOLDER).map((l) => l.uid)).toEqual([uid]);
    expect(h.source.callsOf('downloadText')).toHaveLength(0);
  });
});

describe('first backfill (D-74, D-75)', () => {
  function fiveDays(h: Harness): number[] {
    return [5, 4, 3, 2, 1].map((d) => h.source.append(fakeMail(ago(d * DAY))));
  }

  it('runs in slices across cycles, reports progress and clears the cursor', async () => {
    const h = harness();
    const uids = fiveDays(h);
    const deps = () => h.deps({ initialBackfillDays: 30, backfillSliceSize: 2 });

    const first = await runIngest(deps());
    expect(first).toMatchObject({ kind: 'synced', firstSync: true });
    expect(h.store.folder(FOLDER)?.backfill).toMatchObject({
      cursorUid: uids[1],
      untilUid: uids[4],
      total: 5,
    });
    expect(eligibleCount(h.store)).toBe(2);

    await runIngest(deps());
    expect(eligibleCount(h.store)).toBe(4);

    const third = await runIngest(deps());
    expect(third).toMatchObject({ backfill: { done: 5, total: 5, finished: true } });
    expect(eligibleCount(h.store)).toBe(5);
    expect(h.store.bodies()).toHaveLength(5);
    expect(h.store.folder(FOLDER)?.backfill).toBeNull();

    expect(h.progress).toEqual([
      { done: 2, total: 5, finished: false },
      { done: 4, total: 5, finished: false },
      { done: 5, total: 5, finished: true },
    ]);

    const searches = h.source.callsOf('searchSince').length;
    const fourth = await runIngest(deps());
    expect(fourth).toMatchObject({ kind: 'synced', backfill: null });
    expect(h.source.callsOf('searchSince')).toHaveLength(searches);
  });

  it('covers only the last N days and records the window at first sync', async () => {
    const h = harness();
    h.source.append(fakeMail(ago(40 * DAY)));
    const inWindow = h.source.append(fakeMail(ago(29 * DAY)));
    await runIngest(h.deps({ initialBackfillDays: 30 }));

    expect(h.store.messages()).toHaveLength(1);
    expect(h.store.locations().map((l) => l.uid)).toEqual([inWindow]);
  });

  it('pauses between chunks of a slice', async () => {
    const h = harness();
    fiveDays(h);
    await runIngest(h.deps({ initialBackfillDays: 30, backfillSliceSize: 3, chunkSize: 1 }));

    expect(h.sleeps).toEqual([BACKFILL_CHUNK_PAUSE_MS, BACKFILL_CHUNK_PAUSE_MS]);
    expect(eligibleCount(h.store)).toBe(3);
  });

  it('reports progress only after the chunk commit resolved, never overlapping a store call', async () => {
    const h = harness();
    [3, 2, 1].map((d) => h.source.append(fakeMail(ago(d * DAY))));
    const releaseFirst = h.store.holdCommit();
    const releaseSecond = h.store.holdCommit();

    const run = runIngest(h.deps({ initialBackfillDays: 30, chunkSize: 2 }));

    await vi.waitFor(() => expect(h.store.events).toContain('commitChunk:start'));
    expect(h.progress).toHaveLength(0);
    releaseFirst();

    await vi.waitFor(() =>
      expect(h.store.events.filter((e) => e === 'commitChunk:start')).toHaveLength(2),
    );
    expect(h.progress).toEqual([{ done: 2, total: 3, finished: false }]);
    releaseSecond();
    await run;

    expect(h.store.overlaps).toBe(0);
    const tail = h.store.events.slice(h.store.events.indexOf('commitChunk:start'));
    expect(tail).toEqual([
      'commitChunk:start',
      'commitChunk:end',
      'progress',
      'commitChunk:start',
      'commitChunk:end',
      'setBackfill:start',
      'setBackfill:end',
      'progress',
      'deleteExpiredBodies:start',
      'deleteExpiredBodies:end',
    ]);
  });

  it('backfills nothing when initialBackfillDays is 0', async () => {
    const h = harness();
    fiveDays(h);
    const outcome = await runIngest(h.deps({ initialBackfillDays: 0 }));

    expect(outcome).toMatchObject({ kind: 'synced', backfill: null });
    expect(h.store.messages()).toHaveLength(0);
    expect(h.store.folder(FOLDER)?.backfill).toBeNull();
    expect(h.source.callsOf('searchSince')).toHaveLength(0);
  });
});

describe('new mail (ING-02, ING-03, D-04)', () => {
  async function started(): Promise<Harness> {
    const h = harness();
    h.source.append(fakeMail(ago(DAY)));
    await runIngest(h.deps());
    return h;
  }

  it('stores new mail as eligible with bodies and advances last_uid', async () => {
    const h = await started();
    h.source.append(fakeMail(ago(MINUTE), { text: 'first new' }));
    const last = h.source.append(fakeMail(ago(MINUTE), { text: 'second new' }));

    const outcome = await runIngest(h.deps());

    expect(outcome).toEqual({
      kind: 'synced',
      firstSync: false,
      stored: 2,
      historical: 0,
      vanished: 0,
      backfill: null,
    });
    expect(h.store.messages().map((m) => m.eligible)).toEqual([true, true]);
    expect(h.store.bodies().map((b) => b.body.text)).toEqual(['first new', 'second new']);
    expect(h.store.locations()).toHaveLength(2);
    expect(h.store.folder(FOLDER)?.lastUid).toBe(last);
  });

  it('stores nothing more on the next run and fetches no headers', async () => {
    const h = await started();
    h.source.append(fakeMail(ago(MINUTE)));
    h.source.append(fakeMail(ago(MINUTE)));
    await runIngest(h.deps());
    const before = h.source.calls.length;

    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', stored: 0, historical: 0 });
    expect(h.store.messages()).toHaveLength(2);
    const after = h.source.calls.slice(before).map((c) => c.method);
    expect(after).not.toContain('fetchHeaders');
    expect(after).not.toContain('fetchDates');
  });

  it('drops the highest old message that n:* returns (ING-03 adjacency)', async () => {
    const h = await started();
    // A message that arrived and left again: UIDNEXT moved, nothing new is there.
    h.source.expunge(h.source.append(fakeMail(ago(MINUTE))));
    const before = h.source.calls.length;

    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', stored: 0, historical: 0 });
    const after = h.source.calls.slice(before).map((c) => c.method);
    expect(after).toContain('fetchDates');
    expect(after).not.toContain('fetchHeaders');
    expect(h.store.messages()).toHaveLength(0);
  });

  it('resumes after an abort between chunks with no duplicates', async () => {
    const h = await started();
    const uids = Array.from({ length: 7 }, () => h.source.append(fakeMail(ago(MINUTE))));
    const controller = new AbortController();
    const commit = h.store.commitChunk.bind(h.store);
    h.store.commitChunk = async (...args) => {
      const result = await commit(...args);
      controller.abort();
      return result;
    };

    const aborted = await runIngest(h.deps({ chunkSize: 3, signal: controller.signal }));
    expect(aborted).toEqual({ kind: 'aborted', stored: 3 });
    expect(h.store.messages()).toHaveLength(3);
    expect(h.store.folder(FOLDER)?.lastUid).toBe(uids[2]);

    h.store.commitChunk = commit;
    const resumed = await runIngest(h.deps({ chunkSize: 3 }));
    expect(resumed).toMatchObject({ kind: 'synced', stored: 4 });
    expect(h.store.messages()).toHaveLength(7);
    expect(h.store.locations()).toHaveLength(7);
    expect(new Set(h.store.locations().map((l) => l.uid)).size).toBe(7);
    expect(h.store.folder(FOLDER)?.lastUid).toBe(uids[6]);
  });
});

/** A synced folder whose watermark is NOW - 10 minutes (one old message, not stored). */
async function synced(): Promise<Harness> {
  const h = harness();
  h.source.append(fakeMail(ago(90 * DAY)));
  await runIngest(h.deps());
  return h;
}

const WATERMARK = ago(10 * MINUTE);
const BOUNDARY = new Date(WATERMARK.getTime() - WATERMARK_OVERLAP_MS);

describe('INTERNALDATE gate on polling (D-18..D-21)', () => {
  it('treats a message exactly at watermark - 5 minutes as historical', async () => {
    const h = await synced();
    h.source.append(fakeMail(BOUNDARY));
    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', stored: 0, historical: 1 });
    expect(h.store.messages()[0]?.eligible).toBe(false);
    expect(h.store.bodies()).toHaveLength(0);
  });

  it('treats a message 1 ms after the boundary as new', async () => {
    const h = await synced();
    h.source.append(fakeMail(new Date(BOUNDARY.getTime() + 1)));
    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', stored: 1, historical: 0 });
    expect(h.store.messages()[0]?.eligible).toBe(true);
    expect(h.store.bodies()).toHaveLength(1);
  });

  it('keeps an old-dated message with a fresh UID historical, with no body', async () => {
    const h = await synced();
    h.source.append(fakeMail(ago(3 * DAY)));
    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', stored: 0, historical: 1 });
    expect(h.store.messages()[0]?.eligible).toBe(false);
    expect(h.store.bodies()).toHaveLength(0);
    expect(h.source.callsOf('downloadText')).toHaveLength(0);
  });

  it('commits in ascending UID order and never moves the watermark back', async () => {
    const h = await synced();
    for (const minutes of [1, 3, 2]) h.source.append(fakeMail(ago(minutes * MINUTE)));
    await runIngest(h.deps({ chunkSize: 1 }));

    const uids = h.store.commitLog.flatMap((c) => c.uids);
    expect(uids).toEqual([...uids].sort((a, b) => a - b));
    const marks = h.store.commitLog.map((c) => c.advance?.watermark?.getTime() ?? 0);
    expect(marks).toEqual([...marks].sort((a, b) => a - b));
    expect(h.store.folder(FOLDER)?.watermark).toEqual(ago(MINUTE));

    // Older eligible mail later on does not move it back.
    h.source.append(fakeMail(ago(4 * MINUTE)));
    await runIngest(h.deps());
    expect(h.store.folder(FOLDER)?.watermark).toEqual(ago(MINUTE));
  });
});

describe('volume valve on polling (D-26)', () => {
  it('returns needs_attention and writes nothing above the cap', async () => {
    const h = await synced();
    for (let i = 0; i < 4; i += 1) h.source.append(fakeMail(ago(MINUTE)));
    const commits = h.store.count('commitChunk');

    const outcome = await runIngest(h.deps({ newMailCap: 3 }));

    expect(outcome).toEqual({ kind: 'needs_attention', candidateNew: 4 });
    expect(h.store.count('commitChunk')).toBe(commits);
    expect(h.source.callsOf('fetchHeaders')).toHaveLength(0);
    expect(h.store.messages()).toHaveLength(0);
    expect(h.store.folder(FOLDER)?.lastUid).toBe(1);
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ folder: FOLDER, candidateNew: 4 }),
      expect.any(String),
    );
  });

  it('never counts historical messages toward the cap', async () => {
    const h = await synced();
    for (let i = 0; i < 3; i += 1) h.source.append(fakeMail(ago(MINUTE)));
    for (let i = 0; i < 5; i += 1) h.source.append(fakeMail(ago(30 * DAY)));

    const outcome = await runIngest(h.deps({ newMailCap: 3 }));

    expect(outcome).toMatchObject({ kind: 'synced', stored: 3, historical: 5 });
  });

  it('never stops the first backfill, which only proceeds in slices (D-75)', async () => {
    const h = harness();
    for (let i = 0; i < 500; i += 1) h.source.append(fakeMail(ago(DAY + (500 - i) * MINUTE)));
    const deps = () => h.deps({ initialBackfillDays: 30, newMailCap: 3 });

    expect(await runIngest(deps())).toMatchObject({
      kind: 'synced',
      backfill: { done: 200, total: 500, finished: false },
    });
    expect(await runIngest(deps())).toMatchObject({
      backfill: { done: 400, total: 500, finished: false },
    });
    expect(await runIngest(deps())).toMatchObject({
      backfill: { done: 500, total: 500, finished: true },
    });
    expect(eligibleCount(h.store)).toBe(500);
  });
});

describe('removal diff (D-07, D-17)', () => {
  async function threeStored(): Promise<{ h: Harness; uids: number[] }> {
    const h = await synced();
    const uids = [1, 2, 3].map(() => h.source.append(fakeMail(ago(MINUTE))));
    await runIngest(h.deps());
    return { h, uids };
  }

  it('marks an expunged location vanished and deletes its never-classified body', async () => {
    const { h, uids } = await threeStored();
    h.source.expunge(uids[1] as number);
    const before = h.source.calls.length;

    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'synced', vanished: 1 });
    const gone = h.store.locations().find((l) => l.uid === uids[1]);
    expect(gone?.removedReason).toBe('vanished');
    expect(h.store.bodyOf(gone?.messageId as string)).toBeUndefined();
    expect(h.store.bodies()).toHaveLength(2);
    expect(h.store.messages()).toHaveLength(3);
    const lists = h.source.calls.slice(before).filter((c) => c.method === 'listUids');
    expect(lists.map((c) => c.args)).toEqual([[`${uids[0]}:${uids[2]}`]]);
  });

  it('keeps the body while the message has another live location', async () => {
    const h = await synced();
    const a = h.source.append(fakeMail(ago(MINUTE), { messageId: '<twice@example.test>' }));
    h.source.append(fakeMail(ago(MINUTE), { messageId: '<twice@example.test>' }));
    await runIngest(h.deps());
    expect(h.store.messages()).toHaveLength(1);

    h.source.expunge(a);
    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ vanished: 1 });
    expect(h.store.bodies()).toHaveLength(1);
  });

  it('lists only UIDs at or below the cycle-start last_uid', async () => {
    const { h, uids } = await threeStored();
    h.source.append(fakeMail(ago(MINUTE)));
    const before = h.source.calls.length;

    await runIngest(h.deps());

    const lists = h.source.calls.slice(before).filter((c) => c.method === 'listUids');
    expect(lists.map((c) => c.args)).toEqual([[`${uids[0]}:${uids[2]}`]]);
  });

  it('makes no listUids call when there are no live locations', async () => {
    const h = await synced();
    await runIngest(h.deps());
    expect(h.source.callsOf('listUids')).toHaveLength(0);
  });

  it('skips the diff when removalDiff is false and catches up on the next due cycle', async () => {
    const { h, uids } = await threeStored();
    h.source.expunge(uids[0] as number);
    const before = h.source.calls.length;

    const skipped = await runIngest(h.deps({ removalDiff: false }));
    expect(skipped).toMatchObject({ kind: 'synced', vanished: 0 });
    expect(h.source.calls.slice(before).map((c) => c.method)).not.toContain('listUids');
    expect(h.store.liveLocationsOf(FOLDER)).toHaveLength(3);

    const due = await runIngest(h.deps({ removalDiff: true }));
    expect(due).toMatchObject({ vanished: 1 });
    expect(h.store.liveLocationsOf(FOLDER)).toHaveLength(2);
  });
});

describe('body-cache sweep (D-07)', () => {
  it('deletes expired bodies once per synced cycle', async () => {
    const h = await synced();
    h.source.append(fakeMail(ago(MINUTE)));
    await runIngest(h.deps());
    const [message] = h.store.messages();
    h.store.setBodyExpiry(message?.id as string, ago(MINUTE));
    const sweeps = h.store.count('deleteExpiredBodies');

    await runIngest(h.deps());

    expect(h.store.count('deleteExpiredBodies')).toBe(sweeps + 1);
    expect(h.store.bodies()).toHaveLength(0);
  });

  it('does not sweep when the valve trips', async () => {
    const h = await synced();
    for (let i = 0; i < 2; i += 1) h.source.append(fakeMail(ago(MINUTE)));
    const sweeps = h.store.count('deleteExpiredBodies');
    await runIngest(h.deps({ newMailCap: 1 }));
    expect(h.store.count('deleteExpiredBodies')).toBe(sweeps);
  });
});

describe('CLI backfill: count, then run exactly the counted set (D-75)', () => {
  const WRITES = [
    'createFolder',
    'commitChunk',
    'setBackfill',
    'markVanished',
    'beginResync',
    'finishResync',
    'deleteExpiredBodies',
  ];

  function writes(store: FakeIngestStore): number {
    return WRITES.reduce((sum, m) => sum + store.count(m as never), 0);
  }

  async function withHistory(): Promise<{ h: Harness; recent: number[] }> {
    const h = await synced();
    // Polled after the start point but old-dated: stored historical.
    const historical = h.source.append(fakeMail(ago(DAY)));
    await runIngest(h.deps());
    expect(h.store.messages()[0]?.eligible).toBe(false);
    h.source.append(fakeMail(ago(5 * DAY)));
    const recent = h.source.append(fakeMail(ago(36 * 60 * MINUTE)));
    // Leave the last two unpolled so runBackfill is what stores them.
    return { h, recent: [historical, recent].sort((a, b) => a - b) };
  }

  it('countBackfill returns the exact UIDs of the window and writes nothing', async () => {
    const { h, recent } = await withHistory();
    const before = writes(h.store);

    const plan = await countBackfill(h.deps(), 2);

    expect(plan.count).toBe(2);
    expect(plan.uids).toEqual(recent);
    expect(plan.since).toEqual(ago(2 * DAY));
    expect(writes(h.store)).toBe(before);
  });

  it('runBackfill stores exactly the counted set, promotes history and moves no cursor', async () => {
    const { h, recent } = await withHistory();
    const plan = await countBackfill(h.deps(), 2);
    const folderBefore = structuredClone(h.store.folder(FOLDER));
    // Arrives in the window after the owner saw the count: not part of the run.
    const late = h.source.append(fakeMail(ago(MINUTE)));

    const outcome = await runBackfill(h.deps(), plan);

    expect(outcome).toEqual({ kind: 'backfilled', found: 2, inserted: 1, existing: 1 });
    const stored = h.store.locations().map((l) => l.uid);
    expect(stored).toEqual(expect.arrayContaining(recent));
    expect(stored).not.toContain(late);
    expect(h.store.messages().every((m) => m.eligible)).toBe(true);
    expect(h.store.bodies()).toHaveLength(2);
    const folderAfter = h.store.folder(FOLDER);
    expect(folderAfter?.lastUid).toBe(folderBefore?.lastUid);
    expect(folderAfter?.watermark).toEqual(folderBefore?.watermark);
    expect(folderAfter?.backfill).toEqual(folderBefore?.backfill);
  });

  it('skips a planned UID expunged before the run', async () => {
    const { h, recent } = await withHistory();
    const plan = await countBackfill(h.deps(), 2);
    h.source.expunge(recent[1] as number);

    const outcome = await runBackfill(h.deps(), plan);

    expect(outcome).toEqual({ kind: 'backfilled', found: 1, inserted: 0, existing: 1 });
  });

  it('is not capped: the CLI asked the owner first', async () => {
    const h = await synced();
    for (let i = 0; i < 10; i += 1) h.source.append(fakeMail(ago(DAY)));
    // Not polled yet; the backfill takes them first.
    const plan = await countBackfill(h.deps({ newMailCap: 1 }), 2);
    const outcome = await runBackfill(h.deps({ newMailCap: 1 }), plan);

    expect(plan.count).toBe(10);
    expect(outcome).toEqual({ kind: 'backfilled', found: 10, inserted: 10, existing: 0 });
    expect(eligibleCount(h.store)).toBe(10);
  });

  it('stops between chunks on abort', async () => {
    const h = await synced();
    for (let i = 0; i < 4; i += 1) h.source.append(fakeMail(ago(DAY)));
    const plan = await countBackfill(h.deps(), 2);
    const controller = new AbortController();
    const commit = h.store.commitChunk.bind(h.store);
    h.store.commitChunk = async (...args) => {
      const result = await commit(...args);
      controller.abort();
      return result;
    };

    const outcome = await runBackfill(h.deps({ chunkSize: 3, signal: controller.signal }), plan);

    expect(outcome).toEqual({ kind: 'aborted', inserted: 3 });
  });

  it('refuses before the first sync', async () => {
    const h = harness();
    h.source.append(fakeMail(ago(DAY)));
    await expect(countBackfill(h.deps(), 2)).rejects.toMatchObject({
      name: 'BackfillRefusedError',
      reason: 'not_synced',
    });
    await expect(
      runBackfill(h.deps(), { count: 1, since: ago(2 * DAY), uids: [1], uidValidity: 1000 }),
    ).rejects.toBeInstanceOf(BackfillRefusedError);
  });

  it('refuses while the folder is resyncing', async () => {
    const h = await synced();
    h.source.append(fakeMail(ago(DAY)));
    const plan = await countBackfill(h.deps(), 2);
    await h.store.beginResync(FOLDER, h.source.uidValidity + 1, 2);

    await expect(countBackfill(h.deps(), 2)).rejects.toMatchObject({ reason: 'resyncing' });
    await expect(runBackfill(h.deps(), plan)).rejects.toMatchObject({ reason: 'resyncing' });
  });

  it('refuses a plan counted under another UIDVALIDITY', async () => {
    const h = await synced();
    h.source.append(fakeMail(ago(DAY)));
    const plan = await countBackfill(h.deps(), 2);
    h.source.bumpUidValidity({ renumber: true });

    await expect(runBackfill(h.deps(), plan)).rejects.toMatchObject({ reason: 'resyncing' });
    expect(h.store.count('commitChunk')).toBe(0);
  });
});
