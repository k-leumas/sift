import { redactText } from '@sift/core/log';
import type { Scope } from './scope.ts';

/**
 * Worker-facing use-cases over scope.mailboxStatus (D-07, D-43 second layer).
 * Mailbox failures are visible here, not in container health (D-51).
 */

/** Longest last_error kept, after redaction. */
const LAST_ERROR_MAX = 1000;

/** The worker saw the mailbox (a loop tick ran). */
export async function recordMailboxSeen(scope: Scope, at: Date = new Date()): Promise<void> {
  await scope.mailboxStatus.upsert({ lastSeenAt: at });
}

/**
 * A sync run finished: state ok, last_error cleared, and the volume valve's
 * held and approved counts cleared (D-26). Backfill progress is left as is.
 */
export async function recordSyncSuccess(scope: Scope, at: Date = new Date()): Promise<void> {
  await scope.mailboxStatus.upsert({
    state: 'ok',
    lastError: null,
    lastSyncAt: at,
    lastSeenAt: at,
    heldNewCount: null,
    approvedNewCount: null,
  });
}

/**
 * A sync run failed. last_error is redacted with the given secret values
 * before it is stored, then truncated (D-51: no secrets in last_error).
 */
export async function recordSyncError(
  scope: Scope,
  error: unknown,
  secrets: readonly string[],
  at: Date = new Date(),
): Promise<void> {
  const text = String(error instanceof Error ? error.message : error);
  await scope.mailboxStatus.upsert({
    state: 'error',
    lastError: redactText(text, secrets).slice(0, LAST_ERROR_MAX),
    lastSeenAt: at,
  });
}

/** The mailbox was disabled; the worker stops its loop. */
export async function recordDisabled(scope: Scope): Promise<void> {
  await scope.mailboxStatus.upsert({ state: 'disabled' });
}

/** The worker is connecting during its startup grace (D-34): not an error yet. */
export async function recordConnecting(scope: Scope, at: Date = new Date()): Promise<void> {
  await scope.mailboxStatus.upsert({ state: 'connecting', lastError: null, lastSeenAt: at });
}

function assertCount(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${what} must be a non-negative integer`);
  }
}

/**
 * The volume valve held new mail (D-26): more new messages than the
 * per-cycle limit. last_error names the count and the command that releases
 * them, and nothing else (no subjects or senders). Any earlier approval is
 * cleared, so the owner approves this hold explicitly.
 */
export async function recordNeedsAttention(
  scope: Scope,
  held: number,
  slug: string,
  at: Date = new Date(),
): Promise<void> {
  assertCount(held, 'held');
  await scope.mailboxStatus.upsert({
    state: 'needs_attention',
    heldNewCount: held,
    approvedNewCount: null,
    lastError: `${held} new messages held (more than the per-cycle limit); run sift mailbox resume ${slug}`,
    lastSeenAt: at,
  });
}

export interface HoldStatus {
  state: string | null;
  held: number | null;
  approved: number | null;
}

/** The mailbox's state and valve counts; all null when it has no status row yet. */
export async function readHold(scope: Scope): Promise<HoldStatus> {
  const row = await scope.mailboxStatus.get();
  return {
    state: row?.state ?? null,
    held: row?.heldNewCount ?? null,
    approved: row?.approvedNewCount ?? null,
  };
}

/**
 * Owner-visible progress of the first backfill (D-75): done and total
 * messages, both cleared once it finishes.
 */
export async function recordBackfillProgress(
  scope: Scope,
  progress: { done: number; total: number; finished: boolean },
): Promise<void> {
  if (progress.finished) {
    await scope.mailboxStatus.upsert({ backfillDone: null, backfillTotal: null });
    return;
  }
  assertCount(progress.done, 'done');
  assertCount(progress.total, 'total');
  await scope.mailboxStatus.upsert({ backfillDone: progress.done, backfillTotal: progress.total });
}
