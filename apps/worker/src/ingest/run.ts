import { BODY_DOWNLOAD_MAX_BYTES, parseMessage, selectTextPart, toBodyText } from './message.ts';
import {
  aboveLastUid,
  backfillWindow,
  chunk,
  formatResyncLine,
  isCandidateNew,
  pendingGenerationFor,
} from './plan.ts';
import type {
  BackfillState,
  BodyText,
  FolderSource,
  FolderState,
  FolderStatus,
  HeaderRecord,
  IngestLog,
  IngestOutcome,
  IngestStore,
  MessageRecord,
  ResyncCounts,
  UidDate,
} from './types.ts';

/**
 * The sync engine (02-10): pure orchestration over FolderSource and
 * IngestStore. No IMAP client or database import, so every rule is tested with
 * in-memory fakes; the adapter (02-09) and the database store (02-13) stay thin.
 *
 * Logs carry folder names, counts and timestamps only: never subjects,
 * addresses, identity keys or body text (T-02-37).
 */

/** Messages per committed chunk (D-04). */
export const CHUNK_SIZE = 50;
/** UIDs per header FETCH batch of a resync rescan (D-22). */
export const RESYNC_BATCH_SIZE = 500;
/** Overlap below the INTERNALDATE watermark that still counts as candidate-new (D-19). */
export const WATERMARK_OVERLAP_MS = 300_000;
/** First-backfill messages processed per cycle (D-75 throttle). */
export const BACKFILL_SLICE_SIZE = 200;
/** Pause between first-backfill chunks and between resync batches (D-75 throttle). */
export const BACKFILL_CHUNK_PAUSE_MS = 250;
/**
 * Tolerated lag of the server's clock behind the worker's at first sync: the
 * first watermark is never older than now minus this (with the overlap, mail
 * dated up to 15 minutes behind the worker's clock still counts as new; D-83).
 */
export const FIRST_SYNC_CLOCK_ALLOWANCE_MS = 600_000;
/**
 * D-17 "periodic" removal diff: 02-13 passes removalDiff true at most this
 * often per mailbox, so a normal poll does not search the whole folder.
 */
export const REMOVAL_DIFF_INTERVAL_MS = 600_000;

const DAY_MS = 86_400_000;

export interface IngestDeps {
  source: FolderSource;
  store: IngestStore;
  folder: string;
  trustPmHeader: boolean;
  /** ingest.new_mail_cap (+ an owner-approved count after a resume); polling and resync only (D-26). */
  newMailCap: number;
  /** ingest.initial_backfill_days; read only when the folder has no state yet; 0 = none (D-74). */
  initialBackfillDays: number;
  now(): Date;
  signal: AbortSignal;
  log: IngestLog;
  /** Run the D-17 removal diff this cycle (default true); 02-13 passes its cadence decision. */
  removalDiff?: boolean;
  /** Throttle pause; tests inject a no-op. */
  sleep?(ms: number): Promise<void>;
  /** First-backfill progress; awaited only after the chunk's commitChunk resolved. */
  onBackfillProgress?(p: { done: number; total: number; finished: boolean }): Promise<void>;
  chunkSize?: number;
  resyncBatchSize?: number;
  overlapMs?: number;
  backfillSliceSize?: number;
  backfillPauseMs?: number;
}

type BackfillProgress = { done: number; total: number; finished: boolean };

interface Settings {
  chunkSize: number;
  resyncBatchSize: number;
  overlapMs: number;
  backfillSliceSize: number;
  backfillPauseMs: number;
  sleep(ms: number): Promise<void>;
}

