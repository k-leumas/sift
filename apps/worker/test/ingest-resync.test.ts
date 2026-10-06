import { describe, expect, it, type Mock, vi } from 'vitest';
import {
  aboveLastUid,
  backfillWindow,
  chunk,
  formatResyncLine,
  isCandidateNew,
  pendingGenerationFor,
} from '../src/ingest/plan.ts';
import { BACKFILL_CHUNK_PAUSE_MS, type IngestDeps, runIngest } from '../src/ingest/run.ts';
import type { FolderState } from '../src/ingest/types.ts';
import { FakeFolderSource, fakeMail } from './support/fake-folder-source.ts';
import { FakeIngestStore } from './support/fake-ingest-store.ts';

// Synthetic mail only (example.test addresses, invented text), never real mail.

const NOW = new Date('2026-06-15T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 86_400_000;
const FOLDER = 'INBOX';

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

type LogFn = (obj: object, msg: string) => void;

interface Harness {
  source: FakeFolderSource;
  store: FakeIngestStore;
  log: { info: Mock<LogFn>; warn: Mock<LogFn> };
  sleeps: number[];
  deps(overrides?: Partial<IngestDeps>): IngestDeps;
}

function harness(): Harness {
  const source = new FakeFolderSource({ folder: FOLDER });
  const store = new FakeIngestStore();
  const log = { info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() };
  const sleeps: number[] = [];
  return {
    source,
    store,
    log,
    sleeps,
    deps: (overrides = {}) => ({
      source,
      store,
      folder: FOLDER,
      trustPmHeader: false,
      newMailCap: 200,
      initialBackfillDays: 0,
      now: () => NOW,
      signal: new AbortController().signal,
      log,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...overrides,
    }),
  };
}

/** Five eligible messages stored in generation 1; the watermark is the newest (1 minute ago). */
async function storedFive(): Promise<Harness> {
  const h = harness();
  await runIngest(h.deps());
  for (const minutes of [5, 4, 3, 2, 1]) h.source.append(fakeMail(ago(minutes * MINUTE)));
  await runIngest(h.deps());
  expect(h.store.messages()).toHaveLength(5);
  expect(h.store.folder(FOLDER)?.watermark).toEqual(ago(MINUTE));
  return h;
}

/** Bridge cache rebuild plus one new and one old-dated unknown message. */
function rebuildWithNewAndOld(h: Harness): { newUid: number; oldUid: number } {
  h.source.bumpUidValidity({ renumber: true });
  const newUid = h.source.append(fakeMail(NOW, { text: 'arrived during rebuild' }));
  const oldUid = h.source.append(fakeMail(ago(30 * DAY)));
  return { newUid, oldUid };
}

function eligibilityByKey(store: FakeIngestStore): Map<string, boolean> {
  return new Map(store.messages().map((m) => [m.identityKey, m.eligible]));
}

function sum(counts: { matched: number; new: number; older: number }): number {
  return counts.matched + counts.new + counts.older;
}

/** No duplicate rows and every live location in the folder's current generation. */
function expectConsistent(h: Harness, generation: number): void {
  const keys = h.store.messages().map((m) => m.identityKey);
  expect(new Set(keys).size).toBe(keys.length);
  const locs = h.store.locations().map((l) => `${l.folder}/${l.uidValidity}/${l.uid}`);
  expect(new Set(locs).size).toBe(locs.length);
  const live = h.store.liveLocationsOf(FOLDER);
  expect(live.every((l) => l.generation === generation)).toBe(true);
  expect(live.every((l) => l.uidValidity === h.source.uidValidity)).toBe(true);
  expect(live).toHaveLength(h.source.uids().length);
}

describe('plan helpers', () => {
  it('isCandidateNew is strict at watermark - overlap', () => {
    const watermark = NOW;
    expect(isCandidateNew(ago(5 * MINUTE), watermark, 5 * MINUTE)).toBe(false);
    expect(isCandidateNew(new Date(ago(5 * MINUTE).getTime() + 1), watermark, 5 * MINUTE)).toBe(
      true,
    );
  });

  it('aboveLastUid keeps UIDs above last_uid, ascending, once each', () => {
    const recs = [{ uid: 9 }, { uid: 7 }, { uid: 5 }, { uid: 9 }, { uid: 6 }];
    expect(aboveLastUid(recs, 6).map((r) => r.uid)).toEqual([7, 9]);
  });

  it('chunk slices in order and rejects a non-positive size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });

  it('backfillWindow keeps INTERNALDATE at or after since, ascending', () => {
    const since = ago(2 * DAY);
    const dates = [
      { uid: 4, internalDate: ago(DAY) },
      { uid: 1, internalDate: ago(3 * DAY) },
      { uid: 2, internalDate: since },
    ];
    expect(backfillWindow(dates, since)).toEqual([2, 4]);
  });

  it('pendingGenerationFor reuses a pending generation only for the same UIDVALIDITY', () => {
    const base: FolderState = {
      folder: FOLDER,
      uidValidity: 1,
      lastUid: 10,
      watermark: NOW,
      generation: 1,
      state: 'ok',
      pendingUidValidity: null,
      pendingGeneration: null,
      backfill: null,
    };
    expect(pendingGenerationFor(base, 2)).toEqual({ generation: 2, reuse: false });
    const pending: FolderState = {
      ...base,
      state: 'resyncing',
      pendingUidValidity: 2,
      pendingGeneration: 2,
    };
    expect(pendingGenerationFor(pending, 2)).toEqual({ generation: 2, reuse: true });
    expect(pendingGenerationFor(pending, 3)).toEqual({ generation: 3, reuse: false });
  });

  it('formatResyncLine uses thousands separators (D-25)', () => {
    expect(formatResyncLine('INBOX', { matched: 1240, new: 3, gone: 12, older: 830 })).toBe(
      'INBOX resynced: 1,240 matched, 3 new, 12 gone, 830 older than backfill window',
    );
  });
});

describe('UIDVALIDITY resync (D-22..D-25)', () => {
  it('matches known mail, ingests new mail and keeps unknown old mail historical', async () => {
    const h = await storedFive();
    const before = eligibilityByKey(h.store);
    const { newUid, oldUid } = rebuildWithNewAndOld(h);

    const outcome = await runIngest(h.deps());

    expect(outcome).toEqual({
      kind: 'resynced',
      counts: { matched: 5, new: 1, gone: 0, older: 1 },
    });
    expect(h.store.messages()).toHaveLength(7);
    for (const [key, eligible] of before) {
      expect(h.store.messageByKey(key)?.eligible).toBe(eligible);
    }
    const byUid = new Map(h.store.liveLocationsOf(FOLDER).map((l) => [l.uid, l.messageId]));
    const newMessage = h.store.messages().find((m) => m.id === byUid.get(newUid));
    const oldMessage = h.store.messages().find((m) => m.id === byUid.get(oldUid));
    expect(newMessage?.eligible).toBe(true);
    expect(h.store.bodyOf(newMessage?.id as string)?.body.text).toBe('arrived during rebuild');
    expect(oldMessage?.eligible).toBe(false);
    expect(h.store.bodyOf(oldMessage?.id as string)).toBeUndefined();

    const folder = h.store.folder(FOLDER);
    expect(folder).toMatchObject({
      state: 'ok',
      uidValidity: h.source.uidValidity,
      generation: 2,
      lastUid: oldUid,
      pendingUidValidity: null,
      pendingGeneration: null,
      lastResyncSummary: { matched: 5, new: 1, gone: 0, older: 1 },
    });
    expect(folder?.watermark).toEqual(NOW);
    expectConsistent(h, 2);
    expect(
      h.store
        .locations()
        .filter((l) => l.generation === 1)
        .every((l) => l.removedReason === 'superseded'),
    ).toBe(true);

    // The next cycle is a normal poll with nothing new.
    const before2 = h.source.calls.length;
    expect(await runIngest(h.deps())).toMatchObject({ kind: 'synced', stored: 0 });
    expect(h.source.calls.slice(before2).map((c) => c.method)).not.toContain('fetchHeaders');
  });

  it('marks the location of mail expunged before the bump vanished and counts it gone', async () => {
    const h = await storedFive();
    const [first] = h.store.liveLocationsOf(FOLDER);
    h.source.expunge(first?.uid as number);
    h.source.bumpUidValidity({ renumber: true });

    const outcome = await runIngest(h.deps());

    expect(outcome).toEqual({
      kind: 'resynced',
      counts: { matched: 4, new: 0, gone: 1, older: 0 },
    });
    const old = h.store.locations().find((l) => l.id === first?.id);
    expect(old?.removedReason).toBe('vanished');
    expect(h.store.bodyOf(first?.messageId as string)).toBeUndefined();
    expectConsistent(h, 2);
  });

  it('caps a future-dated new message at now in the settled watermark (WR-03)', async () => {
    const h = await storedFive();
    h.source.bumpUidValidity({ renumber: true });
    h.source.append(fakeMail(new Date(NOW.getTime() + 3 * DAY)));

    const outcome = await runIngest(h.deps());

    expect(outcome).toMatchObject({ kind: 'resynced', counts: { new: 1 } });
    expect(h.store.folder(FOLDER)?.watermark).toEqual(NOW);
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ folder: FOLDER, capped: 1 }),
      'INTERNALDATE ahead of the worker clock: watermark capped at now',
    );
  });

  it('logs exactly one resync line (D-25)', async () => {
    const h = await storedFive();
    rebuildWithNewAndOld(h);
    h.log.info.mockClear();

    await runIngest(h.deps());

    const counts = { matched: 5, new: 1, gone: 0, older: 1 };
    const lines = h.log.info.mock.calls.filter(([, msg]) => msg.includes('resynced'));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[1]).toBe(formatResyncLine(FOLDER, counts));
  });

  it('fetches rescan headers in batches with a pause and downloads only new mail', async () => {
    const h = await storedFive();
    const { newUid } = rebuildWithNewAndOld(h);
    const calls = h.source.calls.length;
    const sleeps = h.sleeps.length;

    await runIngest(h.deps({ resyncBatchSize: 2 }));

    const fetches = h.source.calls
      .slice(calls)
      .filter((c) => c.method === 'fetchHeaders')
      .map((c) => c.args[0] as number[]);
    expect(fetches.every((uids) => uids.length <= 2)).toBe(true);
    // Count pass: 6 date candidates = 3 batches; commit pass: 7 UIDs = 4 batches.
    expect(h.sleeps.slice(sleeps)).toEqual(Array(5).fill(BACKFILL_CHUNK_PAUSE_MS));
    const downloads = h.source.calls.slice(calls).filter((c) => c.method === 'downloadText');
    expect(downloads.map((c) => c.args[0])).toEqual([newUid]);
  });
});

