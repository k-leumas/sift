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

/** A sync run finished: state ok, last_error cleared. */
export async function recordSyncSuccess(scope: Scope, at: Date = new Date()): Promise<void> {
  await scope.mailboxStatus.upsert({
    state: 'ok',
    lastError: null,
    lastSyncAt: at,
    lastSeenAt: at,
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