function settings(deps: IngestDeps): Settings {
  return {
    chunkSize: deps.chunkSize ?? CHUNK_SIZE,
    resyncBatchSize: deps.resyncBatchSize ?? RESYNC_BATCH_SIZE,
    overlapMs: deps.overlapMs ?? WATERMARK_OVERLAP_MS,
    backfillSliceSize: deps.backfillSliceSize ?? BACKFILL_SLICE_SIZE,
    backfillPauseMs: deps.backfillPauseMs ?? BACKFILL_CHUNK_PAUSE_MS,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

function laterOf(a: Date, b: Date): Date {
  return b.getTime() > a.getTime() ? b : a;
}

/**
 * Caps INTERNALDATEs at the worker's clock before they reach a watermark
 * (WR-03). One message dated in the future (a server clock jump, an APPEND
 * with a forward date) would otherwise fix the watermark there and make all
 * later mail historical until real time caught up. Mail dated up to the
 * overlap behind the capped watermark still counts as new (D-19). report()
 * logs one warning per cycle with counts and timestamps only.
 */
function clockCap(deps: IngestDeps): { cap(d: Date): Date; report(): void } {
  let capped = 0;
  let latest: Date | null = null;
  return {
    cap(d) {
      const now = deps.now();
      if (d.getTime() <= now.getTime()) return d;
      capped += 1;
      latest = latest === null ? d : laterOf(latest, d);
      return now;
    },
    report() {
      if (latest === null) return;
      deps.log.warn(
        {
          folder: deps.folder,
          capped,
          latestInternalDate: latest.toISOString(),
          now: deps.now().toISOString(),
        },
        'INTERNALDATE ahead of the worker clock: watermark capped at now',
      );
    },
  };
}

/** Largest value; a loop, because spreading a folder's UIDs into Math.max can overflow the stack. */
function maxOf(values: Iterable<number>): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) if (v > max) max = v;
  return max;
}

function minOf(values: Iterable<number>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const v of values) if (v < min) min = v;
  return min;
}

/**
 * INTERNALDATEs of the given UIDs (each once, ascending), fetched over their
 * min:max range and narrowed to the set.
 */
async function datesOf(source: FolderSource, uids: readonly number[]): Promise<UidDate[]> {
  if (uids.length === 0) return [];
  const wanted = new Set(uids);
  const fetched = await source.fetchDates(`${minOf(wanted)}:${maxOf(wanted)}`);
  const byUid = new Map<number, UidDate>();
  for (const d of fetched) if (wanted.has(d.uid) && !byUid.has(d.uid)) byUid.set(d.uid, d);
  return [...byUid.values()].sort((a, b) => a.uid - b.uid);
}

/** Exact backfill window since `since`: SEARCH SINCE (day-granular), then the fetched dates. */
async function windowSince(source: FolderSource, since: Date): Promise<UidDate[]> {
  const searched = await source.searchSince(since);
  const dates = await datesOf(source, searched);
  const inWindow = new Set(backfillWindow(dates, since));
  return dates.filter((d) => inWindow.has(d.uid));
}

/** Header records of `uids` that are still present, ascending, each once. */
async function headersOf(source: FolderSource, uids: readonly number[]): Promise<HeaderRecord[]> {
  const wanted = new Set(uids);
  const byUid = new Map<number, HeaderRecord>();
  for (const rec of await source.fetchHeaders(uids)) {
    if (wanted.has(rec.uid) && !byUid.has(rec.uid)) byUid.set(rec.uid, rec);
  }
  return [...byUid.values()].sort((a, b) => a.uid - b.uid);
}

/** Body of an eligible message (D-06): the selected text part, or source `none`. */
async function bodyOf(source: FolderSource, rec: HeaderRecord): Promise<BodyText> {
  const part = selectTextPart(rec.bodyStructure);
  if (part === null) return toBodyText(null, null);
  const download = await source.downloadText(rec.uid, part.part, BODY_DOWNLOAD_MAX_BYTES);
  return toBodyText(download, part.kind);
}

/**
 * Message records for a chunk. Eligible messages get their body; historical
 * ones get none (D-21), so no text is downloaded for them.
 */