describe('volume valve before any resync write (D-23, D-26)', () => {
  it('returns needs_attention having written only the resyncing flag', async () => {
    const h = await storedFive();
    h.source.bumpUidValidity({ renumber: true });
    for (let i = 0; i < 4; i += 1) h.source.append(fakeMail(NOW));
    const snapshot = {
      messages: structuredClone(h.store.messages()),
      locations: structuredClone(h.store.locations()),
      bodies: structuredClone(h.store.bodies()),
    };
    const from = h.store.events.length;

    const outcome = await runIngest(h.deps({ newMailCap: 3 }));

    expect(outcome).toEqual({ kind: 'needs_attention', candidateNew: 4 });
    const events = h.store.events.slice(from);
    expect(events).toContain('beginResync:start');
    for (const write of ['commitChunk', 'setBackfill', 'finishResync', 'markVanished']) {
      expect(events).not.toContain(`${write}:start`);
    }
    expect(h.store.messages()).toEqual(snapshot.messages);
    expect(h.store.locations()).toEqual(snapshot.locations);
    expect(h.store.bodies()).toEqual(snapshot.bodies);
    expect(h.store.folder(FOLDER)?.state).toBe('resyncing');
    expect(h.store.liveLocationsOf(FOLDER).every((l) => l.generation === 1)).toBe(true);
    expect(h.store.liveLocationsOf(FOLDER)).toHaveLength(5);

    const approved = await runIngest(h.deps({ newMailCap: 4 }));
    expect(approved).toEqual({
      kind: 'resynced',
      counts: { matched: 5, new: 4, gone: 0, older: 0 },
    });
    expectConsistent(h, 2);
  });

  it('does not count known messages inside the overlap toward the cap', async () => {
    const h = await storedFive();
    h.source.bumpUidValidity({ renumber: true });

    const outcome = await runIngest(h.deps({ newMailCap: 1 }));

    expect(outcome).toEqual({
      kind: 'resynced',
      counts: { matched: 5, new: 0, gone: 0, older: 0 },
    });
  });
});

