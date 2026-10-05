import { drizzle } from 'drizzle-orm/node-postgres';
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

/**
 * Run `fn` while holding the mailbox's ingest lock, or return
 * `{ acquired: false }` at once, without calling `fn`, when another session
 * (the worker, or a CLI backfill in another process) holds it (D-03).
 *
 * The lock is a session-level `pg_try_advisory_lock` on one dedicated pooled
 * connection, and every `session.run` transaction uses that same connection,
 * so one active mailbox holds exactly one connection and concurrent mailboxes
 * cannot exhaust the pool waiting for each other (RESEARCH Pattern 6,
 * Pitfall 9). The lock is released when `fn` settles, including on throw.
 * Postgres also releases session locks when the connection ends, so a crashed
 * process never wedges the mailbox.
 */
export async function withIngestLock<T>(
  db: AppDb,
  mailboxId: string,
  fn: (session: IngestSession) => Promise<T>,
): Promise<IngestLockResult<T>> {
  if (!isMailboxId(mailboxId)) throw new InvalidMailboxIdError();
  const client = await internalsOf(db).pool.connect();
  let locked = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, $2)) as locked',
      [mailboxId, INGEST_LOCK_SEED],
    );
    locked = rows[0]?.locked === true;
    if (!locked) return { acquired: false };

    const orm = drizzle({ client });
    let open = true;
    let busy = false;
    const session: IngestSession = Object.freeze({
      mailboxId,
      async run<R>(
        runFn: (scope: Scope) => Promise<R>,
        options: WithMailboxOptions = {},
      ): Promise<R> {
        if (!open) throw new ScopeClosedError();
        if (busy) throw new IngestSessionBusyError();
        busy = true;
        try {
          return await runScoped(orm, mailboxId, runFn, options);
        } finally {
          busy = false;
        }
      },
    });
    try {
      return { acquired: true, value: await fn(session) };
    } finally {
      open = false;
    }
  } finally {
    if (locked) {
      await client.query('select pg_advisory_unlock(hashtextextended($1, $2))', [
        mailboxId,
        INGEST_LOCK_SEED,
      ]);
    }
    client.release();
  }
}