async function recordsOf(
  deps: IngestDeps,
  headers: readonly HeaderRecord[],
  eligible: (rec: HeaderRecord) => boolean,
): Promise<MessageRecord[]> {
  const out: MessageRecord[] = [];
  for (const rec of headers) {
    const parsed = parseMessage(rec, { trustPmHeader: deps.trustPmHeader });
    const isEligible = eligible(rec);
    out.push({
      parsed,
      uid: rec.uid,
      eligible: isEligible,
      body: isEligible ? await bodyOf(deps.source, rec) : null,
    });
  }
  return out;
}

/**
 * First sync of a folder (D-18, D-20, D-74, D-75, D-83). The start point is
 * UIDNEXT - 1. The watermark is the newest INTERNALDATE the server reports,
 * but never older than now - FIRST_SYNC_CLOCK_ALLOWANCE_MS: a lagging server
 * clock then cannot turn mail arriving after startup into history, while an
 * old message moved back into a quiet folder still stays historical.
 */
async function firstSync(deps: IngestDeps, status: FolderStatus): Promise<FolderState> {
  const now = deps.now();
  const days = deps.initialBackfillDays;
  let backfill: BackfillState | null = null;
  let newest: Date | null = null;

  if (status.exists > 0) {
    if (days > 0) {
      const since = new Date(now.getTime() - days * DAY_MS);
      const window = (await windowSince(deps.source, since)).filter(
        (d) => d.uid <= status.uidNext - 1,
      );
      for (const d of window)
        newest = newest === null ? d.internalDate : laterOf(newest, d.internalDate);
      const first = window[0];
      if (first !== undefined) {
        backfill = {
          since,
          cursorUid: first.uid - 1,
          untilUid: status.uidNext - 1,
          total: window.length,
        };
      }
    }
    for (const d of await deps.source.fetchDates('*')) {
      newest = newest === null ? d.internalDate : laterOf(newest, d.internalDate);
    }
  }

  const floor = new Date(now.getTime() - FIRST_SYNC_CLOCK_ALLOWANCE_MS);
  const clock = clockCap(deps);
  const watermark = newest === null ? floor : laterOf(clock.cap(newest), floor);
  clock.report();
  deps.log.info(
    {
      folder: deps.folder,
      watermark: watermark.toISOString(),
      watermarkAgeSeconds: Math.round((now.getTime() - watermark.getTime()) / 1000),
    },
    'first sync watermark',
  );
  return deps.store.createFolder({
    folder: deps.folder,
    uidValidity: status.uidValidity,
    lastUid: status.uidNext - 1,
    watermark,
    backfill,
  });
}

/**
 * New mail since last_uid (ING-02, ING-03, D-04, D-18..D-21). Records at or
 * below last_uid that `n:*` returns are dropped; each record is eligible only
 * when its INTERNALDATE is after (cycle-start watermark - overlap). Chunks are
 * committed in ascending UID order, each advancing last_uid to its highest UID
 * and the watermark (forward only) to the latest eligible INTERNALDATE.
 */
async function pollNewMail(
  deps: IngestDeps,
  s: Settings,
  state: FolderState,
  status: FolderStatus,
): Promise<
  | { kind: 'done'; stored: number; historical: number }
  | { kind: 'aborted'; stored: number }
  | { kind: 'needs_attention'; candidateNew: number }