describe('crash and retry at every resync boundary (D-23, D-25)', () => {
  type Row = {
    name: string;
    arm(h: Harness, controller: AbortController): void;
    overrides?: Partial<IngestDeps>;
    retried: { matched: number; new: number; gone: number; older: number };
  };
  const exact = { matched: 5, new: 1, gone: 0, older: 1 };
  const rows: Row[] = [
    {
      name: 'a header fetch of the count pass',
      arm: (h) => h.source.failOn('fetchHeaders', 1),
      retried: exact,
    },
    {
      name: 'the first commit batch',
      arm: (h) => h.store.failOn('commitChunk', 1),
      retried: exact,
    },
    {
      name: 'a new-mail chunk',
      arm: (h) => h.store.failOn('commitChunk', 2),
      retried: { matched: 6, new: 1, gone: 0, older: 0 },
    },
    {
      name: 'finishResync',
      arm: (h) => h.store.failOn('finishResync', 1),
      retried: { matched: 7, new: 0, gone: 0, older: 0 },
    },
    {
      name: 'an abort between two commit batches',
      arm: () => {},
      overrides: { resyncBatchSize: 3 },
      retried: exact,
    },
  ];

  it.each(rows)('fails at $name, keeps generation 1 in charge, then completes', async (row) => {
    const h = await storedFive();
    const before = eligibilityByKey(h.store);
    rebuildWithNewAndOld(h);
    const controller = new AbortController();
    row.arm(h, controller);
    let sleepCalls = 0;
    const failing = h.deps({
      ...row.overrides,
      signal: controller.signal,
      // The count pass has 2 batches (1 pause), so the 2nd pause is in the commit pass.
      sleep: async () => {
        sleepCalls += 1;
        if (row.name.startsWith('an abort') && sleepCalls === 2) controller.abort();
      },
    });

    let outcome: Awaited<ReturnType<typeof runIngest>> | undefined;
    let error: unknown;
    try {
      outcome = await runIngest(failing);
    } catch (err) {
      error = err;
    }
    if (row.name.startsWith('an abort')) expect(outcome?.kind).toBe('aborted');
    else expect(error).toBeInstanceOf(Error);

    const folder = h.store.folder(FOLDER);
    expect(folder).toMatchObject({ state: 'resyncing', generation: 1, pendingGeneration: 2 });
    const gen1 = h.store.locations().filter((l) => l.generation === 1);
    expect(gen1).toHaveLength(5);
    expect(gen1.every((l) => l.removedAt === null)).toBe(true);
    for (const message of h.store.messages()) {
      const locations = h.store.locations().filter((l) => l.messageId === message.id);
      if (locations.some((l) => l.generation === 1)) {
        expect(locations.some((l) => l.generation === 1 && l.removedAt === null)).toBe(true);
      }
    }

    const begins = h.store.count('beginResync');
    const retry = await runIngest(h.deps(row.overrides));

    expect(retry).toEqual({ kind: 'resynced', counts: row.retried });
    expect(sum(row.retried)).toBe(7);
    expect(h.store.count('beginResync')).toBe(begins);
    expect(h.store.folder(FOLDER)).toMatchObject({ state: 'ok', generation: 2 });
    expect(h.store.messages()).toHaveLength(7);
    for (const [key, eligible] of before) {
      expect(h.store.messageByKey(key)?.eligible).toBe(eligible);
    }
    expectConsistent(h, 2);
  });

  it('uses a fresh generation when UIDVALIDITY changes again before the retry', async () => {
    const h = await storedFive();
    rebuildWithNewAndOld(h);
    h.store.failOn('commitChunk', 2);
    await expect(runIngest(h.deps())).rejects.toThrow();
    const stale = h.store.locations().filter((l) => l.generation === 2);
    expect(stale.length).toBeGreaterThan(0);

    h.source.bumpUidValidity({ renumber: true });
    const outcome = await runIngest(h.deps());

    expect(outcome.kind).toBe('resynced');
    if (outcome.kind === 'resynced') expect(sum(outcome.counts)).toBe(7);
    expect(h.store.folder(FOLDER)).toMatchObject({ state: 'ok', generation: 3 });
    for (const location of h.store.locations().filter((l) => l.generation === 2)) {
      expect(['superseded', 'vanished']).toContain(location.removedReason);
    }
    expect(h.store.messages()).toHaveLength(7);
    expectConsistent(h, 3);
  });
});

