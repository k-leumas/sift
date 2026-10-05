import type { FolderState, ResyncCounts, UidDate } from './types.ts';

/**
 * Pure decision helpers of the sync engine (02-10). No I/O: run.ts feeds them
 * what the FolderSource and IngestStore returned.
 */

/**
 * Whether a message counts as candidate-new mail (D-18, D-19): its INTERNALDATE
 * is strictly later than (watermark - overlap). Equal to the boundary or older
 * is historical (D-21). INTERNALDATE, not the Date header, because the sender
 * cannot forge it; an old message moved back into the folder keeps its date and
 * stays historical (D-20).
 */
export function isCandidateNew(internalDate: Date, watermark: Date, overlapMs: number): boolean {
  return internalDate.getTime() > watermark.getTime() - overlapMs;
}

/**
 * The records strictly above the last processed UID, in ascending UID order,
 * one per UID. `UID FETCH n:*` always returns the highest message even when n is
 * above it (RFC 3501 6.4.8), so the newest old message must be dropped here.
 */
export function aboveLastUid<T extends { uid: number }>(
  records: readonly T[],
  lastUid: number,
): T[] {
  const byUid = new Map<number, T>();
  for (const record of records) {
    if (record.uid > lastUid && !byUid.has(record.uid)) byUid.set(record.uid, record);
  }
  return [...byUid.values()].sort((a, b) => a.uid - b.uid);
}

/** Consecutive slices of at most `size` items, in order (D-04 chunked commits). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The generation a resync writes its locations under (D-23). A failed resync
 * toward the same UIDVALIDITY is retried from the start under the same pending
 * generation (reuse: its rows are simply upserted again); a new UIDVALIDITY
 * gets a fresh generation above every generation used so far, so stale rows of
 * an abandoned attempt are superseded or vanished by finishResync.
 */
export function pendingGenerationFor(
  state: FolderState,
  serverUidValidity: number,
): { generation: number; reuse: boolean } {
  if (
    state.state === 'resyncing' &&
    state.pendingUidValidity === serverUidValidity &&
    state.pendingGeneration !== null
  ) {
    return { generation: state.pendingGeneration, reuse: true };
  }
  return { generation: Math.max(state.generation, state.pendingGeneration ?? 0) + 1, reuse: false };
}

/**
 * The UIDs of the backfill window (D-75): INTERNALDATE at or after `since`,
 * ascending, each once. IMAP SEARCH SINCE is day-granular, so the exact cut is
 * made here from the fetched dates.
 */
export function backfillWindow(dates: readonly UidDate[], since: Date): number[] {
  const uids = new Set<number>();
  for (const { uid, internalDate } of dates) {
    if (internalDate.getTime() >= since.getTime()) uids.add(uid);
  }
  return [...uids].sort((a, b) => a - b);
}

/**
 * The persisted and logged resync summary line (D-25), e.g.
 * `INBOX resynced: 1,240 matched, 3 new, 12 gone, 830 older than backfill window`.
 */
export function formatResyncLine(folder: string, counts: ResyncCounts): string {
  const n = (value: number) => value.toLocaleString('en-US');
  return (
    `${folder} resynced: ${n(counts.matched)} matched, ${n(counts.new)} new, ` +
    `${n(counts.gone)} gone, ${n(counts.older)} older than backfill window`
  );
}