> {
  let stored = 0;
  let historical = 0;
  if (status.uidNext <= state.lastUid + 1) return { kind: 'done', stored, historical };

  const dates = aboveLastUid(await deps.source.fetchDates(`${state.lastUid + 1}:*`), state.lastUid);
  // A watermark stored ahead of the clock (before WR-03) is read as now.
  const clock = clockCap(deps);
  const startWatermark = clock.cap(state.watermark);
  const isNew = (d: { internalDate: Date }) =>
    isCandidateNew(d.internalDate, startWatermark, s.overlapMs);
  const newUids = new Set(dates.filter(isNew).map((d) => d.uid));

  // Volume valve (D-26): checked from dates alone, before any header fetch or write.
  if (newUids.size > deps.newMailCap) {
    deps.log.warn(
      { folder: state.folder, candidateNew: newUids.size, cap: deps.newMailCap },
      'new mail over cap: mailbox needs attention',
    );
    return { kind: 'needs_attention', candidateNew: newUids.size };
  }

  let watermark = startWatermark;
  for (const part of chunk(
    dates.map((d) => d.uid),
    s.chunkSize,
  )) {
    if (deps.signal.aborted) return { kind: 'aborted', stored: stored + historical };
    const records = await recordsOf(deps, await headersOf(deps.source, part), (rec) =>
      newUids.has(rec.uid),
    );
    for (const r of records) {
      if (r.eligible) watermark = laterOf(watermark, clock.cap(r.parsed.internalDate));
    }
    await deps.store.commitChunk(state.folder, state.uidValidity, state.generation, records, {
      lastUid: maxOf(part),
      watermark,
    });
    stored += records.filter((r) => r.eligible).length;
    historical += records.filter((r) => !r.eligible).length;
  }
  clock.report();
  return { kind: 'done', stored, historical };
}

/**
 * Removal diff (D-07, D-17): live locations of the current UIDVALIDITY and
 * generation with UIDs at or below the cycle-start last_uid are compared with
 * one UID SEARCH over minLiveUid:maxLiveUid; the missing ones are marked
 * vanished, which deletes their never-classified bodies. A failed search
 * throws (02-09), so it can never look like every message vanished.
 */
async function removedLocations(deps: IngestDeps, state: FolderState): Promise<number> {
  const live = (await deps.store.liveLocations(state.folder)).filter(
    (l) =>
      l.uidValidity === state.uidValidity &&
      l.generation === state.generation &&
      l.uid <= state.lastUid,
  );
  if (live.length === 0) return 0;
  const uids = live.map((l) => l.uid);
  const present = new Set(
    await deps.source.listUids(`${minOf(uids)}:${Math.min(maxOf(uids), state.lastUid)}`),
  );
  const gone = live.filter((l) => !present.has(l.uid)).map((l) => l.id);
  if (gone.length === 0) return 0;
  return deps.store.markVanished(gone);
}

/**
 * One slice of the folder's first backfill (D-75): at most backfillSliceSize
 * window messages above the cursor, stored as eligible with bodies (promoting
 * historical rows), in chunks with a pause between them. Never capped. Progress
 * is reported only after the chunk's commit resolved, so no store call and
 * progress write are ever in flight together (02-13 runs both on one session).
 */
async function backfillSlice(
  deps: IngestDeps,
  s: Settings,
  state: FolderState,
  backfill: BackfillState,
): Promise<{ kind: 'done'; progress: BackfillProgress } | { kind: 'aborted'; stored: number }> {
  const window = (await windowSince(deps.source, backfill.since))
    .map((d) => d.uid)
    .filter((uid) => uid > backfill.cursorUid && uid <= backfill.untilUid);
  const total = backfill.total;
  let remaining = window.length;
  let progress: BackfillProgress = { done: Math.max(0, total - remaining), total, finished: false };
  let stored = 0;

  const parts = chunk(window.slice(0, s.backfillSliceSize), s.chunkSize);
  for (const [i, part] of parts.entries()) {
    if (i > 0) await s.sleep(s.backfillPauseMs);
    if (deps.signal.aborted) return { kind: 'aborted', stored };
    const records = await recordsOf(deps, await headersOf(deps.source, part), () => true);
    await deps.store.commitChunk(
      state.folder,
      state.uidValidity,
      state.generation,
      records,
      { backfillCursorUid: maxOf(part) },
      { promoteEligible: true },
    );
    stored += records.length;
    remaining -= part.length;
    progress = { done: Math.max(0, total - remaining), total, finished: false };
    if (remaining > 0) await deps.onBackfillProgress?.(progress);
  }

  if (remaining === 0) {
    await deps.store.setBackfill(state.folder, null);
    progress = { done: total, total, finished: true };
    await deps.onBackfillProgress?.(progress);
  }
  return { kind: 'done', progress };
}