describe('resync during a pending first backfill (D-75)', () => {
  it('recomputes the cursor in finishResync and promotes the rest in later slices', async () => {
    const h = harness();
    for (const days of [5, 4, 3, 2, 1]) h.source.append(fakeMail(ago(days * DAY)));
    const deps = () => h.deps({ initialBackfillDays: 30, backfillSliceSize: 2 });
    await runIngest(deps());
    expect(h.store.messages().filter((m) => m.eligible)).toHaveLength(2);
    const since = h.store.folder(FOLDER)?.backfill?.since;

    h.source.bumpUidValidity({ renumber: true });
    const from = h.store.events.length;
    const outcome = await runIngest(deps());

    expect(outcome).toEqual({
      kind: 'resynced',
      counts: { matched: 2, new: 0, gone: 0, older: 3 },
    });
    expect(h.store.events.slice(from)).not.toContain('setBackfill:start');
    expect(h.store.folder(FOLDER)?.backfill).toEqual({
      since,
      cursorUid: 0,
      untilUid: h.source.uidNext - 1,
      total: 5,
    });

    for (let i = 0; i < 3; i += 1) await runIngest(deps());

    expect(h.store.folder(FOLDER)?.backfill).toBeNull();
    expect(h.store.messages()).toHaveLength(5);
    expect(h.store.messages().every((m) => m.eligible)).toBe(true);
    expect(h.store.bodies()).toHaveLength(5);
    expectConsistent(h, 2);
  });

  it('resets the progress to the restarted window after finishResync (WR-06)', async () => {
    const h = harness();
    for (const days of [5, 4, 3, 2, 1]) h.source.append(fakeMail(ago(days * DAY)));
    const progress: { done: number; total: number; finished: boolean }[] = [];
    const deps = () =>
      h.deps({
        initialBackfillDays: 30,
        backfillSliceSize: 2,
        onBackfillProgress: async (p) => {
          progress.push(p);
          h.store.events.push('progress');
        },
      });
    await runIngest(deps());
    h.source.bumpUidValidity({ renumber: true });
    progress.length = 0;
    const from = h.store.events.length;

    await runIngest(deps());

    expect(progress).toEqual([{ done: 0, total: 5, finished: false }]);
    const events = h.store.events.slice(from);
    expect(events).toContain('finishResync:end');
    expect(events.indexOf('progress')).toBeGreaterThan(events.indexOf('finishResync:end'));
  });

  it('clears the progress when the window has no message under the new UIDVALIDITY (WR-06)', async () => {
    const h = harness();
    for (const days of [5, 4, 3]) h.source.append(fakeMail(ago(days * DAY)));
    const progress: { done: number; total: number; finished: boolean }[] = [];
    const deps = () =>
      h.deps({
        initialBackfillDays: 30,
        backfillSliceSize: 1,
        onBackfillProgress: async (p) => {
          progress.push(p);
        },
      });
    await runIngest(deps());
    expect(h.store.folder(FOLDER)?.backfill).not.toBeNull();
    // Bridge rebuilds the folder and the window's mail is gone.
    for (const uid of h.source.uids()) h.source.expunge(uid);
    h.source.bumpUidValidity({ renumber: true });
    progress.length = 0;

    expect(await runIngest(deps())).toMatchObject({ kind: 'resynced' });

    expect(h.store.folder(FOLDER)?.backfill).toBeNull();
    expect(progress).toEqual([{ done: 0, total: 0, finished: true }]);
  });
});
