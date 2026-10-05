import { BODY_DOWNLOAD_MAX_BYTES, parseMessage, selectTextPart, toBodyText } from './message.ts';
import { aboveLastUid, backfillWindow, chunk, isCandidateNew } from './plan.ts';
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

function maxOf(values: readonly number[]): number {
  return values.reduce((max, v) => (v > max ? v : max), Number.NEGATIVE_INFINITY);
}

/**
 * INTERNALDATEs of the given UIDs (each once, ascending), fetched over their
 * min:max range and narrowed to the set.
 */
async function datesOf(source: FolderSource, uids: readonly number[]): Promise<UidDate[]> {
  if (uids.length === 0) return [];
  const wanted = new Set(uids);
  const fetched = await source.fetchDates(`${Math.min(...wanted)}:${Math.max(...wanted)}`);
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
  const watermark = newest === null ? floor : laterOf(newest, floor);
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
  { kind: 'done'; stored: number; historical: number } | { kind: 'aborted'; stored: number }
> {
  let stored = 0;
  let historical = 0;
  if (status.uidNext <= state.lastUid + 1) return { kind: 'done', stored, historical };

  const dates = aboveLastUid(await deps.source.fetchDates(`${state.lastUid + 1}:*`), state.lastUid);
  const startWatermark = state.watermark;
  const isNew = (d: { internalDate: Date }) =>
    isCandidateNew(d.internalDate, startWatermark, s.overlapMs);
  const newUids = new Set(dates.filter(isNew).map((d) => d.uid));

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
      if (r.eligible) watermark = laterOf(watermark, r.parsed.internalDate);
    }
    await deps.store.commitChunk(state.folder, state.uidValidity, state.generation, records, {
      lastUid: maxOf(part),
      watermark,
    });
    stored += records.filter((r) => r.eligible).length;
    historical += records.filter((r) => !r.eligible).length;
  }
  return { kind: 'done', stored, historical };
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
 * One ingest cycle of one folder: first sync when the folder has no state,
 * then new mail, then a slice of the first backfill.
 */
export async function runIngest(deps: IngestDeps): Promise<IngestOutcome> {
  const s = settings(deps);
  if (deps.signal.aborted) return { kind: 'aborted', stored: 0 };

  const status = await deps.source.examine(deps.folder);
  let state = await deps.store.getFolder(deps.folder);
  const isFirstSync = state === null;
  if (state === null) state = await firstSync(deps, status);

  if (state.state === 'resyncing' || state.uidValidity !== status.uidValidity) {
    throw new Error(`folder ${deps.folder} needs a resync`);
  }

  const polled = await pollNewMail(deps, s, state, status);
  if (polled.kind === 'aborted') return polled;

  let backfill: BackfillProgress | null = null;
  if (state.backfill !== null) {
    if (deps.signal.aborted) return { kind: 'aborted', stored: polled.stored + polled.historical };
    const slice = await backfillSlice(deps, s, state, state.backfill);
    if (slice.kind === 'aborted') {
      return { kind: 'aborted', stored: polled.stored + polled.historical + slice.stored };
    }
    backfill = slice.progress;
  }

  return {
    kind: 'synced',
    firstSync: isFirstSync,
    stored: polled.stored,
    historical: polled.historical,
    vanished: 0,
    backfill,
  };
}