/**
 * UIDVALIDITY resync (D-22..D-26, D-75), all-or-nothing through generations.
 *
 * beginResync (skipped on a retry toward the same UIDVALIDITY) writes only the
 * folder's resyncing flag and pending columns. Then:
 * 1. Count pass, no writes: INTERNALDATE for every listed UID; headers and
 *    knownIdentities only for the date candidates. Unknown candidates above
 *    the cap stop here, so generation N stays the only live generation.
 * 2. Commit pass: headers of every UID in batches; known keys gain a location
 *    at the pending generation, unknown old mail is stored historical, unknown
 *    candidate-new UIDs are collected.
 * 3. The new mail is processed like polled mail (bodies), in chunks.
 * 4. finishResync switches generations in one transaction, together with the
 *    first-backfill cursor recomputed under the new UIDVALIDITY.
 * A failure or abort at any point leaves the previous generation in charge;
 * the next run starts over. Rows an earlier attempt stored are known by then
 * and count as matched, so matched + new + older still equals the mail seen.
 * Nothing is reclassified: eligibility of stored messages never changes here.
 */
async function resync(
  deps: IngestDeps,
  s: Settings,
  state: FolderState,
  status: FolderStatus,
): Promise<IngestOutcome> {
  const folder = state.folder;
  const uidValidity = status.uidValidity;
  const { generation, reuse } = pendingGenerationFor(state, uidValidity);
  if (!reuse) await deps.store.beginResync(folder, uidValidity, generation);

  // 1. Count pass (no store writes).
  const listed = [...new Set(await deps.source.listUids('1:*'))].sort((a, b) => a - b);
  const listedSet = new Set(listed);
  const byUid = new Map<number, UidDate>();
  if (listed.length > 0) {
    for (const d of await deps.source.fetchDates('1:*')) {
      if (listedSet.has(d.uid) && !byUid.has(d.uid)) byUid.set(d.uid, d);
    }
  }
  const dates = [...byUid.values()].sort((a, b) => a.uid - b.uid);
  const clock = clockCap(deps);
  const startWatermark = clock.cap(state.watermark);
  const candidates = new Set(
    dates
      .filter((d) => isCandidateNew(d.internalDate, startWatermark, s.overlapMs))
      .map((d) => d.uid),
  );
  let candidateNew = 0;
  for (const [i, part] of chunk([...candidates], s.resyncBatchSize).entries()) {
    if (i > 0) await s.sleep(s.backfillPauseMs);
    if (deps.signal.aborted) return { kind: 'aborted', stored: 0 };
    const parsed = (await headersOf(deps.source, part)).map((rec) =>
      parseMessage(rec, { trustPmHeader: deps.trustPmHeader }),
    );
    const known = await deps.store.knownIdentities(parsed.map((p) => p.identityKey));
    candidateNew += parsed.filter((p) => !known.has(p.identityKey)).length;
  }
  if (candidateNew > deps.newMailCap) {
    deps.log.warn(
      { folder, candidateNew, cap: deps.newMailCap },
      'resync over new-mail cap: mailbox needs attention',
    );
    return { kind: 'needs_attention', candidateNew };
  }

  // 2. Commit pass: locations for known mail, historical rows for unknown old mail.
  const counts: Omit<ResyncCounts, 'gone'> = { matched: 0, new: 0, older: 0 };
  const newUids: number[] = [];
  let committed = 0;
  for (const [i, part] of chunk(listed, s.resyncBatchSize).entries()) {
    if (i > 0) await s.sleep(s.backfillPauseMs);
    if (deps.signal.aborted) return { kind: 'aborted', stored: committed };
    const headers = await headersOf(deps.source, part);
    const parsed = headers.map((rec) => parseMessage(rec, { trustPmHeader: deps.trustPmHeader }));
    const known = await deps.store.knownIdentities(parsed.map((p) => p.identityKey));
    const records: MessageRecord[] = [];
    for (const [j, rec] of headers.entries()) {
      const message = parsed[j] as (typeof parsed)[number];
      if (known.has(message.identityKey)) counts.matched += 1;
      else if (candidates.has(rec.uid)) {
        newUids.push(rec.uid);
        continue;
      } else counts.older += 1;
      records.push({ parsed: message, uid: rec.uid, eligible: false, body: null });
    }
    if (records.length === 0) continue;
    await deps.store.commitChunk(folder, uidValidity, generation, records, null);
    committed += records.length;
  }

  // 3. New mail, with bodies.
  let watermark = startWatermark;
  for (const part of chunk(newUids, s.chunkSize)) {
    if (deps.signal.aborted) return { kind: 'aborted', stored: committed };
    const records = await recordsOf(deps, await headersOf(deps.source, part), () => true);
    for (const r of records) watermark = laterOf(watermark, clock.cap(r.parsed.internalDate));
    await deps.store.commitChunk(folder, uidValidity, generation, records, null);
    counts.new += records.length;
    committed += records.length;
  }

  // 4. A pending first backfill restarts under the new UIDVALIDITY, in the same transaction.
  let backfill: { backfill: BackfillState | null } | Record<string, never> = {};
  if (state.backfill !== null) {
    const window = backfillWindow(dates, state.backfill.since);
    const first = window[0];
    backfill = {
      backfill:
        first === undefined
          ? null
          : {
              since: state.backfill.since,
              cursorUid: first - 1,
              untilUid: status.uidNext - 1,
              total: window.length,
            },
    };
  }

  if (deps.signal.aborted) return { kind: 'aborted', stored: committed };
  const result = await deps.store.finishResync(folder, {
    uidValidity,
    generation,
    lastUid: Math.max(status.uidNext - 1, maxOf(listed)),
    watermark,
    counts,
    ...backfill,
  });
  deps.log.info({ folder, ...result }, formatResyncLine(folder, result));
  clock.report();
  return { kind: 'resynced', counts: result };
}

