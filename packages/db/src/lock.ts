import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { type AppDb, internalsOf } from './app-db.ts';
import {
  InvalidMailboxIdError,
  isMailboxId,
  runScoped,
  type Scope,
  ScopeClosedError,
  type WithMailboxOptions,
} from './scope.ts';

/**
 * Seed of `hashtextextended(mailbox_id, seed)`: every mailbox gets its own
 * 64-bit key in the single-bigint advisory key space. Two mailboxes, or a
 * mailbox and one of the fixed keys (MIGRATE_LOCK_KEY, CONFIG_APPLY_LOCK_KEY),
 * share a key with a probability of about 2^-64.
 */
export const INGEST_LOCK_SEED = 815309;

/** IngestSession.run was called while another run on the same session had not settled. */
export class IngestSessionBusyError extends Error {
  constructor() {
    super('IngestSession.run is already running on this session');
    this.name = 'IngestSessionBusyError';
  }
}

/**
 * The holder's view of a mailbox's ingest lock. Every `run` is one scoped
 * transaction on the lock's own connection.
 *
 * `run` is not re-entrant: a call made while another run on this session has
 * not settled (from inside its fn, or overlapping it) rejects with
 * IngestSessionBusyError before any SQL, so the lock connection never sees a
 * second BEGIN. Once withIngestLock returns, `run` throws ScopeClosedError.
 */
export interface IngestSession {
  readonly mailboxId: string;
  run<T>(fn: (scope: Scope) => Promise<T>, options?: WithMailboxOptions): Promise<T>;
}

export type IngestLockResult<T> = { acquired: true; value: T } | { acquired: false };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Run `fn` with a session whose transactions use `client`. Resolves only
 * after `fn` and any run it left in flight have settled, so the caller never
 * unlocks or releases the client under an open transaction.
 */
async function holdSession<T>(
  client: pg.PoolClient,
  mailboxId: string,
  fn: (session: IngestSession) => Promise<T>,
): Promise<T> {
  const orm = drizzle({ client });
  let open = true;
  let inFlight: Promise<unknown> | undefined;
  const session: IngestSession = Object.freeze({
    mailboxId,
    async run<R>(
      runFn: (scope: Scope) => Promise<R>,
      options: WithMailboxOptions = {},
    ): Promise<R> {
      if (!open) throw new ScopeClosedError();
      // Checked and set before any await: a nested or overlapping call is
      // refused before it can send a second BEGIN on the lock connection.
      if (inFlight !== undefined) throw new IngestSessionBusyError();
      const running = runScoped(orm, mailboxId, runFn, options);
      inFlight = running;
      try {
        return await running;
      } finally {
        inFlight = undefined;
      }
    },
  });
  try {
    return await fn(session);
  } finally {
    open = false;
    if (inFlight !== undefined) await Promise.allSettled([inFlight]);
  }
}

/**
 * Run `fn` while holding the mailbox's ingest lock, or return
 * `{ acquired: false }` at once, without calling `fn`, when another session
 * (the worker, or a CLI backfill in another process) holds it (D-03).
 *
 * The lock is a session-level `pg_try_advisory_lock` on one dedicated pooled
 * connection, and every `session.run` transaction uses that same connection,
 * so one active mailbox holds exactly one connection and concurrent mailboxes
 * cannot exhaust the pool waiting for each other (RESEARCH Pattern 6,
 * Pitfall 9). `session.run` is not re-entrant (IngestSessionBusyError).
 *
 * The lock is released when `fn` settles, including on throw. Postgres also
 * releases session locks when the connection ends, so a crashed process or a
 * terminated backend never wedges the mailbox. A connection that failed, or
 * whose unlock failed, is discarded instead of returning to the pool. `fn`'s
 * own error wins over an unlock error; when `fn` succeeded but the unlock
 * failed, that error is thrown.
 */
export async function withIngestLock<T>(
  db: AppDb,
  mailboxId: string,
  fn: (session: IngestSession) => Promise<T>,
): Promise<IngestLockResult<T>> {
  if (!isMailboxId(mailboxId)) throw new InvalidMailboxIdError();
  const client = await internalsOf(db).pool.connect();
  // A checked-out client has no pool error listener. Without this one, the
  // server ending the session would surface as an uncaught 'error' event.
  let broken: Error | undefined;
  const onError = (error: Error): void => {
    broken ??= error;
  };
  client.on('error', onError);

  let result: IngestLockResult<T> = { acquired: false };
  let failure: { error: unknown } | undefined;
  /** Whether this connection may hold the lock (true until the try query says no). */
  let mayHoldLock = true;
  /** False while a failure could have come from the lock query itself. */
  let lockKnown = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, $2)) as locked',
      [mailboxId, INGEST_LOCK_SEED],
    );
    mayHoldLock = rows[0]?.locked === true;
    lockKnown = true;
    if (mayHoldLock) result = { acquired: true, value: await holdSession(client, mailboxId, fn) };
  } catch (error) {
    failure = { error };
  }

  let unlockError: Error | undefined;
  if (mayHoldLock && broken === undefined) {
    try {
      const { rows } = await client.query<{ unlocked: boolean }>(
        'select pg_advisory_unlock(hashtextextended($1, $2)) as unlocked',
        [mailboxId, INGEST_LOCK_SEED],
      );
      if (rows[0]?.unlocked !== true) unlockError = new Error('ingest lock was not held at unlock');
    } catch (error) {
      unlockError = asError(error);
    }
  }
  client.removeListener('error', onError);
  // Never return a dead connection, or one that may still hold the lock, to the pool.
  const discard =
    broken ?? unlockError ?? (!lockKnown && failure ? asError(failure.error) : undefined);
  client.release(discard ?? false);

  if (failure !== undefined) throw failure.error;
  const releaseError = broken ?? unlockError;
  if (result.acquired && releaseError !== undefined) throw releaseError;
  return result;
}