/**
 * One ingest cycle of one folder: first sync when the folder has no state,
 * a resync when UIDVALIDITY changed or a resync is pending, otherwise new mail
 * (behind the volume valve), the removal diff when due, a slice of the first
 * backfill, and the body-cache sweep. `aborted.stored` counts the records this
 * cycle committed before it stopped.
 */
export async function runIngest(deps: IngestDeps): Promise<IngestOutcome> {
  const s = settings(deps);
  if (deps.signal.aborted) return { kind: 'aborted', stored: 0 };

  const status = await deps.source.examine(deps.folder);
  let state = await deps.store.getFolder(deps.folder);
  const isFirstSync = state === null;
  if (state === null) state = await firstSync(deps, status);

  if (state.state === 'resyncing' || state.uidValidity !== status.uidValidity) {
    return resync(deps, s, state, status);
  }

  const polled = await pollNewMail(deps, s, state, status);
  if (polled.kind !== 'done') return polled;
  const committed = polled.stored + polled.historical;

  let vanished = 0;
  if (deps.removalDiff ?? true) {
    if (deps.signal.aborted) return { kind: 'aborted', stored: committed };
    vanished = await removedLocations(deps, state);
  }

  // The first backfill runs after the cycle's new-mail work and outside the valve (D-75).
  let backfill: BackfillProgress | null = null;
  if (state.backfill !== null) {
    if (deps.signal.aborted) return { kind: 'aborted', stored: committed };
    const slice = await backfillSlice(deps, s, state, state.backfill);
    if (slice.kind === 'aborted') return { kind: 'aborted', stored: committed + slice.stored };
    backfill = slice.progress;
  }

  await deps.store.deleteExpiredBodies(deps.now());
  return {
    kind: 'synced',
    firstSync: isFirstSync,
    stored: polled.stored,
    historical: polled.historical,
    vanished,
    backfill,
  };
}

/** Why a CLI backfill was refused (D-75). */
export class BackfillRefusedError extends Error {
  readonly reason: 'resyncing' | 'not_synced';

  constructor(reason: 'resyncing' | 'not_synced', folder: string) {
    super(
      reason === 'resyncing'
        ? `folder ${folder} is resyncing; run the backfill after the resync completes`
        : `folder ${folder} has not been synced yet; run the worker first`,
    );
    this.name = 'BackfillRefusedError';
    this.reason = reason;
  }
}

/**
 * What the owner is asked to confirm (D-75): the exact UIDs (ascending) with
 * INTERNALDATE since `since`, under the UIDVALIDITY they were counted in.
 */
export interface BackfillPlan {
  count: number;
  since: Date;
  uids: number[];
  uidValidity: number;
}

export type BackfillOutcome =
  | { kind: 'backfilled'; found: number; inserted: number; existing: number }
  | { kind: 'aborted'; inserted: number };

/**
 * The folder state a CLI backfill may run against: synced, not resyncing, and
 * still under the UIDVALIDITY the folder was synced in (otherwise a resync is
 * due and the UIDs are stale, D-24).
 */
async function backfillState(
  deps: IngestDeps,
): Promise<{ state: FolderState; status: FolderStatus }> {
  const state = await deps.store.getFolder(deps.folder);
  if (state === null) throw new BackfillRefusedError('not_synced', deps.folder);
  if (state.state === 'resyncing') throw new BackfillRefusedError('resyncing', deps.folder);
  const status = await deps.source.examine(deps.folder);
  if (status.uidValidity !== state.uidValidity) {
    throw new BackfillRefusedError('resyncing', deps.folder);
  }
  return { state, status };
}

/**
 * Count step of the CLI backfill (D-75): the messages with INTERNALDATE in the
 * last `days` days. No store writes; the CLI shows the count and asks first.
 */
export async function countBackfill(deps: IngestDeps, days: number): Promise<BackfillPlan> {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`backfill days must be a positive integer, got ${days}`);
  }
  const { status } = await backfillState(deps);
  const since = new Date(deps.now().getTime() - days * DAY_MS);
  const uids = (await windowSince(deps.source, since)).map((d) => d.uid);
  return { count: uids.length, since, uids, uidValidity: status.uidValidity };
}

/**
 * Run step of the CLI backfill (D-75): exactly the counted UIDs that are still
 * present, stored as eligible with bodies (promoting historical rows), in
 * committed chunks with an abort check between them. Not capped, because the
 * owner confirmed this count; last_uid, the watermark and the first-backfill
 * cursor do not move.
 */
export async function runBackfill(deps: IngestDeps, plan: BackfillPlan): Promise<BackfillOutcome> {
  const s = settings(deps);
  const { state } = await backfillState(deps);
  if (plan.uidValidity !== state.uidValidity) {
    throw new BackfillRefusedError('resyncing', deps.folder);
  }
  let found = 0;
  let inserted = 0;
  let existing = 0;
  const uids = [...new Set(plan.uids)].sort((a, b) => a - b);
  for (const part of chunk(uids, s.chunkSize)) {
    if (deps.signal.aborted) return { kind: 'aborted', inserted };
    const records = await recordsOf(deps, await headersOf(deps.source, part), () => true);
    if (records.length === 0) continue;
    const result = await deps.store.commitChunk(
      state.folder,
      state.uidValidity,
      state.generation,
      records,
      null,
      { promoteEligible: true },
    );
    found += records.length;
    inserted += result.inserted;
    existing += result.existing;
  }
  return { kind: 'backfilled', found, inserted, existing };
}
